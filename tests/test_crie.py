from unittest.mock import patch
import pytest

pytest.importorskip("sklearn")
pytest.importorskip("pyarrow")
pytest.importorskip("dill")

from ml.crie.engine import recommend, _engine  # noqa: E402

FIX_KEYS = {"action_id", "name", "d3fend", "confidence", "rank", "reasons", "provenance", "human_approval_required"}
BASE = {"incident_id": "0131", "attack_type": "brute_force", "mitre_technique": "T1110.001", "severity": 4,
        "detected_by": "rule", "rules": ["brute_force", "suspicious_login"], "model": None,
        "context": {"src_ips": ["172.30.0.10"], "usernames": ["admin@juice-sh.op"], "hosts": ["juice-shop"],
                    "dst_ip": None, "domain": None}}


def check_fixes(out):
    assert {"version", "fixes"} <= set(out) and out["version"].startswith("crie-")
    assert out.get("human_approval_required") is True
    assert [f["rank"] for f in out["fixes"]] == [1, 2, 3]
    for f in out["fixes"]:
        assert set(f) == FIX_KEYS
        assert f.get("human_approval_required") is True
        assert set(f["d3fend"]) == {"id", "name"} and f["d3fend"]["name"]
        assert 0 <= f["confidence"] <= 1
        features = [r["feature"] for r in f["reasons"]]
        assert "knowledge_base_evidence" in features and "ml_probability" in features
        assert f["confidence"] == pytest.approx(sum(r["contribution"] for r in f["reasons"]), abs=2e-4)
    confs = [f["confidence"] for f in out["fixes"]]
    assert confs == sorted(confs, reverse=True)


def test_a_rule_only_incident_gets_three_fixes():
    out = recommend(BASE)  # model: null
    check_fixes(out)
    assert {"reset_credentials", "enable_mfa"} <= {f["action_id"] for f in out["fixes"]}


def test_an_incident_with_model_1_output():
    with_model = {**BASE, "detected_by": "both", "model": {"attack_family": "Credential Attack / Brute Force",
                  "confidence": 0.93, "is_unknown": False, "if_score": 0.61, "top3": []}}
    check_fixes(recommend(with_model))
    # Only model 1's family to go on (no MITRE technique): the family's ATT&CK technique is used.
    check_fixes(recommend({**with_model, "mitre_technique": None}))
    # Model 1 could not name the family: the incident's own technique carries it.
    unknown = {**BASE, "model": {"attack_family": "UNKNOWN", "confidence": None, "is_unknown": True, "if_score": 0.58, "top3": []}}
    check_fixes(recommend(unknown))


def test_the_fallback():
    # Unknown technique
    out = recommend({**BASE, "mitre_technique": "T9999.001"})
    assert out["fallback"] == {"technique": "T9999", "mitigations": []}
    assert out["version"].startswith("crie-") and out.get("human_approval_required") is True

    # No technique and no model family
    nothing = recommend({**BASE, "mitre_technique": None})
    assert "fallback" in nothing and nothing["fallback"]["technique"] is None
    assert nothing.get("human_approval_required") is True

    # Insufficient evidence: technique known in index but 0 knowledge-base evidence (< 0.10)
    insuf = recommend({**BASE, "mitre_technique": "T1687"})
    assert insuf["fallback"] == {"technique": "T1687", "mitigations": []}
    assert insuf.get("human_approval_required") is True


def test_severity_gates_disruptive_fixes():
    """The engine's own rule: blocking an address needs at least medium severity."""
    low = recommend({**BASE, "attack_type": "web_scan", "mitre_technique": "T1595.002", "severity": 2})
    assert "block_source_ip" not in {f["action_id"] for f in low.get("fixes", [])}


def test_severity_5_containment():
    """For severity 5, top 3 must include at least one containment action."""
    e = _engine()
    crit = recommend({**BASE, "severity": 5})
    check_fixes(crit)
    action_ids = [f["action_id"] for f in crit["fixes"]]
    assert any(e.is_containment_action(a) for a in action_ids)
    assert "block_source_ip" in action_ids

    # When no containment action is feasible for that technique, say so in a reason
    with patch.object(e, "is_containment_action", return_value=False):
        crit_none = recommend({**BASE, "severity": 5})
        check_fixes(crit_none)
        for f in crit_none["fixes"]:
            reasons = f["reasons"]
            assert any(r["feature"] == "containment_status" for r in reasons)


def test_safety_benign_suppression():
    """Model 1 classifying event as benign suppresses automated fixes and falls back."""
    benign = recommend({**BASE, "model": {"attack_family": "Benign", "is_attack": False, "confidence": 0.99, "top3": []}})
    assert "fallback" in benign and benign["fallback"]["technique"] is None
    assert benign.get("human_approval_required") is True


def test_safety_unknown_to_manual():
    """Model 1 UNKNOWN family with no rule technique routes to fallback for manual analyst review."""
    unknown = recommend({**BASE, "mitre_technique": None, "model": {"attack_family": "UNKNOWN", "is_unknown": True, "confidence": None, "top3": []}})
    assert "fallback" in unknown and unknown["fallback"]["technique"] is None
    assert unknown.get("human_approval_required") is True
