
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
    top_k=3
):
    """
    Standalone CRIE inference entry point.

    Returns ranked remediation recommendations.
    """

    if technique_id not in technique_to_index:
        return {
            "technique_id": technique_id,
            "severity": severity,
            "confidence": confidence,
            "fallback_used": True,
            "fallback_level": "unknown_technique",
            "recommendations": []
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
            severity_rank.get("medium", 1)
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

    results.sort(
        key=lambda x: x["score"],
        reverse=True
    )

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

        recommendations.append({
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
        })

    return {
        "technique_id": technique_id,
        "severity": severity,
        "confidence": confidence,
        "fallback_used": False,
        "fallback_level": None,
        "recommendations": recommendations
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
