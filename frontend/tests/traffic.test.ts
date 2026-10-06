// Run with: npm test. The live monitor on the real backend: every event counts, a few are shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TrafficMeter, feedEvent } from "../src/data/backend/traffic.ts";
import type { EnrichedEvent } from "../src/data/backend/types.ts";

let n = 0;
const ev = (over: Partial<EnrichedEvent>): EnrichedEvent => ({
  event_id: `e${++n}`,
  event_ts: new Date(Date.UTC(2026, 9, 7, 10, 0, n)).toISOString(),
  ip: "198.51.100.7",
  event_type: "http_request",
  method: "GET",
  path: "/products/41",
  http_status: 200,
  rule_hits: [],
  ...over,
});

test("every event counts, normal or flagged, and the second starts over after a flush", () => {
  const m = new TrafficMeter();
  m.addEvents([ev({}), ev({}), ev({ path: "/.env", http_status: 404, rule_hits: ["web_scan"] })], 4);
  m.addAi(ev({ event_type: "data_transfer", user: "r.mehta", bytes_out: 277_000_000 }), 0.81);
  const { second, events } = m.flush(Date.UTC(2026, 9, 7, 10, 1, 0));
  assert.deepEqual([second.normal, second.rule, second.ai], [6, 1, 1]); // 2 seen + 4 dropped, 1 rule, 1 AI
  assert.equal(events.length, 4);
  assert.deepEqual(events.find((e) => e.flag?.by === "rule")?.flag, { by: "rule", label: "SCAN" });
  assert.equal(events.find((e) => e.flag?.by === "ai")?.what, "r.mehta sent 277 MB");
  assert.equal(m.flush(0).second.normal, 0);
});

test("the feed says what happened in plain words", () => {
  assert.equal(feedEvent(ev({ event_type: "login", status: "failure", user: "maria.silva" })).what, "login failed for maria.silva");
  assert.equal(feedEvent(ev({ event_type: "process_start", user: "admin1", process: "cat /etc/shadow" })).what, "admin1 ran cat /etc/shadow");
  assert.equal(feedEvent(ev({ path: "/search?q=lamp" })).what, "GET /search?q=lamp · 200");
});
