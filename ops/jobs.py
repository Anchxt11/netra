"""The five scheduled jobs. Each returns an Outcome (ops/core.py) or raises Skip or an error."""
import base64
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from . import bi
from .core import Check, Outcome, Skip

API_URL = os.getenv("API_URL", "http://api:8000")
CH_URL = os.getenv("CLICKHOUSE_URL", "http://clickhouse:8123")
CH_USER = os.getenv("CLICKHOUSE_USER", "netra")
CH_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "netra")
CH_TABLE = os.getenv("CLICKHOUSE_TABLE", "netra.events")
KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "redpanda:9092")
PROCESSOR_GROUP = os.getenv("PROCESSOR_GROUP_ID", "netra-processor")
RAW_TOPIC = os.getenv("RAW_TOPIC", "events.raw")
LAG_WARN = int(os.getenv("KAFKA_LAG_WARN", "1000"))
LAG_CRIT = int(os.getenv("KAFKA_LAG_CRIT", "10000"))
ML_DIR = Path(os.getenv("ML_DIR", "/srv/ml"))
RETRAIN_TIMEOUT_S = int(os.getenv("RETRAIN_TIMEOUT_SECONDS", "3600"))
TZ = os.getenv("TZ", "UTC")
KEEP_JOB_RUNS_DAYS = int(os.getenv("KEEP_JOB_RUNS_DAYS", "7"))
KEEP_ALERTS_DAYS = int(os.getenv("KEEP_ALERTS_DAYS", "30"))


def get_json(url: str, timeout: float = 4) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.load(r)


def clickhouse(sql: str, timeout: float = 10) -> list[dict]:
    req = urllib.request.Request(
        f"{CH_URL}/?{urllib.parse.urlencode({'query': sql + ' FORMAT JSON'})}",
        headers={"Authorization": "Basic " + base64.b64encode(f"{CH_USER}:{CH_PASSWORD}".encode()).decode()},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)["data"]


# ------------------------------------------------------------------ health watch (every 10 s)

def _check(source: str, fn, down: str) -> Check:
    try:
        return fn()
    except Exception as e:
        return Check(source, False, down, detail={"error": f"{type(e).__name__}: {e}"[:300]})


def _api() -> Check:
    h = get_json(f"{API_URL}/health")
    if h.get("status") == "ok":
        return Check("api", True, "")
    return Check("api", False, "The API reports it is degraded (database or event stream).", level="warn", detail=h)


def _clickhouse() -> Check:
    clickhouse("SELECT 1")
    return Check("clickhouse", True, "")


def _kafka() -> list[Check]:
    from confluent_kafka import Consumer, TopicPartition
    from confluent_kafka.admin import AdminClient

    admin = AdminClient({"bootstrap.servers": KAFKA_BOOTSTRAP})
    group = admin.describe_consumer_groups([PROCESSOR_GROUP], request_timeout=5)[PROCESSOR_GROUP].result(timeout=6)
    alive = len(group.members) > 0
    c = Consumer({"bootstrap.servers": KAFKA_BOOTSTRAP, "group.id": PROCESSOR_GROUP, "enable.auto.commit": False})
    try:
        parts = [TopicPartition(RAW_TOPIC, p) for p in c.list_topics(RAW_TOPIC, timeout=5).topics[RAW_TOPIC].partitions]
        lag = 0
        for tp in c.committed(parts, timeout=5):
            _, high = c.get_watermark_offsets(tp, timeout=5)
            lag += high - (tp.offset if tp.offset >= 0 else 0)
    finally:
        c.close()
    level = "crit" if lag >= LAG_CRIT else "warn"
    return [
        Check("processor", alive, f"The processor is not consuming {RAW_TOPIC} (no members in group {PROCESSOR_GROUP}).",
              detail={"state": str(group.state)}),
        Check("kafka_lag", lag < LAG_WARN, f"Redpanda consumer lag: the processor is {lag} events behind on {RAW_TOPIC}.", level=level,
              detail={"lag": lag}),
    ]


def health_watch(store) -> Outcome:
    checks = [
        _check("api", _api, "The API is not answering."),
        _check("postgres", lambda: (store.q("SELECT 1"), Check("postgres", True, ""))[1], "Postgres is not answering."),
        _check("clickhouse", _clickhouse, "ClickHouse is not answering."),
    ]
    try:
        checks += _kafka()
    except Exception as e:
        checks.append(Check("kafka_lag", False, "Redpanda cannot be reached to measure the processor's consumer lag.",
                            detail={"error": f"{type(e).__name__}: {e}"[:300]}))
    failed = [c.source for c in checks if not c.ok]
    result = {"checks": {c.source: c.ok for c in checks}}
    lag = next((c.detail["lag"] for c in checks if c.source == "kafka_lag" and "lag" in c.detail), None)
    if lag is not None:
        result["kafka_lag"] = lag
    return Outcome("failed" if failed else "ok", f"Failed: {', '.join(failed)}." if failed else "All checks passed.", result, checks)


# ------------------------------------------------------------------ SLA check (every 30 s)

def sla_check(store) -> Outcome:
    f = get_json(f"{API_URL}/freshness")
    breach = f.get("status") in ("breach", "stalled")
    sla = f.get("sla_p95_seconds")
    msg = (f"Pipeline freshness p95 is {f.get('p95_seconds')} s, over the {sla} s SLA."
           if f.get("status") == "breach" else f"The pipeline stopped delivering events ({f.get('seconds_since_last_event')} s since the last one).")
    result = {"p95_seconds": f.get("p95_seconds"), "sla_p95_seconds": sla, "status": f.get("status"), "breach": breach}
    detail = "No events in the window." if f.get("status") == "no_data" else ("Over the SLA." if breach else "Within the SLA.")
    return Outcome("ok", detail, result, [Check("sla_check", not breach, msg, kind="sla_breach", detail=result)])


# ------------------------------------------------------------------ daily report (06:00)

def daily_report(store) -> Outcome:
    tz = ZoneInfo(TZ)
    today = datetime.now(tz).date()
    day = today - timedelta(days=1)
    start = datetime.combine(day, datetime.min.time(), tzinfo=tz)
    end = start + timedelta(days=1)
    s, e = start.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%d %H:%M:%S"), end.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%d %H:%M:%S")
    sla = store.q("SELECT value FROM config WHERE key = 'freshness_sla_p95_seconds'")
    sla_s = float(sla[0]["value"]) if sla else 5.0
    lag = f"(toUnixTimestamp64Milli(stored_ts) - toUnixTimestamp64Milli(event_ts)) / 1000"
    where = f"stored_ts >= toDateTime64('{s}', 3, 'UTC') AND stored_ts < toDateTime64('{e}', 3, 'UTC')"
    fresh = clickhouse(f"SELECT count() AS events, quantile(0.5)({lag}) AS p50, quantile(0.95)({lag}) AS p95 FROM {CH_TABLE} WHERE {where}")[0]
    minutes = clickhouse(f"SELECT countIf(p95 > {sla_s}) AS over, count() AS minutes FROM "
                         f"(SELECT toStartOfMinute(stored_ts) AS m, quantile(0.95)({lag}) AS p95 FROM {CH_TABLE} WHERE {where} GROUP BY m)")[0]
    incidents = store.q("SELECT severity, status, count(*)::int AS n FROM incidents WHERE created_ts >= %s AND created_ts < %s GROUP BY 1, 2", (start, end))
    ops = store.q("SELECT kind, count(*)::int AS n FROM ops_alerts WHERE started_at >= %s AND started_at < %s GROUP BY 1", (start, end))
    report = {
        "date": day.isoformat(), "tz": TZ,
        "sla": {"target_p95_seconds": sla_s, "events": int(fresh["events"]), "p50_seconds": fresh["p50"], "p95_seconds": fresh["p95"],
                "minutes_measured": int(minutes["minutes"]), "minutes_over": int(minutes["over"])},
        "incidents": incidents,
        "ops_alerts": {r["kind"]: r["n"] for r in ops},
    }
    from psycopg.types.json import Jsonb
    row = store.q("INSERT INTO daily_reports (date, report) VALUES (%s, %s) ON CONFLICT (date) DO UPDATE SET report = EXCLUDED.report, "
                  "created_at = now() RETURNING id", (day, Jsonb(report)))[0]
    return Outcome("ok", f"Report for {day.isoformat()}: {report['sla']['events']} events, {sum(r['n'] for r in incidents)} alerts.",
                   {"report_id": row["id"], "date": day.isoformat()})


# ------------------------------------------------------------------ model retrain (02:00)

def model_retrain(store) -> Outcome:
    script = ML_DIR / "train.py"
    if not script.exists():
        raise Skip("ml/train.py does not exist yet.")
    p = subprocess.run([sys.executable, str(script)], cwd=ML_DIR, capture_output=True, text=True, timeout=RETRAIN_TIMEOUT_S)
    if p.returncode != 0:
        raise RuntimeError(f"ml/train.py exited with {p.returncode}: {(p.stderr or p.stdout).strip()[-300:]}")
    last = (p.stdout.strip().splitlines() or [""])[-1]
    try:
        result = json.loads(last)  # train.py may print one JSON line: {"version", "promoted", "pr_auc"}
    except ValueError:
        result = None
    return Outcome("ok", "ml/train.py finished.", result)


# ------------------------------------------------------------------ Power BI rollup (every 60 s)

_bi_ready = False


def bi_rollup(store) -> Outcome:
    """The last finished minutes of traffic and freshness, from ClickHouse into Postgres (docs/POWER_BI.md)."""
    global _bi_ready
    if not _bi_ready:
        bi.setup(store)  # needs the API's kpi_alerts table, so it waits for the API's first start
        _bi_ready = True
    n = bi.write_rollup(store, clickhouse(bi.rollup_sql(CH_TABLE)))
    return Outcome("ok", f"{n} minutes written to bi_traffic_minute.", {"minutes": n})


# ------------------------------------------------------------------ data retention (03:00)

def data_retention(store) -> Outcome:
    deleted = {}
    for table, sql in (
        ("bi_traffic_minute", f"DELETE FROM bi_traffic_minute WHERE minute < now() - interval '{KEEP_ALERTS_DAYS} days'"),
        ("job_runs", f"DELETE FROM job_runs WHERE started_at < now() - interval '{KEEP_JOB_RUNS_DAYS} days'"),
        ("ops_alerts", f"DELETE FROM ops_alerts WHERE state = 'cleared' AND cleared_at < now() - interval '{KEEP_ALERTS_DAYS} days'"),
        ("kpi_alerts", f"DELETE FROM kpi_alerts WHERE state = 'cleared' AND cleared_at < now() - interval '{KEEP_ALERTS_DAYS} days'"),
    ):
        deleted[table] = store.conn.execute(sql).rowcount
    # ClickHouse keeps events for 2 days by itself (TTL in infrastructure/clickhouse/init/03_events_enriched.sql).
    return Outcome("ok", f"Deleted {sum(deleted.values())} old rows.", {"deleted": deleted})
