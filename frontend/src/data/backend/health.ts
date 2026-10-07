// Pipeline health on the real backend, built from what actually arrives plus GET /freshness and /health.
// Anything the backend does not measure stays empty (PENDING on screen): nothing here is made up.
import type { JobStatus, OpsAlert, PipelineHealth } from "../types";
import type { FreshnessReport, JobRunWire, JobWire, OpsAlertWire, ServerHealth } from "./types";
import type { ScreenMinute } from "./screenTime";

const STALLED_MS = 5_000; // no events for 5 s: stalled
const DOWN_MS = 15_000; // 15 s: down
const RATE_WINDOW_MS = 5_000;
const HISTORY = 60;
const MINUTES = 30;

const iso = (ms: number) => new Date(ms).toISOString();
const minuteOf = (ms: number) => Math.floor(ms / 60_000) * 60_000;

export class HealthTracker {
  private arrivals: { at: number; n: number }[] = [];
  private lastEventAt = 0;
  private connected = false;
  private changedAt = 0; // when `connected` last changed
  private freshness: FreshnessReport | null = null;
  private history: { t: string; p95: number }[] = [];
  private perMinute = new Map<number, { rule: number; ai: number }>();
  private server: ServerHealth | null = null;
  private expired = 0;
  private decisions = { approved: 0, rejected: 0 };
  private model: string | null = null;
  private unsavedAt = -Infinity;
  private screen: ScreenMinute[] = [];
  private jobs: Map<string, JobStatus> | null = null; // null until GET /jobs answers
  private ops = new Map<number, OpsAlert>();

  /** GET /jobs: the schedule and each job's last run. */
  setJobs(rows: JobWire[]) {
    this.jobs = new Map(rows.map((j) => [j.job, {
      job: j.job, schedule: j.schedule, nextRunAt: j.next_run_at,
      lastRunAt: j.last_run?.finished_at ?? null, status: j.last_run?.status ?? null, detail: j.last_run?.detail ?? null,
    }]));
  }

  /** A `job_runs` row: that job's latest run. */
  jobRun(r: JobRunWire) {
    const jobs = this.jobs ?? new Map<string, JobStatus>();
    const prev = jobs.get(r.job);
    jobs.set(r.job, { job: r.job, schedule: prev?.schedule ?? "", nextRunAt: prev?.nextRunAt ?? null, lastRunAt: r.finished_at, status: r.status, detail: r.detail });
    this.jobs = jobs;
  }

  /** An `ops_alert`: kept while firing, gone when cleared. */
  opsAlert(a: OpsAlertWire) {
    if (a.state !== "firing") {
      this.ops.delete(a.id);
      return;
    }
    const kind = a.kind === "job_failed" || a.kind === "sla_breach" ? a.kind : "health";
    this.ops.set(a.id, { id: a.id, kind, source: a.source, level: a.level === "warn" ? "warn" : "crit", message: a.message, startedAt: a.started_at });
  }

  /** Time-to-screen minutes from the ScreenTimer. */
  setScreenTime(minutes: ScreenMinute[]) {
    this.screen = minutes;
  }

  setConnected(connected: boolean, now: number) {
    if (connected !== this.connected) this.changedAt = now;
    this.connected = connected;
  }

  /** A batch of events arrived (`dropped` = events the server skipped to protect the browser). */
  events(count: number, now: number) {
    this.arrivals.push({ at: now, n: count });
    if (count > 0) this.lastEventAt = now;
  }

  /** One backend alert: a rule hit, or a real model's. */
  detection(byModel: string | null, at: number) {
    const m = minuteOf(at);
    const b = this.perMinute.get(m) ?? { rule: 0, ai: 0 };
    if (byModel) {
      b.ai += 1;
      this.model = byModel;
    } else b.rule += 1;
    this.perMinute.set(m, b);
  }

  setFreshness(report: FreshnessReport | null, now: number) {
    this.freshness = report;
    if (report?.p95_seconds != null) {
      this.history = [...this.history, { t: iso(now), p95: Math.round(report.p95_seconds * 1000) }].slice(-HISTORY);
    }
  }

  setServer(health: ServerHealth | null) {
    this.server = health;
  }

  expiredOne() {
    this.expired += 1;
  }

  decided(decision: "approve" | "reject") {
    if (decision === "approve") this.decisions.approved += 1;
    else this.decisions.rejected += 1;
  }

  /** The server refused or never got a decision: say so for a minute. */
  decisionNotSaved(now: number) {
    this.unsavedAt = now;
  }

  /** The model_retrain job, once the ops service reports it. */
  private retraining(): PipelineHealth["retraining"] {
    const j = this.jobs?.get("model_retrain");
    if (!j) return { lastRun: null, nextRun: null, status: "scheduled" };
    return { lastRun: j.lastRunAt, nextRun: j.nextRunAt, status: j.status === "failed" ? "failed" : j.status === "ok" ? "ok" : "scheduled" };
  }

  snapshot(now: number): PipelineHealth {
    this.arrivals = this.arrivals.filter((a) => now - a.at < RATE_WINDOW_MS);
    const lastSign = Math.max(this.lastEventAt, this.changedAt);
    const silent = now - lastSign;

    let feed: PipelineHealth["feed"] = "live";
    if (!this.connected) feed = now - this.changedAt > DOWN_MS ? "down" : "stalled";
    else if (silent > DOWN_MS) feed = "down";
    else if (silent > STALLED_MS || this.freshness?.status === "stalled") feed = "stalled";

    const minutes = Array.from({ length: MINUTES }, (_, i) => minuteOf(now) - (MINUTES - 1 - i) * 60_000);
    for (const m of this.perMinute.keys()) if (m < minutes[0]) this.perMinute.delete(m);
    const detectionsPerMin = minutes.map((m) => ({ t: iso(m), ...(this.perMinute.get(m) ?? { rule: 0, ai: 0 }) }));

    const f = this.freshness;
    const alerts: PipelineHealth["alerts"] = [];
    if (!this.connected) alerts.push({ id: "connection", ts: iso(this.changedAt), sentence: "Lost connection to the server. Reconnecting." });
    else if (this.server?.status === "degraded") {
      const part = !this.server.postgres ? "database" : "event stream";
      alerts.push({ id: "server", ts: iso(now), sentence: `The server reports its ${part} is not responding.` });
    }
    if (now - this.unsavedAt < 60_000) {
      alerts.push({ id: "decision", ts: iso(this.unsavedAt), sentence: "A decision was not saved on the server. It is not in the log." });
    }

    return {
      feed,
      lastEventAt: iso(lastSign || now),
      eventsPerSec: Math.round(this.arrivals.reduce((s, a) => s + a.n, 0) / (RATE_WINDOW_MS / 1000)),
      eventsToday: null, // the backend does not count a day's events
      freshnessMs:
        f?.p95_seconds != null ? { p50: Math.round((f.p50_seconds ?? f.p95_seconds) * 1000), p95: Math.round(f.p95_seconds * 1000) } : null,
      slaMs: 5000, // the backend's freshness_sla_p95_seconds (api/db/init.sql)
      freshnessHistory: this.history,
      timeToScreenMs: this.screen.length ? { p95: this.screen[this.screen.length - 1].p95, minute: this.screen[this.screen.length - 1].t } : null,
      timeToScreenHistory: this.screen.map((m) => ({ t: m.t, p95: m.p95 })),
      detections: detectionsPerMin.reduce((acc, m) => ({ rule: acc.rule + m.rule, ai: acc.ai + m.ai }), { rule: 0, ai: 0 }),
      detectionsPerMin,
      expiredToday: this.expired,
      judgedNormalToday: 0, // the backend has no "judged normal" checks yet
      models: [
        { name: "ATDE", version: this.model ?? "", trainedAt: null, status: this.model ? "ready" : "pending" },
        { name: "CRIE", version: "", trainedAt: null, status: "pending" },
      ],
      retraining: this.retraining(),
      alerts,
      jobs: this.jobs ? [...this.jobs.values()] : null,
      opsAlerts: [...this.ops.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)),
      decisions: { ...this.decisions },
    };
  }
}
