// Run with: npm test. Live KPIs: the crossing rules (the same cases as the backend's tests/test_kpi.py),
// the backend's messages in our shapes, the simulated feed's KPIs, and how values read on screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KPI_NAMES, KpiAlerter, KpiTrack, levelOf } from "../src/data/kpi.ts";
import { kpiAlertFromApi, kpiHistoryFromApi, kpiSnapshotFromApi, thresholdsFromConfig } from "../src/data/backend/kpi.ts";
import { MockKpi, MOCK_THRESHOLDS, type SecondCounts } from "../src/data/mockKpi.ts";
import { formatKpiValue, fromInput, kpiAlertSentence, toInput } from "../src/lib/kpiFormat.ts";
import type { KpiLevel } from "../src/data/types.ts";

/** One KPI's readings in order -> [index, action, level] for each change. */
function run(levels: KpiLevel[]) {
  const t = new KpiTrack();
  const out: [number, string, string][] = [];
  levels.forEach((l, i) => {
    const step = t.step(l);
    if (step) out.push([i, step.action, step.level]);
  });
  return out;
}

test("a reading's level: at the line counts as over it; no lines, never a breach", () => {
  assert.equal(levelOf(null, 1, 2), "no_data");
  assert.equal(levelOf(0.5, 1, 2), "ok");
  assert.equal(levelOf(1, 1, 2), "warn");
  assert.equal(levelOf(2, 1, 2), "crit");
  assert.equal(levelOf(5, null, null), "ok");
  assert.equal(levelOf(5, null, 3), "crit");
});

test("an alert opens after 2 breaches in a row, at the lower level", () => {
  assert.deepEqual(run(["crit", "ok", "crit", "ok"]), []);
  assert.deepEqual(run(["ok", "warn", "warn"]), [[2, "open", "warn"]]);
  assert.deepEqual(run(["warn", "crit"]), [[1, "open", "warn"]]);
  assert.deepEqual(run(["crit", "warn"]), [[1, "open", "warn"]]);
  assert.deepEqual(run(["crit", "crit"]), [[1, "open", "crit"]]);
});

test("no data neither counts nor breaks a streak", () => {
  assert.deepEqual(run(["warn", "no_data", "warn"]), [[2, "open", "warn"]]);
  assert.deepEqual(run(["warn", "warn", "ok", "no_data", "ok"]), [[1, "open", "warn"], [4, "clear", "warn"]]);
});

test("it clears after 2 normal readings, keeps its level, and can open again", () => {
  assert.deepEqual(run(["crit", "crit", "ok", "crit", "ok", "crit"]), [[1, "open", "crit"]]);
  assert.deepEqual(run(["crit", "crit", "ok", "ok", "warn", "warn"]), [[1, "open", "crit"], [3, "clear", "crit"], [5, "open", "warn"]]);
});

test("2 readings in a row at the other level move it; one does not", () => {
  assert.deepEqual(run(["warn", "warn", "crit", "crit"]), [[1, "open", "warn"], [3, "level", "crit"]]);
  assert.deepEqual(run(["crit", "crit", "warn", "warn"]), [[1, "open", "crit"], [3, "level", "warn"]]);
  assert.deepEqual(run(["warn", "warn", "crit", "warn", "crit", "warn"]), [[1, "open", "warn"]]);
  assert.deepEqual(run(["warn", "warn", "crit", "ok", "crit"]), [[1, "open", "warn"]]);
});

test("every KPI has its own track", () => {
  const a = new KpiAlerter();
  const base = Object.fromEntries(KPI_NAMES.map((n) => [n, "ok" as KpiLevel]));
  assert.deepEqual(a.observe({ ...base, http_5xx_rate: "crit" }), {});
  const changes = a.observe({ ...base, http_5xx_rate: "crit", login_failure_rate: "warn" });
  assert.deepEqual(Object.keys(changes), ["http_5xx_rate"]);
});

test("the backend's kpi message: all five, in order; unknown names dropped, missing ones read as no data", () => {
  const s = kpiSnapshotFromApi({
    computed_at: "2026-10-07T09:15:05.002000+00:00",
    kpis: [
      { name: "login_failure_rate", unit: "ratio", value_1m: 0.46, value_5m: 0.21, warn: 0.2, crit: 0.4, level: "crit", alert_id: 7 },
      { name: "cpu", unit: "%", value_1m: 99, value_5m: 99, warn: null, crit: null, level: "crit", alert_id: null },
    ],
  });
  assert.deepEqual(s.kpis.map((k) => k.name), [...KPI_NAMES]);
  const lf = s.kpis[1];
  assert.deepEqual([lf.value1m, lf.level, lf.alertId, lf.warn], [0.46, "crit", 7, 0.2]);
  assert.deepEqual([s.kpis[0].value1m, s.kpis[0].level], [null, "no_data"]);
});

test("the backend's kpi_alert, history and config", () => {
  const wire = {
    id: 7, kind: "threshold", origin: "api", kpi: "login_failure_rate", level: "crit", state: "firing",
    value: 0.46, threshold: 0.4, window: "1m",
    started_at: "2026-10-07T09:15:00.004000+00:00", updated_at: "2026-10-07T09:15:05.002000+00:00", cleared_at: null,
  };
  const a = kpiAlertFromApi(wire);
  assert.deepEqual([a?.id, a?.level, a?.startedAt, a?.clearedAt], [7, "crit", "2026-10-07T09:15:00.004000+00:00", null]);
  assert.equal(kpiAlertFromApi({ ...wire, level: "info" }), null); // a level we do not know is not shown as one
  const h = kpiHistoryFromApi({ latest: null, history: [{ computed_at: "2026-10-07 09:00:05", values: { events_per_sec: 10.9, cpu: 3 } }] });
  assert.deepEqual(h, [{ t: "2026-10-07T09:00:05Z", values: { events_per_sec: 10.9 } }]);
  const t = thresholdsFromConfig({ "kpi.http_5xx_rate.warn": 0.02, "kpi.http_5xx_rate.crit": null, "kpi.events_per_sec.warn": "fast" });
  assert.deepEqual(t.http_5xx_rate, { warn: 0.02, crit: null });
  assert.deepEqual(t.events_per_sec, { warn: null, crit: null });
});

const second = (over: Partial<SecondCounts> = {}): SecondCounts => ({
  events: 200, logins: 16, loginFailures: 1, requests: 180, errors5xx: 1, bytes: 2_400_000, ruleHits: 4, ...over,
});

test("simulated KPIs use the backend's definitions over 1 and 5 minutes", () => {
  const k = new MockKpi();
  for (let i = 0; i < 300; i++) k.push(second(i >= 240 ? { events: 400, logins: 40, loginFailures: 20 } : {}));
  const v = k.values();
  assert.deepEqual(v.events_per_sec, [400, 240]); // last minute 400/s; 5 minutes (4x200 + 400)/5
  assert.equal(v.login_failure_rate[0], 0.5);
  assert.equal(v.bytes_out_per_min[0], 60 * 2_400_000);
  const empty = new MockKpi();
  empty.push(second({ events: 0, logins: 0, loginFailures: 0, requests: 0, errors5xx: 0, ruleHits: 0 }));
  assert.equal(empty.values().login_failure_rate[0], null); // a rate of nothing is unknown, not 0
});

test("the simulated feed raises, moves and clears alerts like the backend", () => {
  const k = new MockKpi();
  const minute = (over: Partial<SecondCounts>) => {
    for (let i = 0; i < 60; i++) k.push(second(over));
  };
  minute({});
  assert.equal(k.read(0).alerts.length, 0);
  minute({ logins: 40, loginFailures: 10 }); // 25%: warning
  assert.equal(k.read(5_000).alerts.length, 0); // one breach
  const opened = k.read(10_000);
  assert.equal(opened.alerts[0].state, "firing");
  assert.equal(opened.alerts[0].level, "warn");
  assert.equal(opened.snapshot.kpis[1].alertId, opened.alerts[0].id);
  minute({ logins: 40, loginFailures: 20 }); // 50%: critical
  k.read(15_000);
  const raised = k.read(20_000).alerts[0];
  assert.deepEqual([raised.state, raised.level, raised.id, raised.threshold], ["firing", "crit", opened.alerts[0].id, MOCK_THRESHOLDS.login_failure_rate.crit]);
  minute({});
  k.read(25_000);
  const cleared = k.read(30_000).alerts[0];
  assert.deepEqual([cleared.state, cleared.level, cleared.clearedAt], ["cleared", "crit", new Date(30_000).toISOString()]);
  assert.equal(k.read(35_000).snapshot.kpis[1].alertId, null);
});

test("values read the way people read them; lines go in and out in the page's units", () => {
  assert.equal(formatKpiValue("events_per_sec", 214.4), "214");
  assert.equal(formatKpiValue("events_per_sec", 8.44), "8.4");
  assert.equal(formatKpiValue("login_failure_rate", 0.46), "46%");
  assert.equal(formatKpiValue("http_5xx_rate", 0.004), "0.4%");
  assert.equal(formatKpiValue("bytes_out_per_min", 148_000_000), "148 MB");
  assert.equal(formatKpiValue("bytes_out_per_min", 1_200_000_000), "1.2 GB");
  assert.equal(toInput("login_failure_rate", 0.2), "20");
  assert.equal(toInput("bytes_out_per_min", 200_000_000), "200");
  assert.equal(toInput("events_per_sec", null), "");
  assert.deepEqual(fromInput("login_failure_rate", "20"), { value: 0.2 });
  assert.deepEqual(fromInput("http_5xx_rate", "0,5"), { value: 0.005 });
  assert.deepEqual(fromInput("bytes_out_per_min", "200"), { value: 200_000_000 });
  assert.deepEqual(fromInput("events_per_sec", " "), { value: null });
  assert.ok("error" in fromInput("events_per_sec", "-1"));
  assert.ok("error" in fromInput("rule_hit_rate", "120"));
  assert.ok("error" in fromInput("events_per_sec", "fast"));
});

test("the alert toast says what crossed which line", () => {
  const a = { id: 7, kind: "threshold", origin: "api", kpi: "login_failure_rate", level: "crit", state: "firing", value: 0.46, threshold: 0.4, window: "1m", startedAt: "", updatedAt: "", clearedAt: null } as const;
  assert.equal(kpiAlertSentence(a), "Login failures: critical at 46%, over the 40% line.");
});
