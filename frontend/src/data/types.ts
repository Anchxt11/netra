// Shapes from docs/DATA_CONTRACT.md. Raw events match docs/backend/raw_event.schema.json exactly.

export interface RawEvent {
  event_id: string;
  event_ts: string;
  source: "web" | "auth" | "endpoint" | "network";
  user: string;
  ip: string;
  event_type: "http_request" | "login" | "logout" | "data_transfer" | "process_start";
  severity: "low" | "medium"; // the generator's raw flag. NOT incident severity: never display it as severity.
  status: "success" | "failure";
  host: string;
  bytes_out: number;
  process: string;
  method: string;
  path: string;
  http_status: number;
  user_agent: string;
  response_ms: number;
}

export type AttackType =
  | "brute_force"
  | "credential_stuffing"
  | "account_takeover"
  | "web_scan"
  | "data_exfiltration"
  | "admin_abuse"
  | "http_flood";
export type BenignKind = "flash_crowd" | "nightly_backup";

export type HeatState = "hot" | "warm" | "cool" | "stale";
export type DetectedBy = "rule" | "ai" | "both";
export type SignalLevel = "normal" | "suspicious" | "critical";
export type IncidentStatus = "open" | "approved" | "rejected" | "expired";
export type Severity = 1 | 2 | 3 | 4 | 5;

export interface Signal {
  id: string;
  ts: string;
  ruleId: string; // "BF-4", or "ATDE" when the AI engine raised it
  sentence: string;
  points: number;
  level: SignalLevel;
  eventIds: string[];
}

export interface Reason {
  feature: string;
  sentence: string;
  value: string | number;
  contribution: number;
}

export interface Fix {
  actionId: string;
  name: string;
  d3fend: { id: string | null; name: string };
  confidence: number; // 0..1
  rank: 1 | 2 | 3;
  reasons: Reason[];
}

export interface Incident {
  id: string;
  attackType: AttackType;
  name: string;
  mitre: { id: string; name: string; tactic: string };
  severity: Severity;
  attentionScore: number; // 0..100
  detectedBy: DetectedBy;
  createdAt: string;
  staleBy: string; // ISO deadline
  status: IncidentStatus;
  entities: { users: string[]; ips: string[]; hosts: string[] };
  signals: Signal[];
  fixes: Fix[]; // empty while CRIE is pending
  fallback?: { technique: string; mitigations: { id: string; name: string }[] };
}

export interface BenignAnomaly {
  id: string;
  kind: BenignKind;
  name: string;
  ts: string;
  sentence: string;
  checks: { label: string; passed: boolean }[];
}

/** One event in the live feed. Normal traffic too: the feed shows everything, flagged or not. */
export interface FeedEvent {
  id: string;
  ts: string;
  ip: string;
  what: string; // "GET /products/41 · 200", "login failed for maria.silva"
  flag?: { by: "rule" | "ai"; label: string }; // label: the rule's code, or "AI 0.81"
}

/** All traffic in one second. Every event counts here, flagged or not. */
export interface TrafficSecond {
  t: string;
  normal: number;
  rule: number; // flagged by a rule
  ai: number; // flagged by the AI engine
}

// ---------------------------------------------------------------- live KPIs (contracts/LIVE_API.md 4.1, 4.2)

export type KpiName = "events_per_sec" | "login_failure_rate" | "http_5xx_rate" | "bytes_out_per_min" | "rule_hit_rate";
export type KpiUnit = "events/s" | "ratio" | "bytes/min";
/** One reading's own level. "no_data" when the value could not be measured (a rate of no events). */
export type KpiLevel = "ok" | "warn" | "crit" | "no_data";

export interface KpiReading {
  name: KpiName;
  unit: KpiUnit;
  value1m: number | null; // compared with the lines
  value5m: number | null; // context for the trend
  warn: number | null; // null = no line
  crit: number | null;
  level: KpiLevel;
  alertId: number | string | null; // this KPI's firing alert, if any
}

/** Every 5 s: all five KPIs, in the strip's order. */
export interface KpiSnapshot {
  computedAt: string;
  kpis: KpiReading[];
}

/** A past reading for the strip's small trend: each KPI's 1-minute value. */
export interface KpiPoint {
  t: string;
  values: Partial<Record<KpiName, number | null>>;
}

/** Opens after 2 breaches in a row, clears after 2 normal readings. Sent whole on every change. */
export interface KpiAlert {
  id: number | string | null; // null for an alert the dashboard raised itself (kind "sla")
  kind: "threshold" | "sla";
  origin: "api" | "browser";
  kpi: string;
  level: "warn" | "crit";
  state: "firing" | "cleared";
  value: number;
  threshold: number | null;
  window: string;
  startedAt: string;
  updatedAt: string;
  clearedAt: string | null;
}

export type KpiThresholds = Record<KpiName, { warn: number | null; crit: number | null }>;

export interface ModelStatus {
  name: "ATDE" | "CRIE";
  version: string;
  trainedAt: string | null;
  status: "ready" | "training" | "failed" | "pending";
}

export interface PipelineHealth {
  feed: "live" | "stalled" | "down";
  lastEventAt: string;
  eventsPerSec: number;
  eventsToday: number | null; // null when the source does not count a day's events
  freshnessMs: { p50: number; p95: number } | null; // null until the backend has measured it
  slaMs: 5000;
  freshnessHistory: { t: string; p95: number }[];
  detections: { rule: number; ai: number };
  detectionsPerMin: { t: string; rule: number; ai: number }[];
  expiredToday: number;
  judgedNormalToday: number;
  models: ModelStatus[];
  retraining: { lastRun: string | null; nextRun: string | null; status: "ok" | "failed" | "scheduled" };
  alerts: { id: string; ts: string; sentence: string }[];
  decisions: { approved: number; rejected: number };
}
