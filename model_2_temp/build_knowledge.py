"""
CRIE knowledge build — Model 2

ATT&CK STIX + Elastic detection-rules + reviewed D3FEND CSV

Outputs:
    out/Y_attack.csv
    out/Y_elastic_all.csv
    out/Y_elastic_human.csv
    out/Y_d3fend.csv        (if already generated)
    out/Y_fused.csv
    out/E_fused_scores.csv
    out/elastic_rule_counts.csv
    out/label_rate_report.csv
    out/action_registry.json
    out/mcode_to_action.json
    out/family_crosswalk.json
    out/family_action_priors.json

Run:
    python build_knowledge.py

Required:
    enterprise-attack.json

Optional:
    out/Y_d3fend.csv
    Elastic detection-rules clone
"""

import json
import re
import glob
import tomllib
import collections
import os
import numpy as np
import pandas as pd


# ================================================================
# OUTPUT
# ================================================================

OUT = "out"
os.makedirs(OUT, exist_ok=True)


# ================================================================
# 1. ACTION REGISTRY — 20 ACTIONS
# ================================================================

ACTIONS = {
    "enable_mfa": "Enable MFA",
    "reset_credentials": "Reset Credentials",
    "revoke_sessions": "Revoke Sessions",
    "disable_account": "Disable Compromised Account",
    "block_source_ip": "Block Source IP",
    "rate_limit_traffic": "Rate Limit Traffic",
    "block_domain_port": "Block Malicious Domain/Port",
    "network_segmentation": "Network Segmentation",
    "isolate_host": "Isolate Host",
    "kill_process": "Kill Process",
    "quarantine_file": "Quarantine File",
    "block_execution": "Block Execution / Allowlisting",
    "block_malicious_request": "Block Malicious Request",
    "add_waf_rule": "Add WAF Rule",
    "patch_software": "Patch / Update Software",
    "harden_configuration": "Harden Configuration",
    "disable_service": "Disable Unnecessary Service",
    "restrict_data_transfer": "Restrict / Block Data Transfer",
    "restore_from_backup": "Restore from Backup",
    "increase_monitoring": "Increase Logging / Monitoring",
}

REQUIRES = {
    "block_source_ip": ["src_ip"],
    "disable_account": ["username"],
    "revoke_sessions": ["username"],
    "reset_credentials": ["username"],
    "isolate_host": ["host"],
    "kill_process": ["host"],
    "quarantine_file": ["host"],
    "block_domain_port": ["dst_ip|domain"],
    "restrict_data_transfer": ["dst_ip|domain"],
}

DISRUPTIVE = {
    "isolate_host": "high",
    "disable_account": "high",
    "kill_process": "medium",
    "restore_from_backup": "critical",
    "network_segmentation": "medium",
    "block_source_ip": "medium",
}


# ================================================================
# 2. MITRE M-CODE -> OUR ACTIONS
# ================================================================

MCODE_TO_ACTIONS = {
    "M1013": ["harden_configuration"],
    "M1015": ["harden_configuration"],
    "M1016": ["patch_software"],
    "M1017": [],
    "M1018": ["disable_account", "harden_configuration"],
    "M1019": [],
    "M1020": ["increase_monitoring"],
    "M1021": ["block_domain_port", "block_malicious_request"],
    "M1022": ["harden_configuration"],
    "M1024": ["harden_configuration"],
    "M1025": ["harden_configuration"],
    "M1026": ["harden_configuration"],
    "M1027": ["reset_credentials"],
    "M1028": ["harden_configuration"],
    "M1029": ["restore_from_backup"],
    "M1030": ["network_segmentation"],
    "M1031": ["block_source_ip", "block_domain_port"],
    "M1032": ["enable_mfa"],
    "M1033": ["block_execution"],
    "M1034": ["harden_configuration"],
    "M1035": ["network_segmentation"],
    "M1036": ["harden_configuration"],
    "M1037": [
        "block_source_ip",
        "rate_limit_traffic",
        "block_domain_port",
    ],
    "M1038": ["block_execution"],
    "M1039": ["harden_configuration"],
    "M1040": ["kill_process", "block_execution"],
    "M1041": ["harden_configuration"],
    "M1042": ["disable_service"],
    "M1043": ["harden_configuration"],
    "M1044": ["harden_configuration"],
    "M1045": ["block_execution"],
    "M1046": ["harden_configuration"],
    "M1047": ["increase_monitoring"],
    "M1048": ["harden_configuration"],
    "M1049": ["quarantine_file", "kill_process"],
    "M1050": ["add_waf_rule", "harden_configuration"],
    "M1051": ["patch_software"],
    "M1052": ["harden_configuration"],
    "M1053": ["restore_from_backup"],
    "M1054": ["harden_configuration"],
    "M1055": [],
    "M1056": [],
    "M1057": ["restrict_data_transfer"],
    "M1060": [],
}

NON_ACTIONABLE = {
    m for m, actions in MCODE_TO_ACTIONS.items() if not actions
}


# ================================================================
# 3. ELASTIC REMEDIATION LEXICON
# ================================================================

LEX = {
    "enable_mfa":
        r"\bmfa\b|multi-?factor|\b2fa\b|two-factor",

    "reset_credentials":
        r"reset.{0,25}(password|credential)|"
        r"rotate.{0,25}(password|credential|secret|api key|token)|"
        r"change.{0,20}(password|credential)",

    "revoke_sessions":
        r"revoke.{0,25}(session|token|access)|"
        r"terminate.{0,25}session|"
        r"invalidate.{0,20}(session|token)|"
        r"sign.?out|log.?off",

    "disable_account":
        r"disable.{0,30}(account|user)|"
        r"suspend.{0,20}account|"
        r"lock.{0,15}account|"
        r"deactivate.{0,20}(account|user)",

    "block_source_ip":
        r"block.{0,40}\b(ip|ips|address|addresses|source|sources)\b|"
        r"blocklist|blacklist|deny.{0,20}\bip",

    "rate_limit_traffic":
        r"rate[- ]?limit|throttl|traffic shaping",

    "block_domain_port":
        r"block.{0,30}(domain|url|port|dns|hostname)|sinkhole",

    "network_segmentation":
        r"segment|vlan|network isolation",

    "isolate_host":
        r"isolat.{0,40}(host|system|endpoint|machine|device|server)|"
        r"disconnect.{0,30}network|"
        r"contain.{0,20}(host|system|endpoint)",

    "kill_process":
        r"(kill|terminate|stop).{0,25}process|end.{0,10}process",

    "quarantine_file":
        r"quarantin.{0,30}(file|malware|binary|artifact|sample)|"
        r"(delete|remove).{0,25}"
        r"(malware|malicious (file|binar)|web ?shell|dropped)",

    "block_execution":
        r"allowlist|whitelist|application control|applocker|"
        r"execution prevention|code signing|"
        r"block.{0,20}execut|restrict.{0,20}execut",

    "block_malicious_request":
        r"block.{0,30}(malicious )?(request|payload|http)|"
        r"input validation|sanitiz",

    "add_waf_rule":
        r"\bwaf\b|web application firewall",

    "patch_software":
        r"\bpatch|apply.{0,20}(security )?updates?|"
        r"update.{0,30}(software|version|application|vulnerab)|"
        r"upgrade",

    "harden_configuration":
        r"harden|secure configuration|least privilege|misconfigur|"
        r"configuration (baseline|review)|"
        r"restrict.{0,30}permission",

    "disable_service":
        r"disable.{0,30}"
        r"(service|feature|protocol|rdp|smb|ssh|unnecessary|unused|macro)|"
        r"turn off|remove.{0,20}(unnecessary|unused)",

    "restrict_data_transfer":
        r"data loss prevention|\bdlp\b|"
        r"restrict.{0,30}(data transfer|upload|exfil)|"
        r"block.{0,30}(upload|exfil|data transfer)|egress",

    "restore_from_backup":
        r"restore.{0,40}(backup|clean|known[- ]good)|"
        r"from (a )?(secure |clean |known[- ]good )?backup",

    "increase_monitoring":
        r"(increase|enhance|enable|expand|extend|improve).{0,30}"
        r"(logging|monitoring|visibility|telemetry|detection)",
}

LEX = {
    k: re.compile(v, re.I | re.S)
    for k, v in LEX.items()
}


# ================================================================
# 4. FAMILY -> ATT&CK CROSSWALK
# ================================================================

CROSSWALK = {
    "Credential Attack / Brute Force": {
        "tactic": "credential-access",
        "primary": [
            "T1110",
            "T1110.001",
            "T1110.003",
            "T1110.004",
        ],
        "secondary": [
            "T1078",
            "T1621",
            "T1110.002",
        ],
        "note": (
            "T1110.002 (cracking) is offline, "
            "so it is kept secondary."
        ),
    },

    "Exploitation / RCE": {
        "tactic": "initial-access",
        "primary": [
            "T1190",
            "T1203",
        ],
        "secondary": [
            "T1210",
            "T1068",
            "T1133",
        ],
        "note": (
            "Network-facing RCE -> T1190 first; "
            "T1210 if the target is internal."
        ),
    },

    "Data Exfiltration": {
        "tactic": "exfiltration",
        "primary": [
            "T1041",
            "T1567",
            "T1048",
        ],
        "secondary": [
            "T1567.002",
            "T1048.001",
            "T1048.002",
            "T1048.003",
            "T1030",
            "T1029",
            "T1537",
        ],
        "note": (
            "T1041/T1567 are 99.9% of the "
            "WitFoo incident_signals."
        ),
    },

    "DoS / Flooding": {
        "tactic": "impact",
        "primary": [
            "T1498",
            "T1498.001",
            "T1498.002",
            "T1499",
            "T1499.001",
            "T1499.002",
            "T1499.003",
        ],
        "secondary": [
            "T1499.004",
        ],
        "note": (
            "ATT&CK has only M1037 for all of these. "
            "D3FEND/Elastic/tactic defaults must carry this family."
        ),
    },

    "Recon / Scanning": {
        "tactic": "reconnaissance",
        "primary": [
            "T1595",
            "T1595.001",
            "T1595.002",
            "T1046",
        ],
        "secondary": [
            "T1595.003",
            "T1018",
            "T1590",
        ],
        "note": (
            "ATT&CK says 'Pre-compromise' (M1056), "
            "which is not actionable. Fixes come from Elastic and D3FEND."
        ),
    },

    "Backdoor / Persistence": {
        "tactic": "persistence",
        "primary": [
            "T1505",
            "T1505.003",
            "T1543",
            "T1053",
            "T1547",
        ],
        "secondary": [
            "T1136",
            "T1098",
            "T1133",
            "T1546",
        ],
        "note": (
            "Web shell (T1505.003) is the most "
            "network-observable backdoor."
        ),
    },

    "Shellcode / Payload Execution": {
        "tactic": "execution",
        "primary": [
            "T1059",
            "T1055",
            "T1620",
            "T1106",
        ],
        "secondary": [
            "T1204",
            "T1027",
            "T1203",
        ],
        "note": "Shellcode ~ in-memory execution / injection.",
    },

    "Fuzzing": {
        "tactic": "reconnaissance",
        "primary": [
            "T1595.002",
            "T1190",
        ],
        "secondary": [
            "T1499.004",
            "T1211",
        ],
        "note": (
            "PROXY MAPPING: ATT&CK has no fuzzing technique. "
            "Fuzzing = probing exposed apps with malformed input."
        ),
    },
}


# ================================================================
# 5. LOAD ATT&CK
# ================================================================

print("\n=== LOAD ATT&CK ===")

if not os.path.exists("enterprise-attack.json"):
    raise FileNotFoundError(
        "\nenterprise-attack.json was not found in:\n"
        f"{os.getcwd()}\n\n"
        "Put enterprise-attack.json in the same folder as "
        "build_knowledge.py and run again."
    )

with open(
    "enterprise-attack.json",
    "r",
    encoding="utf-8",
) as f:
    bundle = json.load(f)

objs = bundle["objects"]


def external_id(obj):
    for ref in obj.get("external_references", []):
        if ref.get("source_name") == "mitre-attack":
            return ref.get("external_id")
    return None


def valid_object(obj):
    return (
        not obj.get("revoked")
        and not obj.get("x_mitre_deprecated")
    )


tech = {
    external_id(o): o
    for o in objs
    if o["type"] == "attack-pattern"
    and valid_object(o)
    and external_id(o)
}

mit = {
    o["id"]: external_id(o)
    for o in objs
    if o["type"] == "course-of-action"
    and valid_object(o)
    and external_id(o)
}

tid_by_stix = {
    o["id"]: external_id(o)
    for o in tech.values()
}

t_mcodes = collections.defaultdict(set)

for r in objs:
    if (
        r["type"] == "relationship"
        and r["relationship_type"] == "mitigates"
        and valid_object(r)
        and r["source_ref"] in mit
        and r["target_ref"] in tid_by_stix
    ):
        t_mcodes[tid_by_stix[r["target_ref"]]].add(
            mit[r["source_ref"]]
        )

print(
    f"[ATT&CK] {len(tech)} techniques+subs, "
    f"{len(mit)} mitigations, "
    f"{len(t_mcodes)} with >=1 mitigation"
)


# Verify family crosswalk IDs
bad = [
    (family, technique)
    for family, value in CROSSWALK.items()
    for technique in value["primary"] + value["secondary"]
    if technique not in tech
]

assert not bad, (
    f"crosswalk IDs not in ATT&CK: {bad}"
)

print("[crosswalk] all IDs verified against STIX")


# ================================================================
# 6. ATT&CK EVIDENCE MATRIX
# ================================================================

def parent(technique):
    return technique.split(".")[0]


T = sorted(tech)
A = list(ACTIONS)

E_att = pd.DataFrame(
    0,
    index=T,
    columns=A,
    dtype=int,
)

for technique in T:
    codes = set(t_mcodes.get(technique, set()))

    for mcode in codes:
        for action in MCODE_TO_ACTIONS.get(mcode, []):
            E_att.loc[technique, action] += 1


# Sub-techniques without direct mitigation
# inherit parent evidence.
inherited = 0

for technique in T:
    if (
        "." in technique
        and E_att.loc[technique].sum() == 0
        and parent(technique) in E_att.index
        and E_att.loc[parent(technique)].sum() > 0
    ):
        E_att.loc[technique] = E_att.loc[parent(technique)]
        inherited += 1

print(
    f"[ATT&CK matrix] "
    f"{inherited} sub-techniques inherited parent evidence"
)

Y_att = (E_att > 0).astype(int)


# ================================================================
# 7. ELASTIC DETECTION-RULES
# ================================================================

print("\n=== ELASTIC RULE DISCOVERY ===")


def find_elastic_rule_files():
    """
    Search several common Elastic detection-rules layouts.

    Supported examples:
        elastic/rules/**/*.toml
        elastic/**/*.toml
        detection-rules/rules/**/*.toml
        detection-rules/**/*.toml
        rules/**/*.toml
    """

    patterns = [
        "elastic/rules/**/*.toml",
        "elastic/**/*.toml",
        "detection-rules/rules/**/*.toml",
        "detection-rules/**/*.toml",
        "rules/**/*.toml",
    ]

    found = set()

    for pattern in patterns:
        for path in glob.glob(pattern, recursive=True):
            if os.path.isfile(path):
                found.add(os.path.normpath(path))

    return sorted(found)


elastic_files = find_elastic_rule_files()

print(
    f"[Elastic] candidate TOML files found: "
    f"{len(elastic_files)}"
)

if len(elastic_files) == 0:
    print(
        "[Elastic] WARNING: no Elastic TOML rules were found."
    )
    print(
        "[Elastic] The script will continue using ATT&CK + D3FEND."
    )
    print(
        "[Elastic] If you want Elastic evidence, clone/copy "
        "Elastic detection rules into the project."
    )


rules = []

for path in elastic_files:

    if "_deprecated" in path:
        continue

    try:
        with open(path, "rb") as f:
            d = tomllib.load(f)
    except Exception:
        continue

    r = d.get("rule", {})

    if not isinstance(r, dict):
        continue

    note = r.get("note", "") or ""

    # Some rule files may use other remediation fields.
    remediation_text = " ".join(
        str(r.get(key, "") or "")
        for key in [
            "note",
            "description",
            "references",
            "setup",
            "building_block_type",
        ]
    )

    ts = set()

    for threat in r.get("threat", []) or []:

        if not isinstance(threat, dict):
            continue

        for technique in threat.get("technique", []) or []:

            if not isinstance(technique, dict):
                continue

            tid = technique.get("id")

            if tid:
                ts.add(tid)

            for sub in (
                technique.get("subtechnique", [])
                or []
            ):
                if isinstance(sub, dict):
                    sid = sub.get("id")
                    if sid:
                        ts.add(sid)

    # Prefer the explicit response/remediation section.
    match = re.search(
        r"response and remediation(.*)",
        note,
        re.I | re.S,
    )

    if match:
        section = match.group(1)
    else:
        # If no explicit section exists, don't treat the entire
        # rule as remediation evidence unless useful remediation
        # language is actually present.
        section = remediation_text

    if not ts:
        continue

    if not section.strip():
        continue

    ai = bool(
        re.search(
            r"generative ai|created using generative",
            note,
            re.I,
        )
    )

    hits = {
        action: bool(pattern.search(section))
        for action, pattern in LEX.items()
    }

    # Only retain rules that actually mention at least one
    # remediation action from our fixed 20-action taxonomy.
    if not any(hits.values()):
        continue

    rules.append(
        {
            "name": r.get("name"),
            "techs": sorted(ts),
            "ai": ai,
            "hits": hits,
        }
    )


print(
    f"[Elastic] {len(rules)} rules with ATT&CK tag + "
    f"remediation evidence | "
    f"AI-assisted guides: "
    f"{sum(r['ai'] for r in rules)}"
)


# ================================================================
# ELASTIC MATRIX
# ================================================================

def elastic_matrix(subset):

    cnt = collections.defaultdict(
        lambda: np.zeros(len(A))
    )

    n = collections.Counter()

    for rule in subset:

        v = np.array(
            [
                rule["hits"][action]
                for action in A
            ],
            dtype=float,
        )

        # Roll sub-techniques to their parent.
        tech_set = set(rule["techs"])

        tech_set |= {
            parent(t)
            for t in rule["techs"]
        }

        for technique in tech_set:

            if technique in tech:
                cnt[technique] += v
                n[technique] += 1

    C = pd.DataFrame(
        0.0,
        index=T,
        columns=A,
    )

    N = pd.Series(
        0,
        index=T,
        dtype=int,
    )

    for technique in cnt:
        C.loc[technique] = cnt[technique]
        N[technique] = n[technique]

    return C, N


C_all, N_all = elastic_matrix(rules)

C_human, N_human = elastic_matrix(
    [
        r
        for r in rules
        if not r["ai"]
    ]
)


def global_rate(subset):

    if not subset:
        return {
            action: 0.0
            for action in A
        }

    return {
        action: np.mean(
            [
                r["hits"][action]
                for r in subset
            ]
        )
        for action in A
    }


G_ALL = global_rate(rules)
G_HUMAN = global_rate(
    [
        r
        for r in rules
        if not r["ai"]
    ]
)


def binarize(
    C,
    N,
    G,
    frac=0.30,
    min_count=2,
    min_lift=1.3,
    boiler=0.30,
):
    """
    Positive if action appears in >= frac of the
    technique's rules AND >= min_count rules.

    For generic boilerplate actions, require lift over
    global action frequency.
    """

    Y = pd.DataFrame(
        0,
        index=C.index,
        columns=C.columns,
        dtype=int,
    )

    for technique in C.index:

        n = int(N[technique])

        if n == 0:
            continue

        need = max(
            1,
            min(min_count, n),
        )

        fraction = C.loc[technique] / n

        base = (
            (fraction >= frac)
            & (C.loc[technique] >= need)
        )

        for action in A:

            if G[action] >= boiler:

                lift = (
                    fraction[action]
                    / max(G[action], 1e-9)
                )

                if lift < min_lift:
                    base[action] = False

        Y.loc[technique] = base.astype(int)

    return Y


Y_el_all = binarize(
    C_all,
    N_all,
    G_ALL,
)

Y_el_human = binarize(
    C_human,
    N_human,
    G_HUMAN,
)

print(
    "[Elastic] boilerplate actions "
    "(global rate>=30%):",
    {
        ACTIONS[action]: round(G_ALL[action], 2)
        for action in A
        if G_ALL[action] >= 0.30
    },
)


# ================================================================
# 8. D3FEND EVIDENCE
# ================================================================

print("\n=== D3FEND EVIDENCE ===")

Y_d3 = None

d3_path = os.path.join(
    OUT,
    "Y_d3fend.csv",
)

if os.path.exists(d3_path):

    Y_d3 = (
        pd.read_csv(
            d3_path,
            index_col=0,
        )
        .reindex(T)
        .fillna(0)
        .astype(int)
        [A]
    )

    # IMPORTANT:
    # Do NOT inherit D3FEND evidence from parent techniques.
    #
    # D3FEND labels come only from the reviewed mappings
    # that generated Y_d3fend.csv.

    print(
        "[D3FEND] loaded:",
        int(
            (
                Y_d3.sum(axis=1) > 0
            ).sum()
        ),
        "techniques with >=1 action",
    )

else:

    print(
        "[D3FEND] out/Y_d3fend.csv not found."
    )

    print(
        "[D3FEND] Continuing with ATT&CK + Elastic only."
    )


# ================================================================
# 9. EVIDENCE FUSION
# ================================================================

print("\n=== EVIDENCE FUSION ===")


"""
Fusion design:

ATT&CK:
    authoritative mitigation mapping

Elastic:
    practitioner remediation evidence

D3FEND:
    reviewed defensive-technique evidence

The three sources remain separate.

Important:
If Elastic is unavailable, we DO NOT allow its missing
evidence to artificially push every score toward zero.

The available evidence sources are normalized according
to which sources are actually present.
"""


E_att_bin = Y_att.astype(float)
E_elastic_bin = Y_el_all.astype(float)

if Y_d3 is not None:
    E_d3_bin = Y_d3.astype(float)
else:
    E_d3_bin = pd.DataFrame(
        0.0,
        index=T,
        columns=A,
    )


# ------------------------------------------------
# Source availability
# ------------------------------------------------

elastic_available = (
    int((N_all > 0).sum()) > 0
)

d3_available = (
    Y_d3 is not None
    and int((Y_d3.sum(axis=1) > 0).sum()) > 0
)


# ------------------------------------------------
# Base weights
# ------------------------------------------------

BASE_WEIGHTS = {
    "ATT&CK": 0.45,
    "Elastic": 0.30,
    "D3FEND": 0.25,
}


available_weights = {
    "ATT&CK": BASE_WEIGHTS["ATT&CK"],
}

if elastic_available:
    available_weights["Elastic"] = BASE_WEIGHTS["Elastic"]

if d3_available:
    available_weights["D3FEND"] = BASE_WEIGHTS["D3FEND"]


weight_sum = sum(
    available_weights.values()
)

available_weights = {
    key: value / weight_sum
    for key, value in available_weights.items()
}


W_ATT = available_weights.get(
    "ATT&CK",
    0.0,
)

W_ELASTIC = available_weights.get(
    "Elastic",
    0.0,
)

W_D3FEND = available_weights.get(
    "D3FEND",
    0.0,
)


# ------------------------------------------------
# Fusion threshold
# ------------------------------------------------

"""
A single authoritative ATT&CK or reviewed D3FEND
positive is allowed to become a training label.

Weak/noisy sources do not create labels by themselves
when they are unavailable.

When multiple sources are present, the continuous
score is retained in E_fused_scores.csv.
"""

FUSED_THRESHOLD = 0.25


# ------------------------------------------------
# Calculate fused evidence score
# ------------------------------------------------

E_fused_score = (
    W_ATT * E_att_bin
    + W_ELASTIC * E_elastic_bin
    + W_D3FEND * E_d3_bin
)


# ------------------------------------------------
# Conservative source-aware label rule
# ------------------------------------------------

Y_fused = (
    E_fused_score >= FUSED_THRESHOLD
).astype(int)


# If only ATT&CK + D3FEND are available, the normalized
# ATT&CK weight becomes > 0.50, meaning authoritative
# ATT&CK mitigation evidence remains usable instead of
# producing an almost-empty training matrix.
#
# This is intentional: Elastic is an additional
# practitioner-evidence source, not a required source.


print(
    "Available evidence sources:",
    ", ".join(available_weights.keys()),
)

print(
    "Weights:",
    ", ".join(
        f"{k}={v:.3f}"
        for k, v in available_weights.items()
    ),
)

print(
    f"Fusion threshold: {FUSED_THRESHOLD}"
)

print(
    "Techniques with >=1 fused action:",
    int(
        (
            Y_fused.sum(axis=1) > 0
        ).sum()
    ),
    "/",
    len(T),
)

print(
    "Techniques with NO fused label:",
    int(
        (
            Y_fused.sum(axis=1) == 0
        ).sum()
    ),
)


# ================================================================
# 10. SAVE CONTINUOUS FUSION SCORES
# ================================================================

E_fused_score.to_csv(
    os.path.join(
        OUT,
        "E_fused_scores.csv",
    )
)


# ================================================================
# 11. LABEL RATE REPORT
# ================================================================

print(
    "\n=== LABEL POSITIVE RATES "
    "(target: every FUSED action between 5% and 60%) ==="
)


def rate_report(
    Y,
    name,
    mask=None,
):
    Z = (
        Y
        if mask is None
        else Y[mask]
    )

    return Z.mean().rename(name)


cov_att = (
    Y_att.sum(axis=1) > 0
)

cov_el = (
    N_all > 0
)

cols = [
    Y_att.mean().rename("ATT&CK"),
]

if cov_el.any():
    cols.append(
        Y_el_all.loc[cov_el]
        .mean()
        .rename("Elastic(rules>0)")
    )

if (N_human > 0).any():
    cols.append(
        Y_el_human.loc[N_human > 0]
        .mean()
        .rename("Elastic human-only")
    )

if Y_d3 is not None:
    cols.append(
        Y_d3.mean()
        .rename("D3FEND")
    )

rep = pd.concat(
    cols
    + [
        Y_fused.mean()
        .rename("FUSED")
    ],
    axis=1,
)

rep.index = [
    ACTIONS[action]
    for action in rep.index
]

print(
    (rep * 100)
    .round(1)
    .to_string()
)


flag = rep[
    (rep["FUSED"] < 0.05)
    | (rep["FUSED"] > 0.60)
]

print(
    "\nOUT OF BAND (<5% or >60%):",
    list(flag.index)
    if len(flag)
    else "none",
)

print(
    "\nTechniques with >=1 action:",
    f"ATT&CK={int(cov_att.sum())}",
    f"Elastic={int((Y_el_all.sum(axis=1) > 0).sum())}",
    f"FUSED={int((Y_fused.sum(axis=1) > 0).sum())}",
    f"of {len(T)}",
)

print(
    "Techniques with Elastic rules:",
    int((N_all > 0).sum()),
    "| human-only:",
    int((N_human > 0).sum()),
)

print(
    "Techniques with NO label at all:",
    int(
        (
            Y_fused.sum(axis=1) == 0
        ).sum()
    ),
)


# ================================================================
# 12. FAMILY x ACTION PRIORS
# ================================================================

print(
    "\n=== FAMILY TOP-5 "
    "(ATT&CK + Elastic + D3FEND, pre-context) ==="
)


def family_scores(
    Yatt,
    Yel,
    Yd3,
):
    rows = {}

    for family, value in CROSSWALK.items():

        s = pd.Series(
            0.0,
            index=A,
        )

        w = 0.0

        for role, role_weight in (
            ("primary", 1.0),
            ("secondary", 0.5),
        ):

            for technique in value[role]:

                if technique not in Yatt.index:
                    continue

                if Yd3 is not None:

                    # Family prior:
                    # ATT&CK 45%
                    # Elastic 30%
                    # D3FEND 25%
                    local_score = (
                        0.45 * Yatt.loc[technique]
                        + 0.30 * Yel.loc[technique]
                        + 0.25 * Yd3.loc[technique]
                    )

                else:

                    local_score = (
                        0.60 * Yatt.loc[technique]
                        + 0.40 * Yel.loc[technique]
                    )

                s += role_weight * local_score
                w += role_weight

        if w > 0:
            rows[family] = s / w
        else:
            rows[family] = s

    return pd.DataFrame(rows).T


F = family_scores(
    Y_att,
    Y_el_all,
    Y_d3,
)


fam_out = {}

for family in CROSSWALK:

    top = (
        F.loc[family]
        .sort_values(ascending=False)
    )

    fam_out[family] = [
        {
            "action": ACTIONS[action],
            "id": action,
            "score": round(
                float(score),
                3,
            ),
        }
        for action, score in top.head(6).items()
        if score > 0
    ]

    print(
        f"\n{family} "
        f"(tactic={CROSSWALK[family]['tactic']})"
    )

    for item in fam_out[family][:5]:
        print(
            f"   {item['score']:.2f} "
            f"{item['action']}"
        )

    if len(fam_out[family]) < 3:
        print(
            "   !! fewer than 3 actions: "
            "needs tactic/default fallback"
        )


# ================================================================
# 13. SAVE
# ================================================================

json.dump(
    {
        "actions": ACTIONS,
        "requires": REQUIRES,
        "disruptive_min_severity": DISRUPTIVE,
    },
    open(
        os.path.join(
            OUT,
            "action_registry.json",
        ),
        "w",
        encoding="utf-8",
    ),
    indent=2,
)

json.dump(
    MCODE_TO_ACTIONS,
    open(
        os.path.join(
            OUT,
            "mcode_to_action.json",
        ),
        "w",
        encoding="utf-8",
    ),
    indent=2,
)

json.dump(
    CROSSWALK,
    open(
        os.path.join(
            OUT,
            "family_crosswalk.json",
        ),
        "w",
        encoding="utf-8",
    ),
    indent=2,
)

json.dump(
    fam_out,
    open(
        os.path.join(
            OUT,
            "family_action_priors.json",
        ),
        "w",
        encoding="utf-8",
    ),
    indent=2,
)

Y_att.to_csv(
    os.path.join(
        OUT,
        "Y_attack.csv",
    )
)

Y_el_all.to_csv(
    os.path.join(
        OUT,
        "Y_elastic_all.csv",
    )
)

Y_el_human.to_csv(
    os.path.join(
        OUT,
        "Y_elastic_human.csv",
    )
)

if Y_d3 is not None:
    Y_d3.to_csv(
        os.path.join(
            OUT,
            "Y_d3fend_used.csv",
        )
    )

Y_fused.to_csv(
    os.path.join(
        OUT,
        "Y_fused.csv",
    )
)

N_all.to_csv(
    os.path.join(
        OUT,
        "elastic_rule_counts.csv",
    )
)

(
    rep * 100
).round(2).to_csv(
    os.path.join(
        OUT,
        "label_rate_report.csv",
    )
)

print(
    f"\nsaved -> {OUT}/"
)