"""ATDE parity (build plan B1): ml/atde/predict.py reproduces ml/model1/samples.jsonl exactly.

Needs the ML libraries at the bundle's versions (root requirements.txt); skipped otherwise.
"""
import json
from pathlib import Path


import pytest

pytest.importorskip("sklearn")
pytest.importorskip("shap")
pd = pytest.importorskip("pandas")
np = pytest.importorskip("numpy")

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


ROOT = Path(__file__).resolve().parents[1]
STREAMS = ("aws_vpc_flow_log", "cisco_asa")


def test_risk_score_rises_with_the_anomaly_score_and_stays_in_0_1(atde):
    """The calibrated risk score (percentile rank among benign validation rows) never falls as the raw
    anomaly score rises, and is always between 0 and 1. samples.jsonl keeps checking the raw score."""
    for stream in STREAMS:
        ref = atde.reference[stream]
        grid = sorted(set(np.linspace(ref.min() - 0.1, ref.max() + 0.1, 2001).round(6)) | set(ref.tolist()))
        risk = [atde.risk_score(stream, a) for a in grid]
        assert all(0.0 <= r <= 1.0 for r in risk), stream
        assert all(b >= a for a, b in zip(risk, risk[1:])), stream
        assert risk[0] == 0.0 and risk[-1] == 1.0, stream
    rows = [s for s in SAMPLES if s["stream_name"] == "cisco_asa"]
    out = atde.score_features(pd.DataFrame([s["features"] for s in rows]), "cisco_asa", [s["event_id"] for s in rows])
    by_score = sorted(out, key=lambda r: r["anomaly_score"])
    assert all(b["risk_score"] >= a["risk_score"] for a, b in zip(by_score, by_score[1:]))
    assert all(r["above_alert_cutoff"] == (r["anomaly_score"] > atde.alert_cutoff["cisco_asa"]) for r in out)


def test_alert_cutoff_gives_about_1_percent_false_alarms_on_benign_validation_rows(atde):
    """The reference scores are the benign validation rows' scores: at the cutoff about 1% of them alert."""
    cal = atde.thresholds["calibration"]
    for stream in STREAMS:
        ref = atde.reference[stream]
        assert len(ref) == cal[stream]["n_reference"] and (np.diff(ref) >= 0).all()
        far = float((ref > atde.alert_cutoff[stream]).mean())
        assert 0.005 <= far <= 0.0105, (stream, far)
        assert far == pytest.approx(cal[stream]["false_alarm_rate_on_reference"], abs=1e-4)


def test_reference_scores_match_the_validation_split_when_available(atde):
    """With data/interim/pool_split.parquet (on the ML laptop), the stored reference is exactly the saved
    models' scores on the benign validation rows, with features built over each stream's full history."""
    path = ROOT / "data/interim/pool_split.parquet"
    if not path.exists():
        pytest.skip("data/interim/pool_split.parquet is not in the repo (ML laptop)")
    d = pd.read_parquet(path)
    for stream in STREAMS:
        g = d[d.stream_name == stream].reset_index(drop=True)
        X = atde.features(g[["stream_name", "timestamp", "event_id", "message_sanitized"]], stream)
        ref_idx = g.index[(g.split == "val") & (g.label_binary.str.lower() != "malicious")]
        got = np.sort([r["anomaly_score"] for r in atde.score_features(X.loc[ref_idx], stream)])
        assert np.array_equal(got, atde.reference[stream]), stream
