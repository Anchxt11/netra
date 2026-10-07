"""Postgres for the ops service: its three tables, and NOTIFY so the API can broadcast what changed."""
import json
from datetime import date, datetime

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS job_runs (
    id          BIGSERIAL PRIMARY KEY,
    job         TEXT NOT NULL,
    started_at  TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    duration_ms INT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
    detail      TEXT,
    result      JSONB
);
CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs (job, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS ops_alerts (
    id          BIGSERIAL PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('health', 'job_failed', 'sla_breach')),
    source      TEXT NOT NULL,
    level       TEXT NOT NULL CHECK (level IN ('warn', 'crit')),
    state       TEXT NOT NULL CHECK (state IN ('firing', 'cleared')),
    message     TEXT NOT NULL,
    detail      JSONB NOT NULL DEFAULT '{}',
    job_run_id  BIGINT,
    started_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL,
    cleared_at  TIMESTAMPTZ,
    webhook     JSONB
);
CREATE INDEX IF NOT EXISTS idx_ops_alerts_started ON ops_alerts (started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_alerts_firing ON ops_alerts (kind, source) WHERE state = 'firing';

-- The schedule, for GET /jobs: one row per job, kept up to date by the ops service.
CREATE TABLE IF NOT EXISTS ops_jobs (
    job         TEXT PRIMARY KEY,
    schedule    TEXT NOT NULL,
    next_run_at TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_reports (
    id         BIGSERIAL PRIMARY KEY,
    date       DATE UNIQUE NOT NULL,
    report     JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

RUN_JSON = {"result"}  # job_runs.detail is plain text
ALERT_JSON = {"detail", "webhook"}
CHANNEL = "ops_events"  # the API LISTENs here (api/app/ops.py)


def _default(o):
    return o.isoformat() if isinstance(o, (datetime, date)) else str(o)


def _adapt(fields: dict, json_cols: set) -> dict:
    return {k: Jsonb(v, dumps=lambda x: json.dumps(x, default=_default)) if k in json_cols and v is not None else v
            for k, v in fields.items()}


class PgStore:
    def __init__(self, url: str):
        self.conn = psycopg.connect(url, autocommit=True, row_factory=dict_row)
        self.conn.execute(SCHEMA_SQL)

    def q(self, sql: str, args=()) -> list[dict]:
        cur = self.conn.execute(sql, args)
        return cur.fetchall() if cur.description else []

    def insert_run(self, run: dict) -> dict:
        r = _adapt(run, RUN_JSON)
        cols = ", ".join(r)
        return self.q(f"INSERT INTO job_runs ({cols}) VALUES ({', '.join(['%s'] * len(r))}) RETURNING *", tuple(r.values()))[0]

    def firing_alerts(self) -> list[dict]:
        return self.q("SELECT * FROM ops_alerts WHERE state = 'firing'")

    def open_alert(self, alert: dict) -> dict:
        a = _adapt(alert, ALERT_JSON)
        return self.q(f"INSERT INTO ops_alerts ({', '.join(a)}) VALUES ({', '.join(['%s'] * len(a))}) RETURNING *", tuple(a.values()))[0]

    def update_alert(self, alert_id: int, fields: dict) -> dict:
        f = _adapt(fields, ALERT_JSON)
        sets = ", ".join(f"{k} = %s" for k in f)  # keys come from ops/core.py, never from input
        return self.q(f"UPDATE ops_alerts SET {sets} WHERE id = %s RETURNING *", (*f.values(), alert_id))[0]

    def upsert_job(self, job: str, schedule: str, next_run_at: datetime):
        self.q("INSERT INTO ops_jobs (job, schedule, next_run_at, updated_at) VALUES (%s, %s, %s, now()) "
               "ON CONFLICT (job) DO UPDATE SET schedule = EXCLUDED.schedule, next_run_at = EXCLUDED.next_run_at, updated_at = now()",
               (job, schedule, next_run_at))

    def notify(self, kind: str, row: dict):
        """Tell the API, which broadcasts it as `job_runs` or `ops_alert` (payloads stay well under 8000 bytes)."""
        payload = json.dumps({"kind": kind, "row": row}, default=_default)
        self.conn.execute("SELECT pg_notify(%s, %s)", (CHANNEL, payload))
