"""Power BI's one source (build plan A5, docs/POWER_BI.md): Postgres views and a read-only user.

Power BI reads only Postgres, with its built-in connector. Traffic and freshness live in
ClickHouse, so the `bi_rollup` job copies a per-minute rollup into `bi_traffic_minute` once a minute.
"""
import os

from psycopg import sql

BI_USER = os.getenv("BI_USER", "netra_bi")
BI_PASSWORD = os.getenv("BI_PASSWORD", "netra_bi_read")  # change it before anything public
ROLLUP_MINUTES = int(os.getenv("BI_ROLLUP_MINUTES", "10"))  # recompute the last 10 finished minutes (late rows)

TABLE_SQL = """
CREATE TABLE IF NOT EXISTS bi_traffic_minute (
    minute          TIMESTAMPTZ PRIMARY KEY,
    events          INT NOT NULL,
    normal          INT NOT NULL,
    flagged_rule    INT NOT NULL,
    flagged_ai      INT NOT NULL,
    freshness_p50_s DOUBLE PRECISION,
    freshness_p95_s DOUBLE PRECISION,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

# The views Power BI sees, in their own schema `bi` (the BI user sees nothing else). They run with
# their owner's rights, so the BI user needs no grants on the tables behind them.
VIEWS_SQL = r"""
CREATE SCHEMA IF NOT EXISTS bi;

CREATE OR REPLACE VIEW bi.bi_incidents AS
SELECT id, alert_id, rule_id, model,
       CASE WHEN rule_id IS NULL THEN 'ai' ELSE 'rule' END AS detected_by,
       severity,
       CASE severity WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END AS severity_rank,
       status, created_ts, updated_ts, date_trunc('minute', created_ts) AS created_minute
FROM public.incidents;

-- Decisions are logged in the incident's notes, one line each: "<time> <user> APPROVED|REJECTED <action>",
-- optionally followed by " (recommended by <crie version>)" since R3.
CREATE OR REPLACE VIEW bi.bi_decisions AS
SELECT i.id AS incident_id, i.rule_id,
       m[1]::timestamptz AS decided_at, m[2] AS decided_by, lower(m[3]) AS decision, m[4] AS action_id
FROM public.incidents i,
     LATERAL regexp_split_to_table(coalesce(i.notes, ''), E'\n') AS line,
     LATERAL regexp_match(line, '^(\S+) (\S+) (APPROVED|REJECTED) (\S+)( \(recommended by .*\))?$') AS m
WHERE m IS NOT NULL;

CREATE OR REPLACE VIEW bi.bi_kpi_alerts AS
SELECT id, kpi, level, state, value, threshold, started_at, updated_at, cleared_at,
       extract(epoch FROM coalesce(cleared_at, now()) - started_at)::int AS duration_s
FROM public.kpi_alerts;

CREATE OR REPLACE VIEW bi.bi_job_runs AS
SELECT id, job, started_at, finished_at, duration_ms, status, detail FROM public.job_runs;

CREATE OR REPLACE VIEW bi.bi_traffic_minute AS
SELECT minute, events, normal, flagged_rule, flagged_ai,
       CASE WHEN events > 0 THEN (flagged_rule + flagged_ai)::float / events END AS flagged_share,
       freshness_p50_s, freshness_p95_s
FROM public.bi_traffic_minute
WHERE minute > now() - interval '6 hours';  -- the report shows the last 6 hours; the table keeps 30 days

CREATE OR REPLACE VIEW bi.bi_freshness AS
SELECT t.minute, t.freshness_p50_s, t.freshness_p95_s,
       coalesce((SELECT (value #>> '{}')::float FROM public.config WHERE key = 'freshness_sla_p95_seconds'), 5) AS target_p95_s,
       t.freshness_p95_s > coalesce((SELECT (value #>> '{}')::float FROM public.config WHERE key = 'freshness_sla_p95_seconds'), 5) AS breach
FROM public.bi_traffic_minute t
WHERE t.minute > now() - interval '6 hours';
"""

VIEWS = ("bi_incidents", "bi_decisions", "bi_kpi_alerts", "bi_job_runs", "bi_traffic_minute", "bi_freshness")


def setup(store):
    """The rollup table, the views and the read-only user. Safe to run again (it runs at every start)."""
    store.q(TABLE_SQL)
    store.q(VIEWS_SQL)
    exists = store.q("SELECT 1 FROM pg_roles WHERE rolname = %s", (BI_USER,))
    verb = "ALTER" if exists else "CREATE"  # a password cannot be a bound parameter in CREATE/ALTER ROLE
    store.q(sql.SQL(verb + " ROLE {} WITH LOGIN PASSWORD {}").format(sql.Identifier(BI_USER), sql.Literal(BI_PASSWORD)))
    db = store.q("SELECT current_database() AS d")[0]["d"]
    store.q(f'GRANT CONNECT ON DATABASE "{db}" TO "{BI_USER}"')
    store.q(f'REVOKE ALL ON SCHEMA public FROM "{BI_USER}"')
    store.q(f'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "{BI_USER}"')
    store.q(f'GRANT USAGE ON SCHEMA bi TO "{BI_USER}"')
    store.q(f'GRANT SELECT ON {", ".join("bi." + v for v in VIEWS)} TO "{BI_USER}"')
    store.q(f'ALTER ROLE "{BI_USER}" SET default_transaction_read_only = on')


def rollup_sql(table: str) -> str:
    """ClickHouse: the last finished minutes. rule_hits is the processor's JSON array as text ("[]" when none)."""
    lag = "(toUnixTimestamp64Milli(stored_ts) - toUnixTimestamp64Milli(event_ts)) / 1000"
    return (f"SELECT toString(toStartOfMinute(stored_ts)) AS minute, count() AS events, "
            f"countIf(rule_hits NOT IN ('', '[]')) AS flagged_rule, quantile(0.5)({lag}) AS p50, quantile(0.95)({lag}) AS p95 "
            f"FROM {table} WHERE stored_ts >= toStartOfMinute(now64(3)) - INTERVAL {ROLLUP_MINUTES} MINUTE "
            f"AND stored_ts < toStartOfMinute(now64(3)) GROUP BY minute ORDER BY minute")


def write_rollup(store, rows: list[dict]) -> int:
    """Upsert ClickHouse's minutes, with the AI's flags counted from real model alerts in Postgres."""
    ai = {r["minute"]: r["n"] for r in store.q(
        "SELECT date_trunc('minute', created_ts) AS minute, count(*)::int AS n FROM incidents "
        "WHERE rule_id IS NULL AND model IS NOT NULL AND model NOT ILIKE '%%dummy%%' "
        "AND created_ts >= now() - make_interval(mins => %s) GROUP BY 1", (ROLLUP_MINUTES + 1,))}
    n = 0
    for r in rows:
        minute = store.q("SELECT (%s || '+00')::timestamptz AS m", (r["minute"],))[0]["m"]  # ClickHouse minute, UTC
        events, rule = int(r["events"]), int(r["flagged_rule"])
        flagged_ai = min(ai.get(minute, 0), max(0, events - rule))
        store.q("INSERT INTO bi_traffic_minute (minute, events, normal, flagged_rule, flagged_ai, freshness_p50_s, freshness_p95_s, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, now()) ON CONFLICT (minute) DO UPDATE SET events = EXCLUDED.events, "
                "normal = EXCLUDED.normal, flagged_rule = EXCLUDED.flagged_rule, flagged_ai = EXCLUDED.flagged_ai, "
                "freshness_p50_s = EXCLUDED.freshness_p50_s, freshness_p95_s = EXCLUDED.freshness_p95_s, updated_at = now()",
                (minute, events, events - rule - flagged_ai, rule, flagged_ai, _num(r.get("p50")), _num(r.get("p95"))))
        n += 1
    return n


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else round(f, 3)  # NaN (an empty minute) is no value
