// What the backend actually sends: api/app on the backend branch (routes, ws.py, consumers.py).
// Where these disagree with docs/DATA_CONTRACT.md, these win (CLAUDE.md: the backend files win).

/** One event after the processor: the raw event plus its features, score and rule hits. */
export interface EnrichedEvent {
  event_id: string;
  event_ts: string;
  source?: string;
  user?: string;
  ip?: string;
  event_type?: string;
  status?: string;
  host?: string;
  bytes_out?: number;
  process?: string;
  method?: string;
  path?: string;
  http_status?: number;
  user_agent?: string;
  response_ms?: number;
  risk_score?: number;
  rule_hits?: string[];
  processed_ts?: string;
}

/** A row of the backend's `incidents` table. The backend stores ONE row per alert (one rule, one event). */
export interface AlertRow {
  id: number;
  alert_id: string;
  rule_id: string | null; // null when a model raised it
  model: string | null; // null when a rule raised it
  title?: string | null;
  severity: string; // low | medium | high | critical
  event_ids: string[];
  status: "open" | "acknowledged" | "resolved";
  notes?: string | null;
  created_ts: string;
}

/** WebSocket envelope from the backend: { type, data, server_ts }. */
export type BackendMessage =
  | { type: "hello"; data: { username: string; role: string }; server_ts: string }
  | { type: "events"; data: EnrichedEvent[]; server_ts: string; dropped?: number }
  | { type: "alert"; data: AlertRow; server_ts: string }
  | { type: "incident_update"; data: AlertRow; server_ts: string }
  | { type: "kpi"; data: KpiSnapshotWire; server_ts: string }
  | { type: "job_runs"; data: JobRunWire[]; server_ts: string }
  | { type: "ops_alert"; data: OpsAlertWire; server_ts: string }
  | { type: "kpi_alert"; data: KpiAlertWire; server_ts: string }
  | { type: "pong"; server_ts: string };

/** A row of job_runs (`job_runs` message, GET /jobs/runs). */
export interface JobRunWire {
  id: number;
  job: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  status: "ok" | "failed" | "skipped";
  detail: string | null;
  result: unknown;
}

/** GET /jobs */
export interface JobWire {
  job: string;
  schedule: string;
  next_run_at: string | null;
  last_run: JobRunWire | null;
  consecutive_failures: number;
}

/** `ops_alert`, GET /ops/alerts */
export interface OpsAlertWire {
  id: number;
  kind: string;
  source: string;
  level: string;
  state: string;
  message: string;
  started_at: string;
  updated_at: string;
  cleared_at: string | null;
}

/** One KPI in the `kpi` message (contracts/LIVE_API.md 4.1). */
export interface KpiReadingWire {
  name: string;
  unit: string;
  value_1m: number | null;
  value_5m: number | null;
  warn: number | null;
  crit: number | null;
  level: string;
  alert_id: number | null;
}

/** `kpi`, every 5 s. */
export interface KpiSnapshotWire {
  computed_at: string;
  kpis: KpiReadingWire[];
}

/** `kpi_alert` and GET /kpi/alerts (contracts/LIVE_API.md 4.2). */
export interface KpiAlertWire {
  id: number | null;
  kind: string;
  origin: string;
  kpi: string;
  level: string;
  state: string;
  value: number;
  threshold: number | null;
  window: string;
  started_at: string;
  updated_at: string;
  cleared_at: string | null;
}

/** GET /kpi: the latest reading and each KPI's 1-minute value over the last few minutes. */
export interface KpiReport {
  latest: KpiSnapshotWire | null;
  history: { computed_at: string; values: Record<string, number | null> }[];
}

/** GET /freshness: p50 and p95 of (stored_ts - event_ts) over a sliding window. */
export interface FreshnessReport {
  events: number;
  avg_events_per_sec: number;
  p50_seconds: number | null;
  p95_seconds: number | null;
  sla_p95_seconds: number;
  seconds_since_last_event: number | null;
  status: "ok" | "breach" | "stalled" | "no_data";
}

/** GET /health: is the server's own pipeline running? */
export interface ServerHealth {
  status: "ok" | "degraded";
  postgres: boolean;
  consumers: Record<string, boolean>;
}

export interface SessionUser {
  id: number;
  username: string;
  role: "analyst" | "admin";
}

/** POST /auth/login */
export interface LoginResponse {
  access_token: string;
  expires_in: number; // seconds
  user: SessionUser;
}
