// Run with: npm test. The ops service on the real backend: jobs and ops alerts as SYSTEM gets them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HealthTracker } from "../src/data/backend/health.ts";

const run = (job: string, status: "ok" | "failed" | "skipped", at: string) => ({
  id: 1, job, started_at: at, finished_at: at, duration_ms: 3, status, detail: status === "failed" ? "boom" : "fine", result: null,
});

test("jobs: PENDING until the API answers, then each job's last run; a job_runs row replaces it", () => {
  const h = new HealthTracker();
  assert.equal(h.snapshot(0).jobs, null);
  h.setJobs([
    { job: "model_retrain", schedule: "daily 02:00", next_run_at: "2026-10-08T02:00:00+00:00", last_run: run("model_retrain", "skipped", "2026-10-07T02:00:00Z"), consecutive_failures: 0 },
    { job: "health_watch", schedule: "every 10 s", next_run_at: null, last_run: null, consecutive_failures: 0 },
  ]);
  let s = h.snapshot(0);
  assert.deepEqual(s.retraining, { lastRun: "2026-10-07T02:00:00Z", nextRun: "2026-10-08T02:00:00+00:00", status: "scheduled" });
  h.jobRun(run("model_retrain", "failed", "2026-10-08T02:00:01Z"));
  s = h.snapshot(0);
  assert.equal(s.jobs?.find((j) => j.job === "model_retrain")?.status, "failed");
  assert.equal(s.jobs?.find((j) => j.job === "model_retrain")?.schedule, "daily 02:00");
  assert.equal(s.retraining.status, "failed");
});

test("ops alerts: shown while firing, gone when cleared", () => {
  const h = new HealthTracker();
  const a = { id: 31, kind: "health", source: "clickhouse", level: "crit", state: "firing", message: "ClickHouse is not answering.", started_at: "2026-10-07T09:20:10Z", updated_at: "2026-10-07T09:20:10Z", cleared_at: null };
  h.opsAlert(a);
  assert.deepEqual(h.snapshot(0).opsAlerts.map((x) => x.message), ["ClickHouse is not answering."]);
  h.opsAlert({ ...a, state: "cleared", cleared_at: "2026-10-07T09:21:00Z" });
  assert.deepEqual(h.snapshot(0).opsAlerts, []);
});
