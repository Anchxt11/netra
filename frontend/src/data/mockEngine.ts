// The simulated backend. Emits the same envelope messages as the real WebSocket, on timers,
// from a fixed seed. Background behaviour only; the scripted demo scenarios come later.
// Spec: docs/DATA_CONTRACT.md, "Mock engine".
import type { AttackType, BenignAnomaly, BenignKind, Incident, PipelineHealth, Signal, SignalLevel } from "./types";
import type { ConnectionStatus, DataSource, Decision, ServerMessage } from "./source";
import { createRng } from "./rng";
import {
  ADMIN_COMMANDS,
  AI_POINTS,
  ATTACK_TYPES,
  BENIGN,
  INJECTIONS,
  RULES,
  SCENARIOS,
  SENSITIVE_PATHS,
  USERS,
  randomIp,
  type Ctx,
} from "./catalog";
import { assessRisk, type Tier } from "../lib/rank";
import { remainingShare } from "../lib/heat";

const SEED = 20261001;
const TICK_MS = 1000;
const OPEN_MIN = 6;
const OPEN_MAX = 10;

type Strength = "weak" | "medium" | "strong";
type AiMode = "none" | "mixed" | "only";

interface Live {
  incident: Incident;
  ctx: Ctx;
  pending: string[]; // signals still to fire, in order
  nextSignalAt: number;
  noFix: boolean; // CRIE found nothing confident enough
  jitter: number[]; // stable per-incident variation in fix confidence
}

const iso = (t: number) => new Date(t).toISOString();
const round2 = (v: number) => Math.round(v * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");
const levelFor = (score: number): SignalLevel => (score >= 60 ? "critical" : score >= 30 ? "suspicious" : "normal");
const minuteStart = (t: number) => Math.floor(t / 60_000) * 60_000;

class MockEngine {
  private r = createRng(SEED);
  private live = new Map<string, Live>();
  private nextNumber = 131;
  private nextBenign = 1;
  private health: PipelineHealth;
  private emit: (msg: ServerMessage) => void = () => {};
  private timers: number[] = [];
  private nextSpawnAt = 0;
  private nextBenignAt = 0;

  constructor() {
    this.health = this.initialHealth(Date.now());
  }

  start(emit: (msg: ServerMessage) => void) {
    this.emit = emit;
    const now = Date.now();
    emit({ type: "hello", payload: { serverTime: iso(now) } });
    emit({ type: "health", payload: structuredClone(this.health) });

    // Never an empty screen on first load: a morning's worth of state already exists.
    this.addBenign("flash_crowd", now - 21 * 60_000, false);
    const seeds: { type: AttackType; strength: Strength; ageFrac: number; ai: AiMode }[] = [
      { type: "data_exfiltration", strength: "strong", ageFrac: 0.35, ai: "mixed" },
      { type: "http_flood", strength: "strong", ageFrac: 0.75, ai: "none" },
      { type: "credential_stuffing", strength: "medium", ageFrac: 0.5, ai: "none" },
      { type: "brute_force", strength: "medium", ageFrac: 0.6, ai: "none" },
      { type: "admin_abuse", strength: "medium", ageFrac: 0.2, ai: "mixed" },
      { type: "web_scan", strength: "weak", ageFrac: 0.4, ai: "none" },
      { type: "account_takeover", strength: "weak", ageFrac: 0.15, ai: "only" },
    ];
    for (const s of seeds) this.spawn(now, s);

    this.nextSpawnAt = now + this.r.int(6, 15) * 1000;
    this.nextBenignAt = now + this.r.int(120, 240) * 1000;
    this.timers.push(window.setInterval(() => this.tick(), TICK_MS));
  }

  stop() {
    this.timers.forEach((t) => window.clearInterval(t));
    this.timers = [];
  }

  decide(d: Decision) {
    const live = this.live.get(d.incidentId);
    if (!live) return;
    const inc = live.incident;
    if (d.decision === "approve") {
      inc.status = "approved";
      this.health.decisions.approved += 1;
      this.live.delete(inc.id); // decided: no more escalation or expiry
    } else {
      this.health.decisions.rejected += 1;
      inc.fixes = inc.fixes.filter((f) => f.actionId !== d.actionId);
      if (inc.fixes.length === 0) inc.fallback = this.fallbackFor(inc);
    }
    this.emit({ type: "incident.upsert", payload: structuredClone(inc) });
    this.emit({ type: "health", payload: structuredClone(this.health) });
  }

  // ---------------------------------------------------------------- the clock

  private tick() {
    const now = Date.now();

    for (const live of [...this.live.values()]) {
      const inc = live.incident;
      if (Date.parse(inc.staleBy) <= now) {
        inc.status = "expired";
        this.live.delete(inc.id);
        this.health.expiredToday += 1;
        this.emit({ type: "incident.expire", payload: { id: inc.id } });
      } else if (live.pending.length > 0 && now >= live.nextSignalAt) {
        this.fireSignal(live, now);
        live.nextSignalAt = now + this.r.int(8, 25) * 1000;
        this.emit({ type: "incident.upsert", payload: structuredClone(inc) });
      }
    }

    const open = this.live.size;
    if (open < OPEN_MIN || (now >= this.nextSpawnAt && open < this.r.int(OPEN_MIN, OPEN_MAX))) {
      this.spawn(now);
    }
    if (now >= this.nextSpawnAt) this.nextSpawnAt = now + this.r.int(6, 15) * 1000;

    if (now >= this.nextBenignAt) {
      this.addBenign(this.r.pick<BenignKind>(["flash_crowd", "nightly_backup"]), now, true);
      this.nextBenignAt = now + this.r.int(120, 240) * 1000;
    }

    this.updateHealth(now);
    this.emit({ type: "health", payload: structuredClone(this.health) });
  }

  // ---------------------------------------------------------------- incidents

  private spawn(now: number, opts: { type?: AttackType; strength?: Strength; ageFrac?: number; ai?: AiMode } = {}) {
    const r = this.r;
    const strength = opts.strength ?? this.chooseStrength(now);
    const type =
      opts.type ??
      (strength === "strong"
        ? r.pick(ATTACK_TYPES.filter((t) => SCENARIOS[t].severity >= 4))
        : r.pick(ATTACK_TYPES));
    const scen = SCENARIOS[type];
    const ai: AiMode = opts.ai ?? (strength !== "strong" && r.chance(0.12) ? "only" : r.chance(0.35) ? "mixed" : "none");

    const windowMs = scen.windowMin * 60_000;
    const age = (opts.ageFrac ?? 0) * windowMs;
    const createdAt = now - age;
    const ctx = this.makeCtx(type);
    const plan = this.planSignals(type, strength, ai);
    const seeded = opts.ageFrac !== undefined;
    const fired = seeded ? (strength === "strong" ? plan.length : Math.max(1, plan.length - 1)) : 1;

    const id = String(this.nextNumber++).padStart(4, "0");
    const incident: Incident = {
      id,
      attackType: type,
      name: scen.name,
      mitre: { ...scen.mitre },
      severity: scen.severity,
      attentionScore: 0,
      detectedBy: "rule",
      createdAt: iso(createdAt),
      staleBy: iso(createdAt + windowMs),
      status: "open",
      entities: this.makeEntities(type, ctx),
      signals: [],
      fixes: [],
    };
    const live: Live = {
      incident,
      ctx,
      pending: plan.slice(),
      nextSignalAt: now + r.int(8, 25) * 1000,
      noFix: r.chance(1 / 7),
      jitter: [r() * 0.06 - 0.03, r() * 0.06 - 0.03, r() * 0.06 - 0.03],
    };
    this.live.set(id, live);

    for (let k = 0; k < fired; k++) {
      const ts = fired === 1 ? createdAt : createdAt + (k / (fired - 1)) * age * 0.9;
      this.fireSignal(live, ts);
    }
    this.emit({ type: "incident.upsert", payload: structuredClone(incident) });
  }

  /** Pick a strength that keeps every tier populated. */
  private chooseStrength(now: number): Strength {
    const counts: Record<Tier, number> = { "ACT NOW": 0, "ACT SOON": 0, WATCH: 0 };
    for (const { incident: i } of this.live.values()) {
      counts[assessRisk(i.severity, i.attentionScore, remainingShare(i.createdAt, i.staleBy, now)).tier] += 1;
    }
    if (counts["ACT NOW"] === 0) return "strong";
    if (counts.WATCH === 0) return "weak";
    if (counts["ACT SOON"] === 0) return "medium";
    const x = this.r();
    return x < 0.3 ? "strong" : x < 0.7 ? "medium" : "weak";
  }

  private planSignals(type: AttackType, strength: Strength, ai: AiMode): string[] {
    const r = this.r;
    if (ai === "only") return strength === "weak" ? ["ATDE"] : ["ATDE", "ATDE-CLASS"];
    const path = SCENARIOS[type].path;
    const count = strength === "weak" ? 1 : strength === "medium" ? Math.min(path.length, r.int(2, 3)) : path.length;
    const plan = path.slice(0, count);
    const rulePoints = plan.reduce((sum, id) => sum + (RULES[id].points ?? 20), 0);
    if (ai === "mixed" || (strength === "strong" && rulePoints < 80)) {
      plan.splice(r.int(1, plan.length), 0, "ATDE");
    }
    return plan;
  }

  private fireSignal(live: Live, ts: number) {
    const inc = live.incident;
    const scen = SCENARIOS[inc.attackType];
    const ruleId = live.pending.shift();
    if (!ruleId) return;

    let sentence: string;
    let points: number;
    if (ruleId === "ATDE") {
      sentence = `AI engine: this ${scen.aiPattern} pattern is unusual (score 0.${this.r.int(66, 93)})`;
      points = AI_POINTS;
    } else if (ruleId === "ATDE-CLASS") {
      sentence = `AI engine: most likely ${scen.name.toLowerCase()} (probability 0.${this.r.int(62, 88)})`;
      points = AI_POINTS;
    } else {
      sentence = RULES[ruleId].sentence(live.ctx);
      points = RULES[ruleId].points ?? 20;
    }

    const score = Math.min(100, inc.attentionScore + points);
    const signal: Signal = {
      id: `${inc.id}-s${inc.signals.length + 1}`,
      ts: iso(ts),
      ruleId: ruleId.startsWith("ATDE") ? "ATDE" : ruleId,
      sentence,
      points,
      level: levelFor(score),
      eventIds: Array.from({ length: this.r.int(1, 3) }, () => this.uuid()),
    };
    inc.signals.push(signal);
    inc.attentionScore = score;

    const hasAi = inc.signals.some((s) => s.ruleId === "ATDE");
    const hasRule = inc.signals.some((s) => s.ruleId !== "ATDE");
    inc.detectedBy = hasAi && hasRule ? "both" : hasAi ? "ai" : "rule";

    // Escalations the rules document calls out.
    if (ruleId === "BF-4") inc.severity = 5;
    if (ruleId === "WS-4") {
      inc.severity = 3;
      inc.mitre = { id: "T1190", name: "Exploit Public-Facing Application", tactic: "Initial Access" };
    }
    this.recommend(live);
  }

  /** Simulated CRIE: the scenario's top fixes, or MITRE's mitigations when nothing is confident. */
  private recommend(live: Live) {
    const inc = live.incident;
    const scen = SCENARIOS[inc.attackType];
    if (live.noFix || inc.attentionScore < 30) {
      inc.fixes = [];
      inc.fallback = this.fallbackFor(inc);
      return;
    }
    const reasons = scen.reasons(live.ctx);
    const strength = 0.8 + 0.2 * (inc.attentionScore / 100);
    inc.fixes = scen.fixes
      .map((f, i) => ({
        actionId: f.actionId,
        name: f.name,
        d3fend: { id: null, name: f.d3fend },
        confidence: round2(Math.min(0.97, f.confidence * strength + live.jitter[i])),
        rank: 1 as 1 | 2 | 3,
        reasons: [reasons[i % reasons.length], reasons[(i + 1) % reasons.length]].map((reason, k) => ({
          ...reason,
          contribution: round2((k === 0 ? 0.26 : 0.17) * strength + live.jitter[(i + k) % 3] / 2),
        })),
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .map((f, i) => ({ ...f, rank: (i + 1) as 1 | 2 | 3 }));
    delete inc.fallback;
  }

  private fallbackFor(inc: Incident) {
    return { technique: inc.mitre.id.split(".")[0], mitigations: SCENARIOS[inc.attackType].mitigations };
  }

  private makeCtx(type: AttackType): Ctx {
    const r = this.r;
    const ips = Array.from({ length: r.int(3, 8) }, () => randomIp(r));
    return {
      user: type === "admin_abuse" ? "admin" : r.pick(USERS),
      ip: ips[0],
      ips,
      host: type === "web_scan" || type === "http_flood" ? r.pick(["web-01", "web-02"]) : type === "data_exfiltration" || type === "admin_abuse" ? "db-01" : "auth-01",
      failures: r.int(12, 48),
      accounts: r.int(21, 60),
      path: r.pick(SENSITIVE_PATHS),
      injection: r.pick(INJECTIONS),
      command: r.pick(ADMIN_COMMANDS),
      bytes: r.int(120, 3200) * 1e6,
      apiRequests: r.int(60, 400),
      pages: r.int(24, 180),
      rateX: r.int(5, 14),
      ipsPerMin: r.int(30, 120),
      errors: r.int(24, 120),
      errorPct: r.int(71, 96),
      uniquePaths: r.int(31, 140),
      loginTime: `${pad(r.int(0, 4))}:${pad(r.int(0, 59))}`,
    };
  }

  private makeEntities(type: AttackType, c: Ctx): Incident["entities"] {
    switch (type) {
      case "brute_force":
        return { users: [c.user], ips: [c.ip], hosts: ["auth-01"] };
      case "credential_stuffing":
        return { users: USERS.slice(0, this.r.int(3, USERS.length)), ips: c.ips, hosts: ["auth-01"] };
      case "account_takeover":
        return { users: [c.user], ips: [c.ip], hosts: ["auth-01", "web-01"] };
      case "web_scan":
        return { users: [], ips: [c.ip], hosts: [c.host] };
      case "data_exfiltration":
        return { users: [c.user], ips: [c.ip], hosts: ["db-01", "web-01"] };
      case "admin_abuse":
        return { users: ["admin"], ips: [c.ip], hosts: ["db-01"] };
      case "http_flood":
        return { users: [], ips: c.ips, hosts: ["web-01", "web-02"] };
    }
  }

  private uuid(): string {
    const hex = () => Math.floor(this.r() * 16).toString(16);
    const block = (n: number) => Array.from({ length: n }, hex).join("");
    return `${block(8)}-${block(4)}-4${block(3)}-${"89ab"[this.r.int(0, 3)]}${block(3)}-${block(12)}`;
  }

  // ---------------------------------------------------------------- benign anomalies

  private addBenign(kind: BenignKind, ts: number, count: boolean) {
    const def = BENIGN[kind];
    const anomaly: BenignAnomaly = {
      id: `b${this.nextBenign++}`,
      kind,
      name: def.name,
      ts: iso(ts),
      sentence: def.sentence(this.r.int(3, 5)),
      checks: def.checks.map((label) => ({ label, passed: true })),
    };
    if (count) this.health.judgedNormalToday += 1;
    this.emit({ type: "benign.upsert", payload: anomaly });
  }

  // ---------------------------------------------------------------- pipeline health

  private initialHealth(now: number): PipelineHealth {
    const r = this.r;
    const midnight = new Date(now).setHours(0, 0, 0, 0);
    const last2am = new Date(now).setHours(2, 0, 0, 0);
    const lastRun = last2am <= now ? last2am : last2am - 86_400_000;
    const history: PipelineHealth["freshnessHistory"] = [];
    let p95 = 1700;
    for (let i = 59; i >= 0; i--) {
      p95 = Math.max(900, Math.min(2400, p95 + r.int(-120, 120)));
      history.push({ t: iso(now - i * 1000), p95 });
    }
    const perMin = Array.from({ length: 30 }, (_, i) => ({
      t: iso(minuteStart(now) - (29 - i) * 60_000),
      rule: r.int(1, 4),
      ai: r.int(0, 2),
    }));
    return {
      feed: "live",
      lastEventAt: iso(now),
      eventsPerSec: 214,
      eventsToday: Math.round(((now - midnight) / 1000) * 205),
      freshnessMs: { p50: Math.round(p95 * 0.45), p95 },
      slaMs: 5000,
      freshnessHistory: history,
      detections: this.sumDetections(perMin),
      detectionsPerMin: perMin,
      expiredToday: 0,
      judgedNormalToday: 1, // the flash crowd added on start
      models: [
        { name: "ATDE", version: "example", trainedAt: null, status: "ready" },
        { name: "CRIE", version: "example", trainedAt: null, status: "ready" },
      ],
      retraining: { lastRun: iso(lastRun), nextRun: iso(lastRun + 86_400_000), status: "scheduled" },
      alerts: [],
      decisions: { approved: 0, rejected: 0 },
    };
  }

  private sumDetections(perMin: PipelineHealth["detectionsPerMin"]) {
    return perMin.reduce((acc, m) => ({ rule: acc.rule + m.rule, ai: acc.ai + m.ai }), { rule: 0, ai: 0 });
  }

  private updateHealth(now: number) {
    const h = this.health;
    const r = this.r;
    h.lastEventAt = iso(now);
    h.eventsPerSec = Math.max(180, Math.min(260, h.eventsPerSec + r.int(-8, 8)));
    h.eventsToday += h.eventsPerSec;
    const p95 = Math.max(900, Math.min(2400, h.freshnessMs.p95 + r.int(-120, 120)));
    h.freshnessMs = { p50: Math.round(p95 * 0.45), p95 };
    h.freshnessHistory = [...h.freshnessHistory.slice(-59), { t: iso(now), p95 }];

    // Shift the detections chart once a minute.
    const last = h.detectionsPerMin[h.detectionsPerMin.length - 1];
    if (minuteStart(now) > Date.parse(last.t)) {
      h.detectionsPerMin = [...h.detectionsPerMin.slice(1), { t: iso(minuteStart(now)), rule: r.int(1, 4), ai: r.int(0, 2) }];
      h.detections = this.sumDetections(h.detectionsPerMin);
    }
  }
}

export function createMockSource(): DataSource {
  const engine = new MockEngine();
  return {
    kind: "mock",
    connect(onMessage: (msg: ServerMessage) => void, onStatus: (status: ConnectionStatus) => void) {
      onStatus("open");
      engine.start(onMessage);
      return () => {
        engine.stop();
        onStatus("closed");
      };
    },
    sendDecision(decision: Decision) {
      engine.decide(decision);
    },
  };
}
