"""
End-to-End Smoke Test: Model 1 -> Model 2 Integration.

Exercises real Model 1 inference (Isolation Forest + XGBoost), passes results
through Model 2 CRIE remediation recommendation engine, and validates the
combined application/API output contract.
"""

import json
import sys
from pathlib import Path

# Ensure repo root and src are on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from src.if_stage import IFStage
from src.xgb_stage import XGBStage
from src.score import Detector, score_event
from model_2_temp.crie_deployment.crie_engine import model1_to_crie


def run_smoke_test():
    print("=" * 70)
    print("MODEL 1 -> MODEL 2 APPLICATION INTEGRATION SMOKE TEST")
    print("=" * 70)

    # 1. Initialize live stages with real trained models
    print("\n[1/6] Loading live Model 1 and Model 2 components...")
    if_aws = IFStage("aws_vpc_flow_log", model_dir=str(REPO_ROOT / "models"))
    xgb_stage = XGBStage(model_dir=str(REPO_ROOT / "models"))
    detector = Detector(if_stage=if_aws, xgb_stage=xgb_stage)
    print(f"  Detector initialized: version={detector.version}")
    print(f"  IF features expected: {len(if_aws.features)}")
    print(f"  XGB features expected: {xgb_stage.model.n_features_in_}")
    print("  Model 2 CRIE engine loaded successfully.")

    # Load sample fixtures
    samples = [json.loads(line) for line in open(REPO_ROOT / "ml/model1/samples.jsonl")]
    s_anom = samples[0]    # Anomaly flow sample
    s_benign = samples[2]  # Normal / benign flow sample
    xgb_samples = json.loads((REPO_ROOT / "tests/samples.json").read_text())

    # -------------------------------------------------------------
    # Test 1: Real Benign Event
    # -------------------------------------------------------------
    print("\n[2/6] Testing real benign traffic...")
    event_benign = {
        "event_id": 1001,
        "ts": "2026-10-07T12:00:00Z",
        "src_ip": "10.0.0.10",
        "dst_ip": "10.0.0.20",
        "src_packets": 10,
        "dst_packets": 10,
        "src_bytes": 400,
        "dst_bytes": 400,
        "proto": "tcp",
        **s_benign["features"],
    }

    res_benign = detector.score_event(event_benign)
    print(f"  is_attack={res_benign['is_attack']}, label={res_benign['label']}, if_score={res_benign['if_score']}")
    print(f"  remediation={res_benign['remediation']}")

    assert not res_benign["is_attack"], "Benign event should have is_attack=False"
    assert res_benign["label"] == "benign", "Benign event should have label='benign'"
    assert res_benign["remediation"] is None, "Benign event should have remediation=None"

    # Adapter safety check on benign
    direct_benign = model1_to_crie(res_benign)
    assert direct_benign["skipped"] is True
    assert direct_benign["success"] is False
    print("  PASS: Benign contract preserved, remediation safely omitted.")

    # -------------------------------------------------------------
    # Test 2: Real Known Attack Event (Exploitation / RCE)
    # -------------------------------------------------------------
    print("\n[3/6] Testing real known attack traffic (Exploitation / RCE)...")
    event_known = {
        "event_id": 2001,
        "ts": "2026-10-07T12:01:00Z",
        "src_ip": "192.168.1.100",
        "dst_ip": "10.0.0.50",
        "proto": "tcp",
        **xgb_samples["known"],
        **s_anom["features"],
    }

    res_known = detector.score_event(
        event_known,
        alert_context={"src_ip": "192.168.1.100", "host": "web-prod-01"}
    )
    print(f"  is_attack={res_known['is_attack']}, label={res_known['label']}")
    print(f"  attack_family={res_known['attack_family']} (conf={res_known['family_confidence']:.4f})")
    assert res_known["is_attack"], "Attack event should have is_attack=True"
    assert res_known["label"] == "attack", "Known attack should have label='attack'"
    assert res_known["attack_family"] == "Exploitation / RCE"
    assert res_known["remediation"] is not None, "Attack event must include remediation"

    rem = res_known["remediation"]
    assert rem["success"] is True, "Remediation must succeed"
    assert rem["technique_id"] == "T1190", f"Expected T1190, got {rem['technique_id']}"
    recs = rem["crie_result"]["recommendations"]
    assert len(recs) > 0, "Remediation must contain ranked recommendations"
    print(f"  Technique mapped: {rem['technique_id']}")
    print(f"  Top recommendations ({len(recs)}):")
    for r in recs:
        print(f"    - Rank {r['rank']}: {r['label']} (id={r['action_id']}, score={r['score']:.4f}, phase={r['phase']})")
    print("  PASS: Known attack correctly classified and Model 2 remediation attached.")

    # -------------------------------------------------------------
    # Test 3: Real Unknown / Novel Attack Event
    # -------------------------------------------------------------
    print("\n[4/6] Testing real novel/unknown traffic (low confidence)...")
    event_unknown = {
        "event_id": 3001,
        "ts": "2026-10-07T12:02:00Z",
        "src_ip": "192.168.1.200",
        "dst_ip": "10.0.0.60",
        "proto": "other",
        **xgb_samples["unknown"],
        **s_anom["features"],
    }

    res_unknown = detector.score_event(event_unknown)
    print(f"  is_attack={res_unknown['is_attack']}, label={res_unknown['label']}")
    print(f"  attack_family={res_unknown['attack_family']}, closest={res_unknown['closest_family']}")
    print(f"  is_unknown={res_unknown['is_unknown']}, remediation={res_unknown['remediation']}")

    assert res_unknown["is_attack"], "Novel event should be flagged anomalous (is_attack=True)"
    assert res_unknown["label"] == "suspicious", "Novel event label should be 'suspicious'"
    assert res_unknown["attack_family"] == "UNKNOWN/NOVEL"
    assert res_unknown["is_unknown"] is True
    assert res_unknown["remediation"] is None, "Novel classification must NOT invent remediation"

    # Adapter safety check on unknown
    direct_unknown = model1_to_crie(res_unknown)
    assert direct_unknown["skipped"] is True
    assert direct_unknown["success"] is False
    print("  PASS: Unknown/novel traffic handled safely without inventing techniques.")

    # -------------------------------------------------------------
    # Test 4: Backend Rule Hit Event
    # -------------------------------------------------------------
    print("\n[5/6] Testing backend rule hit with remediation...")
    rule_hit = {
        "rule_id": "SIGMA-BRUTE-FORCE-001",
        "category": "Credential Attack / Brute Force",
        "severity": "high",
    }
    res_rule = detector.score_event(
        event_benign,
        rule_hit=rule_hit,
        alert_context={"username": "root", "src_ip": "10.0.0.10"}
    )
    print(f"  detected_by={res_rule['detected_by']}, attack_family={res_rule['attack_family']}")
    assert res_rule["detected_by"] == "rule"
    assert res_rule["remediation"] is not None
    assert res_rule["remediation"]["success"] is True
    assert res_rule["remediation"]["technique_id"] == "T1110"
    print(f"  Technique mapped: {res_rule['remediation']['technique_id']}")
    print("  PASS: Rule hit successfully mapped to Model 2 remediation.")

    # -------------------------------------------------------------
    # Test 5 & 6: Functional Convenience & JSON Serializability
    # -------------------------------------------------------------
    print("\n[6/6] Testing functional score_event() and JSON serializability...")
    func_result = score_event(
        event_known,
        if_stage=if_aws,
        xgb_stage=xgb_stage,
        alert_context={"src_ip": "192.168.1.100"}
    )
    assert func_result["remediation"]["success"] is True

    # Validate full JSON serializability
    json_payload = json.dumps(func_result, indent=2)
    assert len(json_payload) > 0
    parsed = json.loads(json_payload)
    assert parsed["event_id"] == 2001
    assert "remediation" in parsed
    print(f"  Output JSON size: {len(json_payload)} bytes")
    print("  PASS: score_event() functional entry point and JSON output validated.")

    print("\n" + "=" * 70)
    print("ALL INTEGRATION SMOKE TESTS PASSED SUCCESSFULLY!")
    print("=" * 70)


if __name__ == "__main__":
    run_smoke_test()
