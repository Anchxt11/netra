"""ml-scorer core (build plan B2): one micro-batch of rows -> model alerts and ml_scores rows.

No Redpanda, ClickHouse or Postgres here (see main.py), so tests/test_ml_scorer.py runs it on
recorded rows. Only rows model 1 was trained on are scored: flow records with `stream_name`
aws_vpc_flow_log or cisco_asa and a `message_sanitized` line (docs/ML_INTEGRATION.md). Any other
row, such as an HTTP event from events.enriched, is counted as not scorable and never given a
made-up score. The processor's DummyScorer `risk_score` is never read.
"""
import json
import uuid
from collections import deque
from datetime import datetime, timezone

import pandas as pd

AI_ALERT_COOLDOWN_S = 60  # AI-only alerts: one per source address per minute (precision is low)
HISTORY_MAX_ROWS = 20_000  # per stream; rolling features need the past 600 s (AWS) / 3600 s (Cisco)


def utc_iso(dt: datetime | None = None) -> str:
    return (dt or datetime.now(timezone.utc)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _ts(v) -> pd.Timestamp:
    t = pd.Timestamp(v)
    return t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC")


def severity(family: str, probability: float | None) -> str:
    """contracts/LIVE_API.md 5.1: a model alone never raises critical; an unclassified anomaly is low."""
    if family == "UNKNOWN" or probability is None:
        return "low"
    return "high" if probability >= 0.9 else "medium" if probability >= 0.75 else "low"


def flow_ips(stream: str, message: str) -> tuple[str, str]:
    """(source, destination) from the flow line itself, for the alert's ip and host."""
    if stream == "aws_vpc_flow_log":
        p = message.split()
        return (p[3], p[4]) if len(p) > 4 else ("-", "-")
    import re
    m = re.search(r"src [\w-]+:([\d.]+).*? dst [\w-]+:([\d.]+)", message or "")
    return (m.group(1), m.group(2)) if m else ("-", "-")


class Scorer:
    def __init__(self, atde, cooldown_s: float = AI_ALERT_COOLDOWN_S, history_max: int = HISTORY_MAX_ROWS):
        self.atde = atde
        self.streams = set(atde.pp.FEATURES)
        self.windows = {"aws_vpc_flow_log": 600, "cisco_asa": 3600}
        self.history = {s: deque() for s in self.streams}
        self.cooldown_s, self.history_max = cooldown_s, history_max
        self.last_ai_alert: dict[str, float] = {}
        self.totals = {"scored": 0, "not_scorable": 0, "alerts": 0}

    def scorable(self, row: dict) -> bool:
        return row.get("stream_name") in self.streams and bool(row.get("message_sanitized")) \
            and row.get("timestamp") is not None and row.get("event_id") is not None

    def _keep(self, stream: str, rows: list[dict]):
        """Add this batch to the stream's history, dropping rows older than its longest window."""
        h = self.history[stream]
        h.extend(rows)
        cutoff = _ts(rows[-1]["timestamp"]) - pd.Timedelta(seconds=self.windows[stream])
        while h and (_ts(h[0]["timestamp"]) < cutoff or len(h) > self.history_max):
            h.popleft()

    def batch(self, rows: list[dict], now: float) -> tuple[list[dict], list[dict]]:
        """Score one micro-batch. Returns (alerts for the `alerts` topic, rows for ClickHouse ml_scores)."""
        by_stream: dict[str, list[dict]] = {}
        for r in rows:
            if self.scorable(r):
                by_stream.setdefault(r["stream_name"], []).append(r)
            else:
                self.totals["not_scorable"] += 1
        alerts, scores = [], []
        for stream, part in by_stream.items():
            hist = list(self.history[stream])
            frame = pd.DataFrame([{k: r[k] for k in ("stream_name", "timestamp", "event_id", "message_sanitized")}
                                  for r in hist + part])
            X = self.atde.features(frame, stream).iloc[len(hist):]  # features with history; keep this batch
            results = self.atde.score_features(X, stream, [r["event_id"] for r in part])
            self._keep(stream, part)
            for r, res in zip(part, results):
                self.totals["scored"] += 1
                src, dst = flow_ips(stream, r["message_sanitized"])
                rule_flagged = bool(r.get("rule_hits"))
                risk = round(min(max(res["anomaly_score"], 0.0), 1.0), 4)
                scores.append({
                    "event_id": str(r["event_id"]), "stream_name": stream, "model": res["model"],
                    "scored_ts": utc_iso(), "anomaly_score": res["anomaly_score"], "risk_score": risk,
                    "is_anomaly": int(res["is_anomaly"]), "family": res["family"],
                    "probability": res["probability"], "rule_flagged": int(rule_flagged),
                    "src_ip": src, "reasons": json.dumps(res["reasons"]),
                })
                # A rule already flagged it: attach the model's view so the incident gets a risk score.
                # Not flagged: alert only when anomalous, at most once a minute per source address.
                if not rule_flagged:
                    if not res["is_anomaly"]:
                        continue
                    if now - self.last_ai_alert.get(src, float("-inf")) < self.cooldown_s:
                        continue
                    self.last_ai_alert[src] = now
                alerts.append({
                    "alert_id": str(uuid.uuid4()), "rule_id": None, "model": res["model"],
                    "severity": severity(res["family"], res["probability"]),
                    "event_ids": [str(r["event_id"])], "created_ts": utc_iso(),
                    "ip": r.get("ip") or src, "user": r.get("user") or "-", "host": r.get("host") or dst,
                    "class": "anomaly" if res["family"] == "UNKNOWN" else res["family"],
                    "probability": res["probability"], "anomaly_score": res["anomaly_score"], "risk_score": risk,
                    "reasons": [{**x, "baseline": None} for x in res["reasons"]],
                    "rule_flagged": rule_flagged,
                })
                self.totals["alerts"] += 1
        return alerts, scores
