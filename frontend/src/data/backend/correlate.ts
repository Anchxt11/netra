// Correlation: the backend sends one alert per rule per event; the dashboard shows incidents.
// This groups alerts into incidents (same attack, same source), turns them into signals with
// plain sentences, and expires each incident when its window runs out.
// Pure and clock-free (callers pass `now`), so tests/correlate.test.ts can drive it.
import type { AttackType, Incident, Severity, SignalLevel } from "../types";
import { formatBytes, SCENARIOS } from "../catalog.ts";
import { AI, BACKEND_RULES, isRealModel, rulePoints, severityOf, STUFFING_ACCOUNTS, WATCHLIST, WATCHLIST_RULE } from "./rules.ts";
import type { AlertRow, EnrichedEvent } from "./types";

const EVENT_CACHE = 20_000; // enriched events kept to look up an alert's address, account and host
const WAIT_FOR_EVENT_MS = 3_000; // an alert can arrive before its event: wait this long, then go without
const LOGIN_MEMORY_MS = 10 * 60_000; // failed logins remembered per address
const BRUTE_FORCE_WINDOW_MS = 60_000; // the backend rule's own window (rules/sigma/brute_force.yaml)
const EVENT_IDS_PER_SIGNAL = 10;

interface SignalDraft {
  ruleId: string; // backend rule id, or "model"
  code: string;
  base: number;
  hits: number;
  firstTs: number;
  lastTs: number;
  severity: Severity;
  eventIds: string[];
  last?: EnrichedEvent;
  bytes: number; // exfiltration: total sent
  model?: string;
}

interface Draft {
  id: string;
  key: string;
  attackType: AttackType;
  createdAt: number;
  staleBy: number;
  signals: Map<string, SignalDraft>;
  users: Set<string>;
  ips: Set<string>;
  hosts: Set<string>;
  rows: number[]; // the backend's incident row ids (one per alert)
}

export interface CorrelatorOutput {
  upsert(incident: Incident): void;
  /** Merged into incident `into`: gone without expiring. */
  remove(id: string, into: string): void;
  expire(id: string): void;
}

const iso = (ms: number) => new Date(ms).toISOString();
const addresses = (n: number) => (n === 1 ? "1 address" : `${n} addresses`);
const times = (n: number) => (n > 1 ? ` (${n} times)` : "");
const known = (v: string | undefined) => (v && v !== "-" ? v : undefined);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export class Correlator {
  private readonly out: CorrelatorOutput;
  private readonly events = new Map<string, EnrichedEvent>();
  private readonly seen = new Set<string>();
  private pending: { row: AlertRow; since: number }[] = [];
  private readonly open = new Map<string, Draft>(); // by grouping key
  private readonly byId = new Map<string, Draft>();
  private readonly failures = new Map<string, { user: string; at: number }[]>(); // failed logins by address
  private next = 1;

  constructor(out: CorrelatorOutput) {
    this.out = out;
  }

  /** Enriched events, from the live stream or GET /events/recent. */
  addEvents(batch: EnrichedEvent[], now: number) {
    for (const ev of batch) {
      if (!ev?.event_id) continue;
      this.events.set(ev.event_id, ev);
      const user = known(ev.user);
      if (ev.event_type === "login" && ev.status === "failure" && ev.ip && user) {
        const list = this.failures.get(ev.ip) ?? [];
        list.push({ user, at: Date.parse(ev.event_ts) || now });
        this.failures.set(ev.ip, list);
      }
    }
    for (const id of this.events.keys()) {
      if (this.events.size <= EVENT_CACHE) break;
      this.events.delete(id);
    }
    // Alerts that were waiting for these events.
    const waiting = this.pending;
    this.pending = [];
    for (const p of waiting) {
      if (this.eventOf(p.row)) this.process(p.row, now);
      else this.pending.push(p);
    }
  }

  /** One alert (one row of the backend's incidents table). Returns false for an alert_id already seen. */
  addAlert(row: AlertRow, now: number): boolean {
    if (!row?.alert_id || this.seen.has(row.alert_id)) return false;
    this.seen.add(row.alert_id);
    if (this.eventOf(row) || !row.event_ids?.length) this.process(row, now);
    else this.pending.push({ row, since: now });
    return true;
  }

  /** Once a second: alerts that waited long enough, and incidents whose window ran out. */
  tick(now: number) {
    const waiting = this.pending;
    this.pending = [];
    for (const p of waiting) {
      if (now - p.since >= WAIT_FOR_EVENT_MS) this.process(p.row, now);
      else this.pending.push(p);
    }
    for (const d of [...this.open.values()]) {
      if (d.staleBy <= now) {
        this.open.delete(d.key);
        this.byId.delete(d.id);
        this.out.expire(d.id);
      }
    }
    for (const [ip, list] of this.failures) {
      const kept = list.filter((f) => now - f.at < LOGIN_MEMORY_MS);
      if (kept.length) this.failures.set(ip, kept);
      else this.failures.delete(ip);
    }
  }

  /** The backend rows behind one of our incidents (to record decisions against). */
  rowsOf(incidentId: string): number[] {
    return this.byId.get(incidentId)?.rows ?? [];
  }

  // ------------------------------------------------------------------ grouping

  private eventOf(row: AlertRow): EnrichedEvent | undefined {
    const id = row.event_ids?.[0];
    return id ? this.events.get(id) : undefined;
  }

  private process(row: AlertRow, now: number) {
    const ev = this.eventOf(row);
    const ts = Date.parse(row.created_ts) || now;
    const severity = severityOf(row.severity ?? "medium");

    // A watch-listed address or a model's opinion adds to an incident; on its own it opens none.
    if (row.rule_id === WATCHLIST_RULE || !row.rule_id) {
      const ai = !row.rule_id;
      if (ai && !isRealModel(row.model)) return; // the placeholder scorer is not AI
      const draft = this.findBySource(ev);
      if (!draft) return;
      const code = ai ? AI.code : WATCHLIST.code;
      this.addSignal(draft, ai ? "model" : WATCHLIST_RULE, code, ai ? AI.points : WATCHLIST.points, ts, severity, row, ev, row.model ?? undefined);
      return this.publish(draft);
    }

    const rule = BACKEND_RULES[row.rule_id];
    if (!rule) return; // a rule this dashboard does not know yet

    let type = rule.attackType;
    let key: string;
    const ip = ev?.ip ?? "unknown";
    const user = known(ev?.user) ?? "unknown";
    const guessing = this.open.get(`brute_force:${ip}`) ?? this.findCampaign(ip);

    if (row.rule_id === "suspicious_login" && guessing) {
      // A failed admin login inside a password attack is part of that attack.
      type = guessing.attackType;
      key = guessing.key;
    } else if (type === "brute_force" || type === "credential_stuffing") {
      // One address failing on many accounts is stuffing; many such addresses are one campaign.
      const accounts = ev?.ip ? this.accountsFrom(ev.ip, now) : 0;
      const campaign = this.findCampaign(ip);
      if (campaign) {
        type = "credential_stuffing";
        key = campaign.key;
      } else if (row.rule_id === "credential_stuffing" || accounts >= STUFFING_ACCOUNTS) {
        type = "credential_stuffing";
        key = `credential_stuffing:${ev?.path ?? "/login"}`;
        const solo = this.open.get(`brute_force:${ip}`);
        const existing = this.open.get(key);
        if (solo && existing) this.merge(solo, existing);
        else if (solo) this.rekey(solo, key, "credential_stuffing");
      } else {
        type = "brute_force";
        key = `brute_force:${ip}`;
      }
    } else if (type === "data_exfiltration" && this.open.has(`admin_abuse:${user}`)) {
      // An admin who ran suspicious commands and then moved data out: one story, not two.
      type = "admin_abuse";
      key = `admin_abuse:${user}`;
    } else {
      key = `${type}:${rule.key === "ip" ? ip : rule.key === "user" ? user : "site"}`;
    }

    const draft = this.open.get(key) ?? this.create(type, key, ts);
    this.addSignal(draft, row.rule_id, rule.code, rule.points, ts, severity, row, ev);
    if (type === "credential_stuffing" && ev?.ip) {
      for (const f of this.failures.get(ev.ip) ?? []) draft.users.add(f.user);
    }
    this.publish(draft);
  }

  private create(type: AttackType, key: string, ts: number): Draft {
    const draft: Draft = {
      id: String(this.next++).padStart(4, "0"),
      key,
      attackType: type,
      createdAt: ts,
      staleBy: ts + SCENARIOS[type].windowMin * 60_000,
      signals: new Map(),
      users: new Set(),
      ips: new Set(),
      hosts: new Set(),
      rows: [],
    };
    this.open.set(key, draft);
    this.byId.set(draft.id, draft);
    return draft;
  }

  private addSignal(
    draft: Draft,
    ruleId: string,
    code: string,
    base: number,
    ts: number,
    severity: Severity,
    row: AlertRow,
    ev: EnrichedEvent | undefined,
    model?: string,
  ) {
    const s = draft.signals.get(code) ?? { ruleId, code, base, hits: 0, firstTs: ts, lastTs: ts, severity, eventIds: [], bytes: 0, model };
    s.hits += 1;
    s.firstTs = Math.min(s.firstTs, ts);
    s.lastTs = Math.max(s.lastTs, ts);
    s.severity = Math.max(s.severity, severity) as Severity;
    s.eventIds = [...s.eventIds, ...(row.event_ids ?? [])].slice(-EVENT_IDS_PER_SIGNAL);
    if (ev) {
      s.last = ev;
      if (ruleId === "data_exfiltration") s.bytes += ev.bytes_out ?? 0;
      if (ev.ip) draft.ips.add(ev.ip);
      if (known(ev.user)) draft.users.add(ev.user as string);
      if (ev.host) draft.hosts.add(ev.host);
    }
    draft.signals.set(code, s);
    draft.rows.push(row.id);
  }

  /** Fold `from` into `into` (two addresses of one campaign). */
  private merge(from: Draft, into: Draft) {
    for (const s of from.signals.values()) {
      const t = into.signals.get(s.code);
      if (!t) into.signals.set(s.code, s);
      else {
        t.hits += s.hits;
        t.firstTs = Math.min(t.firstTs, s.firstTs);
        t.lastTs = Math.max(t.lastTs, s.lastTs);
        t.severity = Math.max(t.severity, s.severity) as Severity;
        t.eventIds = [...t.eventIds, ...s.eventIds].slice(-EVENT_IDS_PER_SIGNAL);
        t.bytes += s.bytes;
        if (s.lastTs >= t.lastTs) t.last = s.last;
      }
    }
    from.users.forEach((u) => into.users.add(u));
    from.ips.forEach((i) => into.ips.add(i));
    from.hosts.forEach((h) => into.hosts.add(h));
    into.rows.push(...from.rows);
    into.createdAt = Math.min(into.createdAt, from.createdAt);
    this.open.delete(from.key);
    this.byId.delete(from.id);
    this.out.remove(from.id, into.id);
  }

  /** A password-guessing incident that turns out to be stuffing becomes the campaign (same number). */
  private rekey(draft: Draft, key: string, type: AttackType) {
    this.open.delete(draft.key);
    draft.key = key;
    draft.attackType = type;
    this.open.set(key, draft);
  }

  private findBySource(ev: EnrichedEvent | undefined): Draft | undefined {
    if (!ev) return undefined;
    const user = known(ev.user);
    let best: Draft | undefined;
    for (const d of this.open.values()) {
      if ((ev.ip && d.ips.has(ev.ip)) || (user && d.users.has(user))) {
        if (!best || d.createdAt > best.createdAt) best = d;
      }
    }
    return best;
  }

  private findCampaign(ip: string): Draft | undefined {
    for (const d of this.open.values()) if (d.attackType === "credential_stuffing" && d.ips.has(ip)) return d;
    return undefined;
  }

  private accountsFrom(ip: string, now: number): number {
    const list = this.failures.get(ip) ?? [];
    return new Set(list.filter((f) => now - f.at < LOGIN_MEMORY_MS).map((f) => f.user)).size;
  }

  private failuresFrom(ip: string, since: number): number {
    return (this.failures.get(ip) ?? []).filter((f) => f.at >= since).length;
  }

  // ------------------------------------------------------------------ output

  private sentence(s: SignalDraft, d: Draft): string {
    const ev = s.last;
    const ip = ev?.ip ?? "an unknown address";
    const user = known(ev?.user) ?? "an unknown account";
    const host = ev?.host ?? "a server";
    switch (s.ruleId) {
      case "brute_force":
        if (d.attackType === "credential_stuffing") {
          return `Failed logins on ${d.users.size} different accounts from ${addresses(d.ips.size)}`;
        }
        return ev?.ip
          ? `${this.failuresFrom(ev.ip, d.createdAt - BRUTE_FORCE_WINDOW_MS)} failed logins for ${user} from ${ip}`
          : `5 or more failed logins from one address within a minute${times(s.hits)}`;
      case "credential_stuffing":
        return `20 or more failed logins from ${ip} within 30 seconds${times(s.hits)}`;
      case "suspicious_login":
        return `Failed login on an admin account (${user})${times(s.hits)}`;
      case "privilege_escalation":
        return `${user} ran a command with sudo on ${host}${times(s.hits)}`;
      case "malicious_process":
        return `Suspicious command on ${host}: ${clip(ev?.process ?? "unknown", 60)}${times(s.hits)}`;
      case "data_exfiltration":
        return s.hits > 1
          ? `${user} sent ${formatBytes(s.bytes)} out in ${s.hits} large transfers`
          : `${user} sent ${formatBytes(s.bytes)} out in one transfer`;
      case "web_scan":
        return `${ip} requested sensitive or injection paths, like ${clip(ev?.path ?? "/", 40)}${times(s.hits)}`;
      case "excessive_requests":
        return `100 or more requests within a minute, from ${addresses(d.ips.size)}`;
      case "http_flood":
        return `200 or more requests within 30 seconds, from ${addresses(d.ips.size)}`;
      case WATCHLIST_RULE:
        return `Traffic from a watch-listed address (${ip})`;
      default: {
        const score = ev?.risk_score;
        return `AI engine (${s.model}): this activity is unusual${score !== undefined ? ` (score ${score.toFixed(2)})` : ""}`;
      }
    }
  }

  private publish(d: Draft) {
    const scenario = SCENARIOS[d.attackType];
    const ordered = [...d.signals.values()].sort((a, b) => a.firstTs - b.firstTs);
    const signals = ordered.map((s) => ({
      id: `${d.id}-${s.code}`,
      ts: iso(s.lastTs),
      ruleId: s.code,
      sentence: this.sentence(s, d),
      points: rulePoints(s.base, s.hits),
      level: (s.severity >= 5 ? "critical" : "suspicious") as SignalLevel,
      eventIds: s.eventIds,
    }));
    const ai = ordered.some((s) => s.code === AI.code);
    const rule = ordered.some((s) => s.code !== AI.code);
    const incident: Incident = {
      id: d.id,
      attackType: d.attackType,
      name: scenario.name,
      mitre: scenario.mitre,
      severity: Math.max(...ordered.map((s) => s.severity)) as Severity,
      attentionScore: Math.min(100, signals.reduce((sum, s) => sum + s.points, 0)),
      detectedBy: ai && rule ? "both" : ai ? "ai" : "rule",
      createdAt: iso(d.createdAt),
      staleBy: iso(d.staleBy),
      status: "open",
      entities: { users: [...d.users], ips: [...d.ips], hosts: [...d.hosts] },
      signals,
      fixes: [], // CRIE is not connected: the dashboard shows MITRE's mitigations instead
      fallback: { technique: scenario.mitre.id, mitigations: scenario.mitigations },
    };
    this.out.upsert(incident);
  }
}
