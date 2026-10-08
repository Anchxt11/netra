// Run with: npm test. CRIE (model 2) on the live backend: its input, its answer as fix cards, and when it is asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Correlator } from "../src/data/backend/correlate.ts";
import { CrieClient, sentenceCase, toFix, withAnswer, type CrieAnswer, type CrieRequest } from "../src/data/backend/crie.ts";
import type { AlertRow, EnrichedEvent } from "../src/data/backend/types.ts";
import type { Incident } from "../src/data/types.ts";

const T0 = Date.parse("2026-10-07T10:00:00Z");
let n = 0;

function setup() {
  const live = new Map<string, Incident>();
  const c = new Correlator({ upsert: (i) => live.set(i.id, i), remove: () => {}, expire: () => {} });
  return { c, live };
}
function hit(c: Correlator, rule: string | null, ev: Partial<EnrichedEvent>, row: Partial<AlertRow> = {}) {
  const e: EnrichedEvent = { event_id: `e${++n}`, event_ts: new Date(T0).toISOString(), ip: "172.30.0.10", host: "juice-shop", ...ev };
  c.addEvents([e], T0);
  c.addAlert({ id: ++n, alert_id: `a${n}`, rule_id: rule, model: null, severity: "high", event_ids: [e.event_id], status: "open", created_ts: e.event_ts, ...row }, T0);
}

const FIXES: CrieAnswer = {
  version: "crie-unversioned-f924f6e1",
  fixes: [
    { action_id: "block_ips", name: "Block Source IPs", d3fend: { id: "D3-ITF", name: "Inbound Traffic Filtering" }, confidence: 0.81, rank: 2,
      reasons: [{ feature: "knowledge_base_evidence", value: 1, contribution: 0.75 }, { feature: "ml_probability", value: 0.24, contribution: 0.06 }],
      provenance: ["MITRE ATT&CK", "D3FEND"] },
    { action_id: "reset_credentials", name: "Reset Credentials", d3fend: { id: "D3-RIC", name: "Reissue Credential" }, confidence: 0.9705, rank: 1,
      reasons: [{ feature: "knowledge_base_evidence", value: 1, contribution: 0.75 }, { feature: "ml_probability", value: 0.8821, contribution: 0.2205 }],
      provenance: ["MITRE ATT&CK", "Elastic Detection Rules", "D3FEND"] },
    { action_id: "enable_mfa", name: "Enable MFA", d3fend: null, confidence: 0.7, rank: 3, reasons: [] },
  ],
};

test("CRIE's input: the attack, its technique, the backend rules, and who is involved", () => {
  const { c, live } = setup();
  for (let i = 0; i < 3; i++) hit(c, "brute_force", { event_type: "login", status: "failure", user: "admin@juice-sh.op" });
  const id = [...live.keys()][0];
  assert.deepEqual(c.crieInput(id), {
    incident_id: id,
    attack_type: "brute_force",
    mitre_technique: "T1110.001",
    severity: 4,
    detected_by: "rule",
    rules: ["brute_force"],
    model: null,
    context: { src_ips: ["172.30.0.10"], usernames: ["admin@juice-sh.op"], hosts: ["juice-shop"], dst_ip: null, domain: null },
  });
});

test("CRIE's input carries model 1's view of an unnamed anomaly that joined a rule incident", () => {
  const { c, live } = setup();
  hit(c, "web_scan", { ip: "10.0.4.17", event_type: "http_request", path: "/admin" });
  c.addAlert({
    id: 1, alert_id: "m1", rule_id: null, model: "atde-1.0.0", severity: "low", event_ids: ["f1"], status: "open",
    created_ts: new Date(T0).toISOString(), ip: "10.0.4.17", user: "-", host: "10.0.9.2", class: "anomaly",
    probability: null, anomaly_score: 0.74, risk_score: 0.74, reasons: [{ feature: "cnt_60s", value: 42 }, { feature: "nports_60s", value: 9 }],
  }, T0);
  assert.equal(live.size, 1); // joined the rule incident; no AI-only incident
  const input = c.crieInput([...live.keys()][0]);
  assert.equal(input?.detected_by, "both");
  assert.deepEqual(input?.model, { attack_family: "UNKNOWN", confidence: null, is_unknown: true, if_score: 0.74, top3: ["cnt_60s", "nports_60s"] });
});

test("CRIE's fixes become fix cards: ranked, sentence case, each reason saying which part of the score it is", () => {
  assert.equal(sentenceCase("Reset Credentials"), "Reset credentials");
  assert.equal(sentenceCase("Enable MFA"), "Enable MFA");
  assert.equal(sentenceCase("Block Source IPs"), "Block source IPs");
  const fix = toFix(FIXES.fixes![1]);
  assert.deepEqual(fix, {
    actionId: "reset_credentials",
    name: "Reset credentials",
    d3fend: { id: "D3-RIC", name: "Reissue Credential" },
    confidence: 0.9705,
    rank: 1,
    reasons: [
      { feature: "knowledge_base_evidence", value: 1, contribution: 0.75, sentence: "Knowledge-base evidence 1.00, from MITRE ATT&CK, Elastic Detection Rules, D3FEND" },
      { feature: "ml_probability", value: 0.8821, contribution: 0.2205, sentence: "CRIE's model rates it 0.88" },
    ],
  });
  const inc = { fixes: [], fallback: { technique: "T1110", mitigations: [{ id: "M1032", name: "Multi-factor Authentication" }] } } as unknown as Incident;
  const withFixes = withAnswer(inc, FIXES);
  assert.deepEqual(withFixes.fixes.map((f) => [f.rank, f.actionId]), [[1, "reset_credentials"], [2, "block_ips"], [3, "enable_mfa"]]);
  assert.equal(withFixes.fixes[2].d3fend.name, ""); // no mapping: the card says "pending"
});

test("CRIE's fallback keeps our MITRE mitigations while its own list is empty", () => {
  const inc = { fixes: [], fallback: { technique: "T1110", mitigations: [{ id: "M1032", name: "Multi-factor Authentication" }] } } as unknown as Incident;
  const out = withAnswer(inc, { version: "v", fallback: { technique: "T1110", mitigations: [] } });
  assert.deepEqual(out.fixes, []);
  assert.deepEqual(out.fallback, inc.fallback);
});

test("CRIE is asked once an incident settles, again only when its input changes, and never after it is gone", async () => {
  const asked: CrieRequest[] = [];
  const answered: string[] = [];
  const client = new CrieClient(async (req) => (asked.push(req), FIXES), (id) => answered.push(id));
  const req = (severity: number): CrieRequest => ({
    incident_id: "0001", attack_type: "brute_force", mitre_technique: "T1110.001", severity, detected_by: "rule",
    rules: ["brute_force"], model: null, context: { src_ips: [], usernames: [], hosts: [], dst_ip: null, domain: null },
  });
  const t = mockTimers();
  client.changed(req(4));
  client.changed(req(4)); // a re-publish within the debounce: one call
  await t.run();
  assert.equal(asked.length, 1);
  assert.deepEqual(answered, ["0001"]);
  assert.equal(client.version("0001"), "crie-unversioned-f924f6e1");
  client.changed(req(4)); // same input: no new call
  await t.run();
  assert.equal(asked.length, 1);
  client.changed(req(5)); // new evidence: ask again
  client.forget("0001"); // ...but it was decided first
  await t.run();
  assert.equal(asked.length, 1);
  t.restore();
});

test("a failed call keeps MITRE's mitigations and tries again later", async () => {
  let calls = 0;
  const client = new CrieClient(async () => {
    calls += 1;
    if (calls === 1) throw new Error("503 CRIE is loading");
    return FIXES;
  }, () => {});
  const t = mockTimers();
  client.changed({ incident_id: "0002", attack_type: "web_scan", mitre_technique: "T1595.003", severity: 3, detected_by: "rule", rules: ["web_scan"], model: null, context: { src_ips: [], usernames: [], hosts: [], dst_ip: null, domain: null } });
  await t.run();
  assert.equal(client.answer("0002"), undefined);
  await t.run(); // the retry
  assert.equal(calls, 2);
  assert.ok(client.answer("0002"));
  t.restore();
});

/** Runs pending setTimeout callbacks immediately, so the debounce and retry need no real waiting. */
function mockTimers() {
  const real = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
  let queue = new Map<number, () => void>();
  let next = 1;
  globalThis.setTimeout = ((fn: () => void) => (queue.set(next, fn), next++)) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => queue.delete(id)) as unknown as typeof clearTimeout;
  return {
    async run() {
      const due = [...queue.values()];
      queue = new Map();
      for (const fn of due) fn();
      await new Promise((r) => real.set(r, 0)); // let the calls settle
    },
    restore() {
      globalThis.setTimeout = real.set;
      globalThis.clearTimeout = real.clear;
    },
  };
}

test("CRIE's containment note for a critical incident reads as a sentence", () => {
  const fix = toFix({
    action_id: "collect_evidence", name: "Collect Evidence", d3fend: null, confidence: 0.6, rank: 3,
    reasons: [
      { feature: "knowledge_base_evidence", value: 0.5, contribution: 0.375 },
      { feature: "ml_probability", value: 0.4, contribution: 0.1 },
      { feature: "containment_status", value: "No containment action feasible for this technique", contribution: 0 },
    ],
  });
  assert.equal(fix.reasons[2].sentence, "No containment action feasible for this technique.");
});
