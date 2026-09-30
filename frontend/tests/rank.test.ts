// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessRisk, rankIncidents } from "../src/lib/rank.ts";
import { heatState, isGoingCold } from "../src/lib/heat.ts";
import { blipAngle, FAMILY_CENTRE, BLIP_SPREAD } from "../src/lib/family.ts";

// The worked examples table in docs/DATA_CONTRACT.md, "Ranking".
const examples = [
  { name: "credential stuffing, account taken over", sev: 5, attn: 100, remaining: 1.0, risk: 0.5, tier: "ACT NOW" },
  { name: "HTTP flood, just started", sev: 4, attn: 70, remaining: 0.9, risk: 0.31, tier: "ACT SOON" },
  { name: "same flood, 80% of its window gone", sev: 4, attn: 70, remaining: 0.2, risk: 0.5, tier: "ACT NOW" },
  { name: "data exfiltration, thin evidence", sev: 5, attn: 45, remaining: 0.5, risk: 0.34, tier: "ACT SOON" },
  { name: "brute force", sev: 3, attn: 60, remaining: 0.3, risk: 0.31, tier: "ACT SOON" },
  { name: "web scan", sev: 2, attn: 40, remaining: 0.5, risk: 0.12, tier: "WATCH" },
] as const;

for (const ex of examples) {
  test(`worked example: ${ex.name}`, () => {
    const r = assessRisk(ex.sev, ex.attn, ex.remaining);
    assert.equal(r.risk.toFixed(2), ex.risk.toFixed(2));
    assert.equal(r.tier, ex.tier);
  });
}

test("weak evidence (attention under 30) is always WATCH", () => {
  assert.equal(assessRisk(5, 29, 0).tier, "WATCH");
});

test("ACT NOW needs attention of at least 50", () => {
  assert.equal(assessRisk(5, 49, 0).tier, "ACT SOON"); // risk 0.49 is above 0.45, attention is not
});

test("sort: tier, then risk descending, then time left ascending", () => {
  const now = Date.parse("2026-10-01T10:00:00Z");
  const at = (minutesAgo: number, windowMin: number) => {
    const created = now - minutesAgo * 60_000;
    return { createdAt: new Date(created).toISOString(), staleBy: new Date(created + windowMin * 60_000).toISOString() };
  };
  const items = [
    { id: "scan", severity: 2, attentionScore: 40, ...at(5, 10) }, // WATCH
    { id: "flood-fresh", severity: 4, attentionScore: 70, ...at(0.3, 3) }, // ACT SOON
    { id: "cs-ato", severity: 5, attentionScore: 100, ...at(0, 10) }, // ACT NOW, risk 0.50
    { id: "flood-old", severity: 4, attentionScore: 70, ...at(2.4, 3) }, // ACT NOW, risk 0.504
    { id: "tie-b", severity: 3, attentionScore: 60, ...at(5, 10) }, // ACT SOON, same risk as tie-a, less time left
    { id: "tie-a", severity: 3, attentionScore: 60, ...at(10, 20) },
  ];
  const order = rankIncidents(items, now).map((i) => i.id);
  assert.deepEqual(order, ["flood-old", "cs-ato", "flood-fresh", "tie-b", "tie-a", "scan"]);
});

test("heat thresholds", () => {
  assert.equal(heatState(1), "hot");
  assert.equal(heatState(0.5), "warm");
  assert.equal(heatState(0.2), "cool");
  assert.equal(heatState(0), "stale");
  assert.equal(isGoingCold(0.1), true);
  assert.equal(isGoingCold(0), false);
});

test("blips stay inside their family sector and never move", () => {
  for (const id of ["a", "inc-0142", "xyz-999", "0b1c5e0e"]) {
    const angle = blipAngle(id, "http_flood");
    assert.ok(Math.abs(angle - FAMILY_CENTRE.FLOOD) <= BLIP_SPREAD);
    assert.equal(angle, blipAngle(id, "http_flood"));
  }
});
