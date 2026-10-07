"""ml-scorer service (build plan B2): Redpanda in, model alerts out, every score into ClickHouse.

    python -m ml_scorer.main

Reads INPUT_TOPICS (default events.enriched and flows.raw) in 1 s micro-batches, scores the rows
model 1 can read (ml_scorer/core.py), sends model alerts to `alerts` (contracts/LIVE_API.md 5.1),
writes every score to ClickHouse `ml_scores`, and keeps a heartbeat row in Postgres `ml_models`
that the API serves as GET /models and the `models` message, and that the ops health watch checks.
"""
import base64
import json
import logging
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

from confluent_kafka import Consumer, Producer, TopicPartition

from ml.atde.predict import ATDE
from .core import Scorer, utc_iso

BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "redpanda:9092")
TOPICS = [t.strip() for t in os.getenv("INPUT_TOPICS", "events.enriched,flows.raw").split(",") if t.strip()]
ALERT_TOPIC = os.getenv("ALERT_TOPIC", "alerts")
GROUP = os.getenv("ML_SCORER_GROUP_ID", "netra-ml-scorer")
BATCH_S = float(os.getenv("ML_BATCH_SECONDS", "1"))
BATCH_MAX = int(os.getenv("ML_BATCH_MAX", "5000"))
CH_URL = os.getenv("CLICKHOUSE_URL", "http://clickhouse:8123")
CH_AUTH = "Basic " + base64.b64encode(f"{os.getenv('CLICKHOUSE_USER', 'netra')}:{os.getenv('CLICKHOUSE_PASSWORD', 'netra')}".encode()).decode()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://soc:soc@postgres:5432/soc")
HEARTBEAT_FILE = Path(os.getenv("ML_HEARTBEAT_FILE", "/tmp/ml-scorer.alive"))
HEARTBEAT_EVERY_S = 5

ML_SCORES_SQL = """
CREATE TABLE IF NOT EXISTS netra.ml_scores
(
    event_id      String,
    stream_name   LowCardinality(String),
    model         LowCardinality(String),
    scored_ts     DateTime64(3, 'UTC'),
    anomaly_score Float32,
    risk_score    Float32,
    is_anomaly    UInt8,
    family        LowCardinality(String),
    probability   Nullable(Float32),
    rule_flagged  UInt8,
    src_ip        String,
    reasons       String,
    source        LowCardinality(String) DEFAULT ''   -- "replay" for flow-replay rows, empty for live
)
ENGINE = ReplacingMergeTree(scored_ts)
PARTITION BY toDate(scored_ts)
ORDER BY (event_id, model)
TTL toDateTime(scored_ts) + INTERVAL 2 DAY
"""

MODELS_SQL = """
CREATE TABLE IF NOT EXISTS ml_models (
    name              TEXT PRIMARY KEY,
    model_id          TEXT,
    version           TEXT,
    trained_at        TIMESTAMPTZ,
    loaded_at         TIMESTAMPTZ,
    last_heartbeat_at TIMESTAMPTZ,
    detail            TEXT,
    metrics           JSONB,
    scored_per_sec    DOUBLE PRECISION,
    not_scorable_per_sec DOUBLE PRECISION
);
"""

log = logging.getLogger("ml-scorer")


def clickhouse(sql: str, body: bytes | None = None):
    req = urllib.request.Request(f"{CH_URL}/?{urllib.parse.urlencode({'query': sql})}", data=body,
                                 headers={"Authorization": CH_AUTH}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read()


def metrics_summary(bundle: Path) -> dict | None:
    """Copied from the bundle's metrics.json, never computed here (contracts/LIVE_API.md 4.6)."""
    try:
        m = json.loads((bundle / "metrics.json").read_text())
    except (OSError, ValueError):
        return None
    c = m.get("combined", {})
    return {"source": "model-export", "split": m.get("scope"), "rows": c.get("n"), "precision": c.get("precision"),
            "recall": c.get("recall"), "f1": c.get("f1"), "pr_auc": c.get("pr_auc"),
            "per_class": None, "xgboost": m.get("xgboost")}


class Heartbeat:
    def __init__(self, atde: ATDE):
        import psycopg
        from psycopg.types.json import Jsonb
        self.Jsonb = Jsonb
        for _ in range(60):
            try:
                self.conn = psycopg.connect(DATABASE_URL, autocommit=True)
                break
            except Exception as e:
                log.warning("postgres not ready (%s)", e)
                time.sleep(2)
        self.conn.execute(MODELS_SQL)
        self.atde = atde
        self.loaded_at = utc_iso()
        self.last, self.last_totals = 0.0, dict(scored=0, not_scorable=0)

    def beat(self, totals: dict, now: float):
        if now - self.last < HEARTBEAT_EVERY_S:
            return
        span = max(1e-6, now - self.last) if self.last else HEARTBEAT_EVERY_S
        rate = {k: round((totals[k] - self.last_totals[k]) / span, 2) for k in ("scored", "not_scorable")}
        self.last, self.last_totals = now, dict(totals)
        detail = None if totals["scored"] else "Running; no flow records received yet (docs/ML_INTEGRATION.md)."
        self.conn.execute(
            "INSERT INTO ml_models (name, model_id, version, trained_at, loaded_at, last_heartbeat_at, detail, metrics, "
            "scored_per_sec, not_scorable_per_sec) VALUES ('ATDE', %s, %s, NULL, %s, now(), %s, %s, %s, %s) "
            "ON CONFLICT (name) DO UPDATE SET model_id = EXCLUDED.model_id, version = EXCLUDED.version, "
            "loaded_at = EXCLUDED.loaded_at, last_heartbeat_at = now(), detail = EXCLUDED.detail, metrics = EXCLUDED.metrics, "
            "scored_per_sec = EXCLUDED.scored_per_sec, not_scorable_per_sec = EXCLUDED.not_scorable_per_sec",
            (self.atde.model_id, self.atde.version, self.loaded_at, detail, self.Jsonb(metrics_summary(self.atde.bundle)),
             rate["scored"], rate["not_scorable"]))
        HEARTBEAT_FILE.touch()


def main():
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    atde = ATDE()
    scorer = Scorer(atde)
    clickhouse(ML_SCORES_SQL)
    # Tables made before the replay `source` field existed get the column too: ClickHouse refuses
    # rows with unknown fields, so without it the first replay batch would fail.
    clickhouse("ALTER TABLE netra.ml_scores ADD COLUMN IF NOT EXISTS source LowCardinality(String) DEFAULT ''")
    beat = Heartbeat(atde)
    consumer = Consumer({"bootstrap.servers": BOOTSTRAP, "group.id": GROUP, "auto.offset.reset": "latest",
                         "enable.auto.commit": False, "allow.auto.create.topics": True})
    producer = Producer({"bootstrap.servers": BOOTSTRAP})
    consumer.subscribe(TOPICS)
    log.info("scoring %s with %s (1 s micro-batches)", ", ".join(TOPICS), atde.model_id)
    try:
        while True:
            msgs = consumer.consume(num_messages=BATCH_MAX, timeout=BATCH_S)
            now = time.time()
            rows, last = [], {}
            for m in msgs:
                if m.error():
                    continue
                try:
                    rows.append(json.loads(m.value()))
                except ValueError:
                    pass
                last[(m.topic(), m.partition())] = m
            if rows:
                alerts, scores = scorer.batch(rows, now)
                if scores:
                    clickhouse("INSERT INTO netra.ml_scores FORMAT JSONEachRow",
                               "\n".join(json.dumps(s) for s in scores).encode())
                for a in alerts:
                    producer.produce(ALERT_TOPIC, key=a["ip"], value=json.dumps(a, separators=(",", ":")))
                if producer.flush(30):
                    raise RuntimeError("alerts not delivered; not committing")
            if last:
                consumer.commit(offsets=[TopicPartition(t, p, m.offset() + 1) for (t, p), m in last.items()], asynchronous=False)
            beat.beat(scorer.totals, now)
    finally:
        consumer.close()


if __name__ == "__main__":
    main()
