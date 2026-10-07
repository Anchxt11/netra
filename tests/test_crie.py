"""CRIE (model 2) behind the R0 contract: ml/crie/engine.py on the ML team's engine, unchanged.

There is no samples.jsonl from the notebook yet, so these check the R0 shapes and behaviour, not
the notebook's exact numbers. Needs the pinned packages (api/requirements.txt); skipped otherwise.
"""
import pytest

pytest.importorskip("sklearn")
pytest.importorskip("pyarrow")
pytest.importorskip("dill")

from ml.crie.engine import recommend  # noqa: E402

FIX_KEYS = {"action_id", "name", "d3fend", "confidence", "rank", "reasons", "provenance"}
BASE = {"incident_id": "0131", "attack_type": "brute_force", "mitre_technique": "T1110.001", "severity": 4,
        "detected_by": "rule", "rules": ["brute_force", "suspicious_login"], "model": None,
        "context": {"src_ips": ["172.30.0.10"], "usernames": ["admin@juice-sh.op"], "hosts": ["juice-shop"],
                    "dst_ip": None, "domain": None}}


def check_fixes(out):
    assert set(out) == {"version", "fixes"} and out["version"].startswith("crie-")
    assert [f["rank"] for f in out["fixes"]] == [1, 2, 3]
    for f in out["fixes"]:
        assert set(f) == FIX_KEYS
        assert set(f["d3fend"]) == {"id", "name"} and f["d3fend"]["name"]
        assert 0 <= f["confidence"] <= 1
        assert [r["feature"] for r in f["reasons"]] == ["knowledge_base_evidence", "ml_probability"]
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
    out = recommend({**BASE, "mitre_technique": "T9999.001"})  # a technique CRIE has never seen
    assert out == {"version": out["version"], "fallback": {"technique": "T9999", "mitigations": []}}
    nothing = recommend({**BASE, "mitre_technique": None})  # no technique and no model family
    assert set(nothing) == {"version", "fallback"} and nothing["fallback"]["technique"] is None


def test_severity_gates_disruptive_fixes():
    """The engine's own rule: blocking an address needs at least medium severity."""
    low = recommend({**BASE, "attack_type": "web_scan", "mitre_technique": "T1595.002", "severity": 2})
    assert "block_source_ip" not in {f["action_id"] for f in low.get("fixes", [])}
