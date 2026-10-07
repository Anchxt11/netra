// Time to screen (docs/SLA.md): from the event's own event_ts to this browser receiving it, on the
// server's clock (our clock plus the offset measured from "hello"). p95 per finished minute.
// A minute over the SLA raises a local kpi_alert of kind "sla" (contracts/LIVE_API.md 4.2);
// the next minute within it clears that alert. The API never sees these.
import type { KpiAlert } from "../types.ts";

const MINUTE = 60_000;
const KEEP_MINUTES = 30;
const MAX_SAMPLES_PER_MINUTE = 20_000; // enough for 10x load; past this the minute is sampled evenly

export interface ScreenMinute {
  t: string; // the minute's start
  p95: number; // ms
  n: number;
}

const iso = (ms: number) => new Date(ms).toISOString();
const minuteOf = (ms: number) => Math.floor(ms / MINUTE) * MINUTE;

export function p95(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}

export class ScreenTimer {
  private minute = -1;
  private lags: number[] = [];
  private seen = 0;
  private done: ScreenMinute[] = [];
  private alert: KpiAlert | null = null;
  private readonly slaMs: number;

  constructor(slaMs = 5000) {
    this.slaMs = slaMs;
  }

  /** One event arrived. `eventTs` its event_ts, `receivedAt` our clock, `offsetMs` server minus ours. */
  record(eventTs: string, receivedAt: number, offsetMs: number): KpiAlert | null {
    const sent = Date.parse(eventTs);
    if (!Number.isFinite(sent)) return null;
    const at = receivedAt + offsetMs;
    const raised = this.roll(at);
    this.seen += 1;
    const lag = Math.max(0, at - sent);
    if (this.lags.length < MAX_SAMPLES_PER_MINUTE) this.lags.push(lag);
    else this.lags[Math.floor(Math.random() * this.lags.length)] = lag; // keep an even sample
    return raised;
  }

  /** Close the minute when the clock passes it, even with no new events. Returns an alert change, if any. */
  tick(now: number): KpiAlert | null {
    return this.roll(now);
  }

  private roll(at: number): KpiAlert | null {
    const m = minuteOf(at);
    if (this.minute === -1) this.minute = m;
    if (m === this.minute) return null;
    const value = p95(this.lags);
    const closed = this.minute;
    this.minute = m;
    this.lags = [];
    const n = this.seen;
    this.seen = 0;
    if (value === null) return null; // a minute with no events says nothing about the SLA
    this.done = [...this.done, { t: iso(closed), p95: value, n }].slice(-KEEP_MINUTES);
    return this.judge(value, closed + MINUTE);
  }

  private judge(valueMs: number, at: number): KpiAlert | null {
    const ts = iso(at);
    const over = valueMs > this.slaMs;
    if (over && !this.alert) {
      this.alert = {
        id: null, kind: "sla", origin: "browser", kpi: "time_to_screen_p95", level: "crit", state: "firing",
        value: valueMs / 1000, threshold: this.slaMs / 1000, window: "1m", startedAt: ts, updatedAt: ts, clearedAt: null,
      };
      return this.alert;
    }
    if (over && this.alert) {
      this.alert = { ...this.alert, value: valueMs / 1000, updatedAt: ts };
      return null; // still over: nothing new to announce
    }
    if (!over && this.alert) {
      const cleared: KpiAlert = { ...this.alert, state: "cleared", value: valueMs / 1000, updatedAt: ts, clearedAt: ts };
      this.alert = null;
      return cleared;
    }
    return null;
  }

  /** Finished minutes, oldest first. */
  minutes(): ScreenMinute[] {
    return this.done;
  }
}
