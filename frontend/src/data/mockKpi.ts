// The simulated feed's KPIs: the same five numbers, levels and alerts as the backend's KPI loop
// (contracts/LIVE_API.md 4.1, 4.2), computed from the mock engine's own simulated seconds.
import { KPI_NAMES, KPI_ORDER, KpiAlerter, levelOf } from "./kpi.ts";
import type { KpiAlert, KpiName, KpiPoint, KpiReading, KpiSnapshot, KpiThresholds } from "./types.ts";

/** What one simulated second contained. */
export interface SecondCounts {
  events: number;
  logins: number;
  loginFailures: number;
  requests: number;
  errors5xx: number;
  bytes: number;
  ruleHits: number;
}

const WINDOW_1M = 60;
const WINDOW_5M = 300;

/**
 * The simulated feed runs at about 214 events/s (the real stack at about 10), so its volume lines
 * are its own. The rates use the same starting lines as the backend.
 */
export const MOCK_THRESHOLDS: KpiThresholds = {
  events_per_sec: { warn: 300, crit: 450 },
  login_failure_rate: { warn: 0.2, crit: 0.4 },
  http_5xx_rate: { warn: 0.02, crit: 0.05 },
  bytes_out_per_min: { warn: 400e6, crit: 1e9 },
  rule_hit_rate: { warn: 0.05, crit: 0.15 },
};

const ratio = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : null);

export class MockKpi {
  private seconds: SecondCounts[] = []; // the last 5 minutes, oldest first
  private alerter = new KpiAlerter();
  private firing = new Map<KpiName, KpiAlert>();
  private nextId = 1;
  thresholds: KpiThresholds;

  constructor(thresholds: KpiThresholds = MOCK_THRESHOLDS) {
    this.thresholds = structuredClone(thresholds);
  }

  push(c: SecondCounts) {
    this.seconds.push(c);
    if (this.seconds.length > WINDOW_5M) this.seconds.shift();
  }

  private sum(seconds: SecondCounts[]): SecondCounts {
    const s: SecondCounts = { events: 0, logins: 0, loginFailures: 0, requests: 0, errors5xx: 0, bytes: 0, ruleHits: 0 };
    for (const c of seconds) {
      s.events += c.events;
      s.logins += c.logins;
      s.loginFailures += c.loginFailures;
      s.requests += c.requests;
      s.errors5xx += c.errors5xx;
      s.bytes += c.bytes;
      s.ruleHits += c.ruleHits;
    }
    return s;
  }

  /** Each KPI over the last 1 and 5 minutes, defined exactly as the backend defines them. */
  values(): Record<KpiName, [number | null, number | null]> {
    const one = this.sum(this.seconds.slice(-WINDOW_1M));
    const five = this.sum(this.seconds);
    return {
      events_per_sec: [Math.round((one.events / WINDOW_1M) * 100) / 100, Math.round((five.events / WINDOW_5M) * 100) / 100],
      login_failure_rate: [ratio(one.loginFailures, one.logins), ratio(five.loginFailures, five.logins)],
      http_5xx_rate: [ratio(one.errors5xx, one.requests), ratio(five.errors5xx, five.requests)],
      bytes_out_per_min: [one.bytes, Math.round(five.bytes / 5)],
      rule_hit_rate: [ratio(one.ruleHits, one.events), ratio(five.ruleHits, five.events)],
    };
  }

  /** One reading (every 5 s): the snapshot, and every alert it opened, moved or cleared. */
  read(now: number): { snapshot: KpiSnapshot; alerts: KpiAlert[] } {
    const at = new Date(now).toISOString();
    const values = this.values();
    const levels = Object.fromEntries(
      KPI_NAMES.map((n) => [n, levelOf(values[n][0], this.thresholds[n].warn, this.thresholds[n].crit)]),
    ) as Record<KpiName, KpiReading["level"]>;

    const alerts: KpiAlert[] = [];
    const changes = this.alerter.observe(levels);
    for (const name of KPI_NAMES) {
      const t = changes[name];
      if (!t) continue;
      const value = values[name][0] ?? 0; // a change always comes from a measured reading
      const threshold = this.thresholds[name][t.level];
      const prev = this.firing.get(name);
      let alert: KpiAlert;
      if (t.action === "open" || !prev) {
        alert = { id: this.nextId++, kind: "threshold", origin: "api", kpi: name, level: t.level, state: "firing", value, threshold, window: "1m", startedAt: at, updatedAt: at, clearedAt: null };
      } else if (t.action === "level") {
        alert = { ...prev, level: t.level, value, threshold, updatedAt: at };
      } else {
        alert = { ...prev, state: "cleared", value, threshold: threshold ?? prev.threshold, updatedAt: at, clearedAt: at };
      }
      if (alert.state === "firing") this.firing.set(name, alert);
      else this.firing.delete(name);
      alerts.push(alert);
    }

    const kpis: KpiReading[] = KPI_ORDER.map(({ name, unit }) => ({
      name,
      unit,
      value1m: values[name][0],
      value5m: values[name][1],
      warn: this.thresholds[name].warn,
      crit: this.thresholds[name].crit,
      level: levels[name],
      alertId: this.firing.get(name)?.id ?? null,
    }));
    return { snapshot: { computedAt: at, kpis }, alerts };
  }
}

/** A snapshot as a trend point. */
export const pointOf = (s: KpiSnapshot): KpiPoint => ({
  t: s.computedAt,
  values: Object.fromEntries(s.kpis.map((k) => [k.name, k.value1m])),
});
