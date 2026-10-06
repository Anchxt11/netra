// The backend's KPI messages (contracts/LIVE_API.md 4.1, 4.2) in the dashboard's own shapes.
// Unknown KPI names and levels are dropped or read as "no data", never guessed.
import { KPI_NAMES, KPI_ORDER } from "../kpi.ts";
import type { KpiAlert, KpiLevel, KpiName, KpiPoint, KpiReading, KpiSnapshot, KpiThresholds } from "../types.ts";
import type { KpiAlertWire, KpiReport, KpiSnapshotWire } from "./types.ts";

const LEVELS: readonly string[] = ["ok", "warn", "crit", "no_data"];
const isName = (n: string): n is KpiName => (KPI_NAMES as readonly string[]).includes(n);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** ClickHouse and Python times without a zone are UTC. */
export function utcIso(ts: string): string {
  return /[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts.replace(" ", "T")}Z`;
}

export function kpiSnapshotFromApi(w: KpiSnapshotWire): KpiSnapshot {
  const byName = new Map(w.kpis.filter((k) => isName(k.name)).map((k) => [k.name as KpiName, k]));
  // Always all five, in the strip's order: one the server did not send reads as no data.
  const kpis: KpiReading[] = KPI_ORDER.map(({ name, unit }) => {
    const k = byName.get(name);
    return {
      name,
      unit,
      value1m: num(k?.value_1m),
      value5m: num(k?.value_5m),
      warn: num(k?.warn),
      crit: num(k?.crit),
      level: k && LEVELS.includes(k.level) ? (k.level as KpiLevel) : "no_data",
      alertId: k?.alert_id ?? null,
    };
  });
  return { computedAt: utcIso(w.computed_at), kpis };
}

export function kpiAlertFromApi(w: KpiAlertWire): KpiAlert | null {
  if ((w.level !== "warn" && w.level !== "crit") || (w.state !== "firing" && w.state !== "cleared")) return null;
  return {
    id: w.id,
    kind: w.kind === "sla" ? "sla" : "threshold",
    origin: w.origin === "browser" ? "browser" : "api",
    kpi: w.kpi,
    level: w.level,
    state: w.state,
    value: w.value,
    threshold: num(w.threshold),
    window: w.window,
    startedAt: utcIso(w.started_at),
    updatedAt: utcIso(w.updated_at),
    clearedAt: w.cleared_at ? utcIso(w.cleared_at) : null,
  };
}

export function kpiHistoryFromApi(r: KpiReport): KpiPoint[] {
  return r.history.map((h) => ({
    t: utcIso(h.computed_at),
    values: Object.fromEntries(Object.entries(h.values).filter(([n]) => isName(n)).map(([n, v]) => [n, num(v)])),
  }));
}

/** GET /config holds every key; the lines are `kpi.<name>.warn` and `kpi.<name>.crit`. */
export function thresholdsFromConfig(cfg: Record<string, unknown>): KpiThresholds {
  return Object.fromEntries(
    KPI_NAMES.map((n) => [n, { warn: num(cfg[`kpi.${n}.warn`]), crit: num(cfg[`kpi.${n}.crit`]) }]),
  ) as KpiThresholds;
}
