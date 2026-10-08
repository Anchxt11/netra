
import json
import joblib
import numpy as np
import pandas as pd
from pathlib import Path


# ============================================================
# LOAD TRAINED CRIE ARTIFACT
# ============================================================

BASE_DIR = Path(__file__).resolve().parent
ARTIFACT_PATH = BASE_DIR / "crie_model.joblib"

_artifact = joblib.load(ARTIFACT_PATH)

baseline_model = _artifact["baseline_model"]
tfidf = _artifact["tfidf"]
mlb_tactic = _artifact["mlb_tactic"]

dataset = _artifact["dataset"]
technique_to_index = _artifact["technique_to_index"]

action_columns = _artifact["action_columns"]
action_names = _artifact["action_names"]
action_to_phase = _artifact["action_to_phase"]
action_requirements = _artifact["action_requirements"]

disruptive_min_severity = _artifact["disruptive_min_severity"]
severity_rank = _artifact["severity_rank"]

E_all_clean = _artifact["E_all_clean"]

Y_attack_aligned = _artifact["Y_attack_aligned"]
Y_elastic_aligned = _artifact["Y_elastic_aligned"]
Y_d3fend_aligned = _artifact["Y_d3fend_aligned"]

family_crosswalk = _artifact["family_crosswalk"]

CRIE_EVIDENCE_WEIGHT = _artifact["CRIE_EVIDENCE_WEIGHT"]
CRIE_ML_WEIGHT = _artifact["CRIE_ML_WEIGHT"]


# ============================================================
# CRIE SAFETY DEFAULTS & CONFIGURATION
# ============================================================

DEFAULT_CRIE_CONFIG = {
    "severity_mapper": True,
    "benign_suppression": True,
    "unknown_to_manual": True,
    "human_approval_required": True,
    "insufficient_evidence_threshold": 0.10,  # X: top evidence score below X triggers fallback
    "min_required_fixes": 3,
    "require_critical_containment": True,  # Severity 5 requires at least 1 containment action
}

CONTAINMENT_PHASES = {"containment"}
CONTAINMENT_KEYWORDS = ("block", "isolate", "lock", "disable")


def is_containment_action(action_id: str, action_to_phase_map: dict | None = None) -> bool:
    """Determine whether an action is a containment action (block, isolate, lock, or disable)."""
    if action_to_phase_map is None:
        action_to_phase_map = action_to_phase
    if action_to_phase_map.get(action_id) in CONTAINMENT_PHASES:
        return True
    return any(kw in action_id for kw in CONTAINMENT_KEYWORDS)


def normalize_severity(severity_input) -> tuple[str, int]:
    """Map any input severity representation to canonical (name, int_rank 1..5)."""
    if severity_input is None:
        return ("medium", 3)
    if isinstance(severity_input, (int, float)):
        val = int(severity_input)
        val = max(1, min(5, val))
        name_map = {1: "info", 2: "low", 3: "medium", 4: "high", 5: "critical"}
        return (name_map[val], val)
    s = str(severity_input).strip().lower()
    if s.isdigit():
        val = max(1, min(5, int(s)))
        name_map = {1: "info", 2: "low", 3: "medium", 4: "high", 5: "critical"}
        return (name_map[val], val)
    word_map = {
        "info": ("info", 1),
        "informational": ("info", 1),
        "low": ("low", 2),
        "medium": ("medium", 3),
        "warning": ("medium", 3),
        "high": ("high", 4),
        "alert": ("high", 4),
        "critical": ("critical", 5),
    }
    return word_map.get(s, ("medium", 3))


# ============================================================
# MODEL 1 FAMILY NORMALIZATION
# ============================================================

FAMILY_ALIASES = {
    "Reconnaissance / Scanning": "Recon / Scanning"
}


def normalize_attack_family(attack_family):
    if attack_family is None:
        return None

    return FAMILY_ALIASES.get(
        attack_family,
        attack_family
    )


# ============================================================
# FAMILY → ATT&CK TECHNIQUE
# ============================================================

def family_to_attack_technique(
    attack_family,
    crosswalk=None
):
    if crosswalk is None:
        crosswalk = family_crosswalk

    if attack_family not in crosswalk:
        return {
            "attack_family": attack_family,
            "technique_id": None,
            "tactic": None,
            "primary_candidates": [],
            "secondary_candidates": [],
            "mapping_found": False
        }

    mapping = crosswalk[attack_family]

    primary = mapping.get("primary", [])
    secondary = mapping.get("secondary", [])

    return {
        "attack_family": attack_family,
        "technique_id": primary[0] if primary else None,
        "tactic": mapping.get("tactic"),
        "primary_candidates": primary,
        "secondary_candidates": secondary,
        "mapping_found": bool(primary)
    }


# ============================================================
# MODEL 1 → CRIE ADAPTER
# ============================================================

def model1_to_crie(
    model1_result,
    crosswalk=None,
    alert_context=None,
    top_k=3
):
    if crosswalk is None:
        crosswalk = family_crosswalk

    if not isinstance(model1_result, dict):
        return {
            "success": False,
            "error": "Model 1 result must be a dictionary."
        }

    is_attack = model1_result.get(
        "is_attack",
        model1_result.get("is_anomaly", False)
    )

    if not is_attack:
        return {
            "success": False,
            "skipped": True,
            "reason": "Model 1 classified event as benign."
        }

    if model1_result.get("is_unknown", False):
        return {
            "success": False,
            "skipped": True,
            "reason": "Model 1 classified attack family as UNKNOWN/NOVEL.",
            "model1_result": model1_result
        }

    attack_family = model1_result.get("attack_family")

    confidence = model1_result.get(
        "confidence",
        model1_result.get("family_confidence", 1.0)
    )

    severity = model1_result.get(
        "severity",
        "medium"
    )

    if attack_family is None:
        return {
            "success": False,
            "error": "Model 1 did not provide attack_family."
        }

    confidence = float(confidence)

    canonical_family = normalize_attack_family(
        attack_family
    )

    if canonical_family not in crosswalk:
        return {
            "success": False,
            "error": (
                f"No CRIE crosswalk mapping for "
                f"Model 1 family: {attack_family}"
            ),
            "canonical_family": canonical_family
        }

    mapping = family_to_attack_technique(
        canonical_family,
        crosswalk
    )

    technique_id = mapping["technique_id"]

    if technique_id is None:
        return {
            "success": False,
            "error": (
                f"No ATT&CK technique found for "
                f"family: {canonical_family}"
            )
        }

    crie_result = final_crie_inference(
        technique_id=technique_id,
        severity=severity,
        confidence=confidence,
        alert_context=alert_context,
        top_k=top_k
    )

    if isinstance(crie_result, dict):

        crie_result["model1_attack_family"] = attack_family
        crie_result["model1_canonical_family"] = canonical_family
        crie_result["model1_confidence"] = confidence
        crie_result["model1_severity"] = severity

        if "if_score" in model1_result:
            crie_result["model1_if_score"] = model1_result["if_score"]

        if "top3" in model1_result:
            crie_result["model1_top3"] = model1_result["top3"]

        crie_result["family_mapping"] = mapping

    return {
        "success": True,
        "attack_family": attack_family,
        "canonical_family": canonical_family,
        "technique_id": technique_id,
        "severity": severity,
        "confidence": confidence,
        "crie_result": crie_result
    }


# ============================================================
# CRIE INFERENCE
# ============================================================

def final_crie_inference(
    technique_id,
    severity="medium",
    confidence=1.0,
    alert_context=None,
    top_k=3,
    config=None
):
    """
    Standalone CRIE inference entry point.

    Returns ranked remediation recommendations.
    """
    cfg = dict(DEFAULT_CRIE_CONFIG)
    if config:
        cfg.update(config)

    canonical_sev_name, numeric_sev = normalize_severity(severity)
    severity = canonical_sev_name

    if technique_id not in technique_to_index:
        return {
            "technique_id": technique_id,
            "severity": severity,
            "confidence": confidence,
            "fallback_used": True,
            "fallback_level": "unknown_technique",
            "recommendations": [],
            "human_approval_required": True,
        }

    idx = technique_to_index[technique_id]

    # --------------------------------------------------------
    # Text + tactic ML prediction
    # --------------------------------------------------------

    row = dataset.iloc[idx]

    text = (
        str(row.get("technique_name", "")) + " " +
        str(row.get("description", ""))
    )

    X_text = tfidf.transform([text])

    tactic_value = row.get("tactic", "")

    if pd.isna(tactic_value):
        tactic_value = ""

    try:
        tactic_features = mlb_tactic.transform(
            [[tactic_value]]
        )
    except Exception:
        tactic_features = np.zeros(
            (1, len(mlb_tactic.classes_))
        )

    from scipy.sparse import hstack

    X = hstack([
        X_text,
        tactic_features
    ])

    ml_probability = baseline_model.predict_proba(X)[0]

    # --------------------------------------------------------
    # Evidence
    # --------------------------------------------------------

    evidence_row = np.asarray(
        E_all_clean[idx],
        dtype=float
    )

    # --------------------------------------------------------
    # Hybrid score
    # --------------------------------------------------------

    scores = (
        CRIE_EVIDENCE_WEIGHT * evidence_row +
        CRIE_ML_WEIGHT * ml_probability
    )

    # --------------------------------------------------------
    # Feasibility helpers
    # --------------------------------------------------------

    def has_value(key):
        if alert_context is None:
            return False

        value = alert_context.get(key)

        if value is None:
            return False

        if isinstance(value, str):
            return bool(value.strip())

        return True

    def action_is_feasible(action_id):
        requirements = action_requirements.get(
            action_id,
            []
        )

        if not requirements:
            return True

        for requirement in requirements:

            if "|" in requirement:
                alternatives = requirement.split("|")

                if not any(
                    has_value(x)
                    for x in alternatives
                ):
                    return False

            elif not has_value(requirement):
                return False

        return True

    # --------------------------------------------------------
    # Severity gating
    # --------------------------------------------------------

    def severity_allows_action(action_id):

        minimum = disruptive_min_severity.get(
            action_id
        )

        if minimum is None:
            return True

        current_rank = severity_rank.get(
            severity,
            severity_rank.get("medium", 2)
        )

        minimum_rank = severity_rank.get(
            minimum,
            1
        )

        return current_rank >= minimum_rank

    # --------------------------------------------------------
    # Rank actions
    # --------------------------------------------------------

    results = []

    for i, action_id in enumerate(action_columns):

        feasible = action_is_feasible(action_id)

        severity_allowed = severity_allows_action(
            action_id
        )

        if not feasible or not severity_allowed:
            continue

        score = float(scores[i])

        evidence_score = float(
            evidence_row[i]
        )

        ml_prob = float(
            ml_probability[i]
        )

        results.append({
            "action_id": action_id,
            "label": action_names.get(
                action_id,
                action_id
            ),
            "score": score,
            "ml_probability": ml_prob,
            "evidence_score": evidence_score,
            "phase": action_to_phase.get(
                action_id
            ),
            "feasible": feasible,
            "severity_allowed": severity_allowed
        })

    # --------------------------------------------------------
    # Insufficient evidence check (Step 1)
    # --------------------------------------------------------

    ev_threshold = float(cfg.get("insufficient_evidence_threshold", 0.10))
    min_fixes = int(cfg.get("min_required_fixes", top_k))
    max_ev = max((item["evidence_score"] for item in results), default=0.0)

    if len(results) < min_fixes or max_ev < ev_threshold:
        return {
            "technique_id": technique_id,
            "severity": severity,
            "confidence": confidence,
            "fallback_used": True,
            "fallback_level": "insufficient_evidence",
            "fallback_reason": (
                f"Top evidence score {max_ev:.4f} is below threshold {ev_threshold}"
                if max_ev < ev_threshold
                else f"Fewer than {min_fixes} feasible actions ({len(results)} available)"
            ),
            "recommendations": [],
            "human_approval_required": True,
        }

    results.sort(
        key=lambda x: x["score"],
        reverse=True
    )

    # --------------------------------------------------------
    # Containment for critical incidents (Step 2)
    # --------------------------------------------------------

    containment_status_reason = None
    if (numeric_sev == 5 or severity == "critical") and cfg.get("require_critical_containment", True):
        initial_top = results[:top_k]
        has_containment = any(
            is_containment_action(item["action_id"])
            for item in initial_top
        )
        if not has_containment:
            remaining = results[top_k:]
            containment_candidates = [
                item for item in remaining
                if is_containment_action(item["action_id"])
            ]
            if containment_candidates:
                # Promote highest-scoring feasible containment candidate to replace the last slot in top_k
                results = results[:top_k - 1] + [containment_candidates[0]]
            else:
                containment_status_reason = "No containment action feasible for this technique"

    results = results[:top_k]

    # --------------------------------------------------------
    # Add ranks / provenance / approval
    # --------------------------------------------------------

    recommendations = []

    for rank, item in enumerate(
        results,
        start=1
    ):

        provenance = []

        if item["evidence_score"] >= 0.45:
            provenance.append("MITRE ATT&CK")

        if item["evidence_score"] >= 0.70:
            provenance.append("Elastic Detection Rules")

        if item["evidence_score"] > 0:
            provenance.append("D3FEND")

        if item["evidence_score"] > 0 and item["ml_probability"] >= 0.5:
            rationale = (
                "Strong knowledge-base evidence supports "
                "this remediation action, reinforced by "
                "the ML score."
            )

        elif item["ml_probability"] >= 0.5:
            rationale = (
                "The ML model assigns strong applicability "
                "probability, with additional knowledge-base "
                "support."
            )

        elif item["evidence_score"] > 0:
            rationale = (
                "Knowledge-base evidence supports this "
                "remediation action."
            )

        else:
            rationale = (
                "The action is ranked by the ML model "
                "despite limited explicit evidence."
            )

        rec = {
            "rank": rank,
            "action_id": item["action_id"],
            "label": item["label"],
            "score": round(item["score"], 4),
            "ml_probability": round(
                item["ml_probability"],
                4
            ),
            "evidence_score": round(
                item["evidence_score"],
                4
            ),
            "phase": item["phase"],
            "provenance": provenance,
            "feasible": item["feasible"],
            "human_approval_required": True,
            "source": "hybrid_ml_evidence",
            "rationale": rationale
        }
        if containment_status_reason:
            rec["containment_status_reason"] = containment_status_reason
        recommendations.append(rec)

    return {
        "technique_id": technique_id,
        "severity": severity,
        "confidence": confidence,
        "fallback_used": False,
        "fallback_level": None,
        "recommendations": recommendations,
        "human_approval_required": True,
    }


# ============================================================
# STANDALONE SMOKE TEST
# ============================================================

if __name__ == "__main__":

    test_model1 = {
        "attack_family": "Credential Attack / Brute Force",
        "confidence": 0.92,
        "severity": "high",
        "is_attack": True,
        "is_anomaly": True,
        "is_unknown": False,
        "if_score": 0.91,
        "top3": []
    }

    result = model1_to_crie(
        test_model1,
        alert_context={
            "src_ip": "10.0.0.5",
            "username": "admin",
            "host": "server-01"
        }
    )

    print(json.dumps(
        result,
        indent=2,
        default=str
    ))
