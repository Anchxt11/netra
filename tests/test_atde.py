"""ATDE parity (build plan B1): ml/atde/predict.py reproduces ml/model1/samples.jsonl exactly.

Needs the ML libraries at the bundle's versions (root requirements.txt); skipped otherwise.
"""
import json
from pathlib import Path

import pytest

pytest.importorskip("sklearn")
pytest.importorskip("shap")
pd = pytest.importorskip("pandas")

from ml.atde.predict import ATDE, UNKNOWN  # noqa: E402

SAMPLES = [json.loads(l) for l in (Path(__file__).resolve().parents[1] / "ml/model1/samples.jsonl").read_text().splitlines() if l.strip()]
WINDOW = ("cnt_", "nports_", "ndst_")


@pytest.fixture(scope="module")
def atde():
    return ATDE()


def test_every_sample_reproduces_its_score_and_verdict(atde):
    assert len(SAMPLES) == 100
    for stream in ("aws_vpc_flow_log", "cisco_asa"):
        rows = [s for s in SAMPLES if s["stream_name"] == stream]
        X = pd.DataFrame([s["features"] for s in rows])
        out = atde.score_features(X, stream, [s["event_id"] for s in rows])
        for s, r in zip(rows, out):
            assert r["anomaly_score"] == s["anomaly_score"], (stream, s["event_id"])
            assert r["is_anomaly"] == s["is_anomaly"], (stream, s["event_id"])


def test_preprocess_rebuilds_each_samples_own_fields(atde):
    """From the raw message alone, every feature that does not need history matches the sample.
    The rolling counts (cnt_/nports_/ndst_) need the preceding 600 s or 3600 s of rows, which the
    samples file does not include, so they are checked in the first test through the stored values."""
    for s in SAMPLES:
        X = atde.features([{k: s[k] for k in ("stream_name", "timestamp", "event_id", "message_sanitized")}])
        for name, want in s["features"].items():
            if not name.startswith(WINDOW):
                assert float(X.iloc[0][name]) == pytest.approx(want), (s["event_id"], name)


def test_results_have_family_probability_and_reasons(atde):
    s = next(s for s in SAMPLES if s["is_anomaly"])
    r = atde.score_features(pd.DataFrame([s["features"]]), s["stream_name"], [s["event_id"]])[0]
    assert r["family"] == UNKNOWN and r["probability"] is None and "packet and byte split" in r["family_note"]
    assert 1 <= len(r["reasons"]) <= 3 and all(x["contribution"] > 0 for x in r["reasons"])
    assert r["model"] == "atde-1.0.0"


def test_xgboost_runs_when_flow_counts_exist(atde):
    s = next(s for s in SAMPLES if s["is_anomaly"])
    flows = {s["event_id"]: {"src_packets": 1, "dst_packets": 0, "src_bytes": 40, "dst_bytes": 0, "proto": "tcp"}}
    r = atde.score_features(pd.DataFrame([s["features"]]), s["stream_name"], [s["event_id"]], flows)[0]
    assert r["probability"] is not None and (r["family"] in atde.classes or r["family"] == UNKNOWN)
