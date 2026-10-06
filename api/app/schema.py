"""Tables and config keys added after the first release.

db/init.sql only runs when Postgres starts on an empty volume, so the API applies these itself
at startup (idempotent): existing volumes get them too.
"""
import json

from .kpi_rules import DEFAULT_THRESHOLDS

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS kpi_alerts (
    id          BIGSERIAL PRIMARY KEY,
    kind        TEXT NOT NULL DEFAULT 'threshold',
    kpi         TEXT NOT NULL,
    level       TEXT NOT NULL CHECK (level IN ('warn', 'crit')),
    state       TEXT NOT NULL CHECK (state IN ('firing', 'cleared')),
    value       DOUBLE PRECISION,
    threshold   DOUBLE PRECISION,
    time_window TEXT NOT NULL DEFAULT '1m',   -- "window" is a reserved word; the wire field is `window`
    started_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL,
    cleared_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_kpi_alerts_started ON kpi_alerts (started_at DESC);
-- At most one firing alert per KPI.
CREATE UNIQUE INDEX IF NOT EXISTS uq_kpi_alerts_firing ON kpi_alerts (kpi) WHERE state = 'firing';
"""


def default_config() -> list[tuple[str, str]]:
    """(key, JSON text) for every KPI line. Inserted only where the key is missing: an admin's value stays."""
    rows = []
    for name, (warn, crit) in DEFAULT_THRESHOLDS.items():
        rows += [(f"kpi.{name}.warn", json.dumps(warn)), (f"kpi.{name}.crit", json.dumps(crit))]
    return rows


async def apply(conn):
    await conn.execute(SCHEMA_SQL)
    await conn.executemany(
        "INSERT INTO config (key, value, updated_by) VALUES ($1, $2::text::jsonb, 'seed') ON CONFLICT (key) DO NOTHING",
        default_config(),
    )
