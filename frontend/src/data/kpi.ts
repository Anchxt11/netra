// Live KPIs: their order, levels and the alert crossing rules (contracts/LIVE_API.md 4.1, 4.2).
// The backend computes these itself (api/app/kpi_rules.py); the simulated feed uses this copy,
// so both sources raise alerts at exactly the same moments. Keep the two in step.
import type { KpiLevel, KpiName, KpiThresholds, KpiUnit } from "./types.ts";

/** The strip's order. */
export const KPI_ORDER: readonly { name: KpiName; unit: KpiUnit }[] = [
  { name: "events_per_sec", unit: "events/s" },
  { name: "login_failure_rate", unit: "ratio" },
  { name: "http_5xx_rate", unit: "ratio" },
  { name: "bytes_out_per_min", unit: "bytes/min" },
  { name: "rule_hit_rate", unit: "ratio" },
];
export const KPI_NAMES: readonly KpiName[] = KPI_ORDER.map((k) => k.name);

/** Breaches to open, readings at the other level to move, normal readings to clear. */
export const IN_A_ROW = 2;

type Breach = "warn" | "crit";
const isBreach = (l: KpiLevel): l is Breach => l === "warn" || l === "crit";

/** One reading's level. All five KPIs alert when the value rises; at the line counts as over it. */
export function levelOf(value: number | null, warn: number | null, crit: number | null): KpiLevel {
  if (value === null) return "no_data";
  if (crit !== null && value >= crit) return "crit";
  if (warn !== null && value >= warn) return "warn";
  return "ok";
}

export const noLines = (): KpiThresholds =>
  Object.fromEntries(KPI_NAMES.map((n) => [n, { warn: null, crit: null }])) as KpiThresholds;

export interface KpiTransition {
  action: "open" | "level" | "clear";
  /** The alert's level after the change. A cleared alert keeps the level it fired at. */
  level: Breach;
}

/** One KPI's alert state between readings. */
export class KpiTrack {
  firing: Breach | null = null;
  private pending: Breach[] = [];
  private other = 0;
  private normal = 0;

  constructor(firing: Breach | null = null) {
    this.firing = firing;
  }

  step(level: KpiLevel): KpiTransition | null {
    if (level === "no_data") return null; // counts as neither and does not break a streak
    if (this.firing === null) {
      if (!isBreach(level)) {
        this.pending = [];
        return null;
      }
      this.pending.push(level);
      if (this.pending.length < IN_A_ROW) return null;
      const opened: Breach = this.pending.includes("warn") ? "warn" : "crit"; // the lower of the streak
      this.firing = opened;
      this.pending = [];
      this.other = 0;
      this.normal = 0;
      return { action: "open", level: opened };
    }
    if (!isBreach(level)) {
      this.other = 0;
      this.normal += 1;
      if (this.normal < IN_A_ROW) return null;
      const last = this.firing;
      this.firing = null;
      this.normal = 0;
      return { action: "clear", level: last };
    }
    this.normal = 0;
    if (level === this.firing) {
      this.other = 0;
      return null;
    }
    this.other += 1;
    if (this.other < IN_A_ROW) return null;
    this.firing = level;
    this.other = 0;
    return { action: "level", level };
  }
}

/** The crossing rules for every KPI: give it each reading's levels, get back what changed. */
export class KpiAlerter {
  private tracks = new Map<KpiName, KpiTrack>(KPI_NAMES.map((n) => [n, new KpiTrack()]));

  observe(levels: Partial<Record<KpiName, KpiLevel>>): Partial<Record<KpiName, KpiTransition>> {
    const out: Partial<Record<KpiName, KpiTransition>> = {};
    for (const name of KPI_NAMES) {
      const level = levels[name];
      if (level === undefined) continue;
      const t = this.tracks.get(name)?.step(level);
      if (t) out[name] = t;
    }
    return out;
  }
}
