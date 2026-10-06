// The backend's 10 rules (rules/sigma/*.yaml on the backend branch), and how each one shows on the dashboard.
// Attack types, points and sentences are ours (docs/BACKEND_INTEGRATION.md, "Proposed rule mapping").
// Thresholds in the sentences are the rules' own. Severity comes from the backend's alert.
import type { AttackType, Severity } from "../types";

export type RuleKey = "ip" | "user" | "host";

export interface BackendRule {
  /** Short label in the escalation list. */
  code: string;
  attackType: AttackType;
  /** Points for the first hit. Repeats add up to the same again (see `rulePoints`). */
  points: number;
  /** Which part of the event says "same attack": one address, one account, or one target host. */
  key: RuleKey;
}

export const BACKEND_RULES: Record<string, BackendRule> = {
  brute_force: { code: "BF", attackType: "brute_force", points: 20, key: "ip" },
  credential_stuffing: { code: "CS", attackType: "credential_stuffing", points: 20, key: "ip" },
  suspicious_login: { code: "ADM", attackType: "admin_abuse", points: 15, key: "user" },
  privilege_escalation: { code: "SUDO", attackType: "admin_abuse", points: 20, key: "user" },
  malicious_process: { code: "PROC", attackType: "admin_abuse", points: 30, key: "user" },
  data_exfiltration: { code: "EXF", attackType: "data_exfiltration", points: 30, key: "user" },
  web_scan: { code: "SCAN", attackType: "web_scan", points: 20, key: "ip" },
  // One flood comes from many addresses, so it is grouped by the host it hits.
  excessive_requests: { code: "RATE", attackType: "http_flood", points: 15, key: "host" },
  http_flood: { code: "FLOOD", attackType: "http_flood", points: 25, key: "host" },
};

/** suspicious_ip never opens an incident: it adds to the open incident of that address. */
export const WATCHLIST_RULE = "suspicious_ip";
export const WATCHLIST = { code: "IOC", points: 15 };

/** A model's alert (rule_id null). Shown as the AI engine only when it is a real model. */
export const AI = { code: "ATDE", points: 20 };
/** The backend's placeholder scorer is hand-written weights, not a model: never call it AI. */
export const isRealModel = (model: string | null | undefined) => Boolean(model) && !/dummy/i.test(String(model));

/** The backend's severity words, on our 1 to 5 scale. */
export const SEVERITY: Record<string, Severity> = { low: 2, medium: 3, high: 4, critical: 5 };
export const severityOf = (word: string): Severity => SEVERITY[word.toLowerCase()] ?? 3;

/**
 * A rule that keeps firing is stronger evidence than one hit, but never more than twice
 * its base points. Without this, an attack the backend sees with only one rule could never
 * leave WATCH (attention under 30).
 */
export function rulePoints(base: number, hits: number): number {
  return Math.round(base * Math.min(2, 1 + (hits - 1) / 10));
}

/** A login source that failed on this many different accounts is stuffing, not guessing one password. */
export const STUFFING_ACCOUNTS = 3;
