"""ml-scorer (build plan B2) on recorded rows: model 1's own held-out flow lines (samples.jsonl) and an
HTTP event as events.enriched carries it. Needs the ML libraries at the bundle's versions; skipped otherwise."""
import json
from pathlib import Path

import pytest

pytest.importorskip("sklearn")
pytest.importorskip("shap")

from ml.atde.predict import ATDE  # noqa: E402
from ml_scorer.core import Scorer, severity  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = [json.loads(l) for l in (ROOT / "ml/model1/samples.jsonl").read_text().splitlines() if l.strip()]
FLOW_KEYS = ("stream_name", "timestamp", "event_id", "message_sanitized")
HTTP_EVENT = {  # events.enriched, as the processor writes it for a Juice Shop login (contracts/LIVE_API.md 3.4)
    "event_id": "7d9a3c2e-1b4f-4e8a-9c61-0f2d5b8e4a17", "event_ts": "2026-10-07T09:15:02.417Z", "source": "juice-shop",
    "user": "admin@juice-sh.op", "ip": "172.30.0.10", "event_type": "login", "severity": "low", "status": "failure",
    "host": "juice-shop", "bytes_out": 26, "process": "", "method": "POST", "path": "/rest/user/login",
    "http_status": 401, "user_agent": "hydra", "response_ms": 12, "features": {}, "risk_score": 0.1,
    "rule_hits": ["brute_force"], "processed_ts": "2026-10-07T09:15:02.431Z"}


@pytest.fixture(scope="module")
def atde():
    return ATDE()


def flows(stream):
    return sorted(({k: s[k] for k in FLOW_KEYS} for s in SAMPLES if s["stream_name"] == stream),
                  key=lambda r: (r["timestamp"], r["event_id"]))


def test_http_events_are_not_scored_and_never_get_a_made_up_score(atde):
    sc = Scorer(atde)
    alerts, scores = sc.batch([HTTP_EVENT, {**HTTP_EVENT, "rule_hits": []}], now=0)
    assert (alerts, scores) == ([], [])
    assert sc.totals == {"scored": 0, "not_scorable": 2, "alerts": 0}


def test_every_flow_row_is_scored_and_anomalies_raise_contract_alerts(atde):
    sc = Scorer(atde, cooldown_s=0)
    rows = flows("aws_vpc_flow_log")
    alerts, scores = sc.batch(rows, now=0)
    assert len(scores) == len(rows) and {s["model"] for s in scores} == {"atde-1.0.0"}
    anomalous = {s["event_id"] for s in scores if s["is_anomaly"]}
    assert {a["event_ids"][0] for a in alerts} == anomalous and anomalous
    a = alerts[0]
    assert a["rule_id"] is None and a["model"] == "atde-1.0.0" and a["severity"] == "low"
    assert a["class"] == "anomaly" and a["probability"] is None and 0 <= a["risk_score"] <= 1
    msg = next(r["message_sanitized"] for r in rows if str(r["event_id"]) == a["event_ids"][0]).split()
    assert (a["ip"], a["host"], a["user"]) == (msg[3], msg[4], "-")
    assert 1 <= len(a["reasons"]) <= 3 and all({"feature", "value", "contribution", "sentence", "baseline"} <= set(r) for r in a["reasons"])


def test_ai_only_alerts_wait_a_minute_per_source_address(atde):
    sc = Scorer(atde, cooldown_s=60)
    rows = flows("aws_vpc_flow_log")
    alerts, scores = sc.batch(rows, now=0)
    srcs = [a["ip"] for a in alerts]
    assert len(srcs) == len(set(srcs))  # at most one per address in the minute
    again, _ = sc.batch(rows, now=30)
    assert again == []
    later, _ = sc.batch(rows, now=61)
    assert later


def test_a_rule_flagged_row_always_gets_the_models_view(atde):
    sc = Scorer(atde, cooldown_s=60)
    rows = flows("cisco_asa")
    _, scores = sc.batch(rows, now=0)
    calm = next(r for r, s in zip(rows, scores) if not s["is_anomaly"])
    sc2 = Scorer(atde, cooldown_s=60)
    alerts, _ = sc2.batch([{**calm, "rule_hits": ["web_scan"]}], now=0)
    assert len(alerts) == 1 and alerts[0]["rule_flagged"] is True


def test_rolling_features_carry_across_micro_batches(atde):
    rows = flows("aws_vpc_flow_log")
    _, whole = Scorer(atde).batch(rows, now=0)
    sc = Scorer(atde)
    parts = []
    for i in range(0, len(rows), 7):
        parts += sc.batch(rows[i:i + 7], now=0)[1]
    assert [s["anomaly_score"] for s in parts] == [s["anomaly_score"] for s in whole]


def test_severity_never_critical_from_the_model_alone():
    assert severity("UNKNOWN", None) == "low"
    assert severity("DoS / Flooding", 0.95) == "high"
    assert severity("DoS / Flooding", 0.8) == "medium"
    assert "critical" not in {severity("x", p) for p in (0.5, 0.8, 0.99, 1.0)}


# ── Task 1 addition: source field forwarding ───────────────────────────────────

def test_replay_source_field_forwarded_to_alerts_and_scores(atde):
    """A row that carries source='replay' must propagate that value to both the
    alert dict and the ml_scores dict so the dashboard can tag replayed data."""
    sc = Scorer(atde, cooldown_s=0)
    replay_rows = [{**r, "source": "replay"} for r in flows("aws_vpc_flow_log")]
    alerts, scores = sc.batch(replay_rows, now=0)
    assert scores, "no scores produced — check the fixture"
    assert all(s.get("source") == "replay" for s in scores), \
        "at least one score row is missing source='replay'"
    for a in alerts:
        assert a.get("source") == "replay", f"alert {a['alert_id']} missing source='replay'"


def test_live_rows_without_source_field_produce_no_source_key(atde):
    """Live (non-replay) rows have no source field; the output must not invent one."""
    sc = Scorer(atde, cooldown_s=0)
    live_rows = [{k: v for k, v in r.items() if k != "source"} for r in flows("aws_vpc_flow_log")]
    alerts, scores = sc.batch(live_rows, now=0)
    for s in scores:
        assert "source" not in s, f"score row has unexpected source key: {s.get('source')!r}"
    for a in alerts:
        assert "source" not in a, f"alert has unexpected source key: {a.get('source')!r}"
