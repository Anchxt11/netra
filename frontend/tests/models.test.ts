// Run with: npm test. ATDE's and CRIE's status come from the backend's `models` report, never from alerts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HealthTracker } from "../src/data/backend/health.ts";
import type { ModelWire } from "../src/data/backend/types.ts";

const NOW = Date.parse("2026-10-07T09:21:05Z");

const atde = (over: Partial<ModelWire> = {}): ModelWire => ({
  name: "ATDE", model_id: "atde-1.0.0", version: "1.0.0", status: "ready",
  trained_at: "2026-10-06T21:40:00+00:00", detail: null, ...over,
});
const crie: ModelWire = { name: "CRIE", model_id: null, version: null, status: "pending", trained_at: null, detail: "Not in the live pipeline yet." };

test("before the backend reports, both models are pending, even after AI alerts", () => {
  const h = new HealthTracker();
  h.detection(true, NOW);
  const models = h.snapshot(NOW).models;
  assert.deepEqual(models.map((m) => [m.name, m.status]), [["ATDE", "pending"], ["CRIE", "pending"]]);
});

test("the models report sets each model's status and version", () => {
  const h = new HealthTracker();
  h.setModels([atde(), crie]);
  assert.deepEqual(h.snapshot(NOW).models, [
    { name: "ATDE", version: "1.0.0", trainedAt: "2026-10-06T21:40:00+00:00", status: "ready" },
    { name: "CRIE", version: "", trainedAt: null, status: "pending" },
  ]);
  h.setModels([atde({ status: "offline" }), crie]); // the whole list replaces the last one
  assert.equal(h.snapshot(NOW).models[0].status, "offline");
});

test("DETECTIONS / MIN splits rules and AI", () => {
  const h = new HealthTracker();
  h.detection(false, NOW);
  h.detection(false, NOW);
  h.detection(true, NOW);
  assert.deepEqual(h.snapshot(NOW).detections, { rule: 2, ai: 1 });
});
