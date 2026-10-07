"""
D3FEND -> CRIE remediation evidence mapper

Uses:
1. d3fend-full-mappings.csv
2. d3fend_action_mapping.csv  <-- reviewed mapping

Produces:
    out/E_d3fend_counts.csv
    out/Y_d3fend.csv

Important:
- No automatic ancestor inheritance
- No tactic fallback
- No invented mappings
- Only reviewed D3FEND -> CRIE action mappings are used
"""

import os
import sys
import json
import collections
import pandas as pd


HERE = os.path.dirname(os.path.abspath(__file__))


# ============================================================
# PATHS
# ============================================================

ACTION_REGISTRY = os.path.join(
    HERE, "action_registry.json"
)

REVIEWED_MAPPING = os.path.join(
    HERE, "d3fend_action_mapping.csv"
)


# ============================================================
# LOAD ACTION REGISTRY
# ============================================================

with open(ACTION_REGISTRY, "r", encoding="utf-8") as f:
    ACTIONS = json.load(f)["actions"]

ACTION_IDS = list(ACTIONS.keys())


# ============================================================
# LOAD REVIEWED D3FEND -> ACTION MAPPING
# ============================================================

mapping_df = pd.read_csv(REVIEWED_MAPPING)

required_mapping_cols = {
    "action_id",
    "d3fend_technique",
    "mapping_strength"
}

missing = required_mapping_cols - set(mapping_df.columns)

if missing:
    raise ValueError(
        f"Missing columns in d3fend_action_mapping.csv: {sorted(missing)}"
    )


# Validate action IDs
unknown_actions = sorted(
    set(mapping_df["action_id"].dropna()) - set(ACTION_IDS)
)

if unknown_actions:
    raise ValueError(
        f"Unknown action IDs in reviewed D3FEND mapping: {unknown_actions}"
    )


# Keep only the reviewed mappings
mapping_df = (
    mapping_df[
        [
            "action_id",
            "d3fend_technique",
            "mapping_strength"
        ]
    ]
    .dropna(subset=["action_id", "d3fend_technique"])
    .drop_duplicates(
        subset=["action_id", "d3fend_technique"]
    )
    .reset_index(drop=True)
)


# ============================================================
# BUILD:
# D3FEND TECHNIQUE LABEL -> ACTIONS
# ============================================================

D3FEND_TO_ACTIONS = collections.defaultdict(list)

for _, row in mapping_df.iterrows():

    technique = str(row["d3fend_technique"]).strip()
    action = str(row["action_id"]).strip()

    D3FEND_TO_ACTIONS[technique].append(action)


# Remove duplicates while preserving order
for technique in D3FEND_TO_ACTIONS:
    D3FEND_TO_ACTIONS[technique] = list(
        dict.fromkeys(D3FEND_TO_ACTIONS[technique])
    )


# ============================================================
# COVERAGE REPORT
# ============================================================

def coverage_report():

    print("\n========================================")
    print("D3FEND -> CRIE COVERAGE REPORT")
    print("========================================")

    print(
        f"Reviewed D3FEND mappings: {len(mapping_df)}"
    )

    print(
        f"D3FEND techniques mapped: "
        f"{mapping_df['d3fend_technique'].nunique()}"
    )

    print(
        f"CRIE actions represented: "
        f"{mapping_df['action_id'].nunique()} / {len(ACTION_IDS)}"
    )

    print("\nMapping strength:")
    print(
        mapping_df["mapping_strength"]
        .value_counts()
        .to_string()
    )

    print("\nD3FEND techniques supplying each action:")

    for action_id in ACTION_IDS:

        count = int(
            (
                mapping_df["action_id"] == action_id
            ).sum()
        )

        label = ACTIONS[action_id]

        print(
            f"  {count:3d}  {action_id}: {label}"
        )

    missing_actions = sorted(
        set(ACTION_IDS)
        - set(mapping_df["action_id"])
    )

    print("\nActions with ZERO direct D3FEND mapping:")

    if missing_actions:
        for action_id in missing_actions:
            print(
                f"  - {action_id}: {ACTIONS[action_id]}"
            )
    else:
        print("  none")


# ============================================================
# CSV BUILD
# ============================================================

def build_from_csv(csv_path, out_dir="out"):

    print("\n========================================")
    print("BUILDING D3FEND EVIDENCE")
    print("========================================")

    print(f"Input CSV: {csv_path}")

    df = pd.read_csv(
        csv_path,
        low_memory=False
    )

    print(
        f"Loaded D3FEND rows: {len(df):,}"
    )

    # --------------------------------------------------------
    # Validate required columns
    # --------------------------------------------------------

    required_columns = [
        "off_tech_id",
        "def_tech_label"
    ]

    missing = [
        c for c in required_columns
        if c not in df.columns
    ]

    if missing:
        raise ValueError(
            f"Missing required D3FEND columns: {missing}"
        )

    # --------------------------------------------------------
    # Keep only relevant columns
    # --------------------------------------------------------

    work = (
        df[
            [
                "off_tech_id",
                "def_tech_label"
            ]
        ]
        .dropna()
        .drop_duplicates()
    )

    print(
        f"Unique ATT&CK/D3FEND relationships: "
        f"{len(work):,}"
    )

    # --------------------------------------------------------
    # Build ATT&CK technique -> action evidence
    # --------------------------------------------------------

    evidence = collections.defaultdict(
        lambda: collections.defaultdict(set)
    )

    unresolved_d3fend = collections.Counter()

    for _, row in work.iterrows():

        attack_id = str(
            row["off_tech_id"]
        ).strip()

        d3fend_label = str(
            row["def_tech_label"]
        ).strip()

        # We only want ATT&CK Enterprise-style T IDs
        if not attack_id.startswith("T"):
            continue

        # Only use EXACT reviewed D3FEND labels
        actions = D3FEND_TO_ACTIONS.get(
            d3fend_label
        )

        if not actions:

            unresolved_d3fend[
                d3fend_label
            ] += 1

            continue

        for action_id in actions:

            evidence[
                attack_id
            ][action_id].add(
                d3fend_label
            )

    # --------------------------------------------------------
    # Build action matrix
    # --------------------------------------------------------

    attack_techniques = sorted(evidence.keys())

    E = pd.DataFrame(
        0,
        index=attack_techniques,
        columns=ACTION_IDS,
        dtype=int
    )

    for attack_id in attack_techniques:

        for action_id, labels in evidence[
            attack_id
        ].items():

            E.loc[
                attack_id,
                action_id
            ] = len(labels)

    # --------------------------------------------------------
    # Output directory
    # --------------------------------------------------------

    os.makedirs(
        os.path.join(HERE, out_dir),
        exist_ok=True
    )

    # --------------------------------------------------------
    # Save evidence counts
    # --------------------------------------------------------

    counts_path = os.path.join(
        HERE,
        out_dir,
        "E_d3fend_counts.csv"
    )

    E.to_csv(counts_path)

    # --------------------------------------------------------
    # Binary D3FEND evidence labels
    # --------------------------------------------------------

    Y = (
        E > 0
    ).astype(int)

    y_path = os.path.join(
        HERE,
        out_dir,
        "Y_d3fend.csv"
    )

    Y.to_csv(y_path)

    # --------------------------------------------------------
    # Reports
    # --------------------------------------------------------

    print("\n========================================")
    print("RESULT")
    print("========================================")

    print(
        f"ATT&CK techniques with D3FEND action evidence: "
        f"{int((Y.sum(axis=1) > 0).sum())} "
        f"/ {len(Y)}"
    )

    print(
        f"Total ATT&CK techniques represented: "
        f"{len(Y)}"
    )

    print("\nAction positive rates:")

    print(
        (Y.mean() * 100)
        .round(1)
        .rename("positive_%")
        .to_string()
    )

    print("\nAction evidence counts:")

    print(
        E.sum()
        .sort_values(ascending=False)
        .to_string()
    )

    print("\nFiles created:")

    print(
        counts_path
    )

    print(
        y_path
    )

    print("\nD3FEND labels not connected to our reviewed mapping:")

    print(
        f"{len(unresolved_d3fend)} "
        f"unique D3FEND techniques"
    )

    print(
        list(unresolved_d3fend)[:20]
    )


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":

    coverage_report()

    if len(sys.argv) > 1:

        build_from_csv(
            sys.argv[1]
        )

    else:

        print(
            "\nNo CSV supplied."
        )

        print(
            "Coverage check completed only."
        )

        print(
            "\nTo build D3FEND evidence:"
        )

        print(
            "python d3fend_map.py "
            "d3fend-full-mappings.csv"
        )