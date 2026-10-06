-- Mounted into postgres:/docker-entrypoint-initdb.d (runs once on first start)

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('analyst', 'admin')),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS incidents (
    id          BIGSERIAL PRIMARY KEY,
    alert_id    TEXT UNIQUE NOT NULL,          -- from alert schema; makes the consumer idempotent
    rule_id     TEXT,
    model       TEXT,
    title       TEXT,
    severity    TEXT NOT NULL,
    event_ids   TEXT[] NOT NULL DEFAULT '{}',
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    assigned_to INT REFERENCES users(id) ON DELETE SET NULL,
    notes       TEXT,
    payload     JSONB NOT NULL DEFAULT '{}',   -- full original alert
    created_ts  TIMESTAMPTZ NOT NULL,
    ingested_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_ts  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incidents_created  ON incidents (created_ts DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_status   ON incidents (status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents (severity);

CREATE TABLE IF NOT EXISTS config (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT
);

-- Placeholder SLA: overwrite with the number measured by the load test.
INSERT INTO config (key, value) VALUES
    ('freshness_sla_p95_seconds', '5'),
    ('freshness_window_minutes',  '5'),
    ('rules_enabled',             '{}')      -- {"rule_id": false} disables a rule; B reads this
ON CONFLICT (key) DO NOTHING;
