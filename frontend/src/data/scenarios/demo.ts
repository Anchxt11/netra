// The three scripted demo scenarios (?demo=1). Exact sentences and timings from
// docs/DATA_CONTRACT.md, "Scripted demo scenarios". Times are ms after the key press.
import type { Fix } from "../types";

export type ScenarioName = "credential_stuffing" | "flash_crowd" | "feed_failure";

interface ScriptedSignal {
  at: number;
  ruleId: string;
  sentence: string;
  points: number;
  /** This signal turns the credential stuffing into an account takeover. */
  takeover?: boolean;
}

/** Shift+A: credential stuffing that turns into an account takeover. */
export const CREDENTIAL_STUFFING = {
  rampMs: 8000, // events/s climbs; nothing crosses a threshold yet
  windowMin: 10,
  ips: ["203.0.113.24", "203.0.113.31", "198.51.100.57", "203.0.113.88", "192.0.2.102", "198.51.100.140"],
  users: ["maria.silva", "j.okafor", "a.nakamura", "r.mehta", "l.moreau", "t.berg"],
  spike: { rule: 8, ai: 3 }, // this minute on DETECTIONS / MIN
  signals: [
    { at: 8000, ruleId: "CS-1", sentence: "203.0.113.24 tried 34 different accounts in 5 minutes", points: 20 },
    { at: 11000, ruleId: "CS-2", sentence: "212 failed logins across 34 accounts from 203.0.113.24", points: 20 },
    { at: 12500, ruleId: "CS-3", sentence: "6 addresses are targeting the same group of accounts", points: 20 },
    { at: 15000, ruleId: "ATDE", sentence: "AI engine: this login pattern is unusual (score 0.81)", points: 20 },
    { at: 15600, ruleId: "ATO-1", sentence: "maria.silva logged in from an address never seen for them", points: 20, takeover: true },
  ] satisfies ScriptedSignal[],
  takeoverName: "Credential stuffing, account taken over",
  fixesAt: 17000,
  // "Block source IPs" ranks lower because the attack is spread over many addresses.
  fixes: [
    {
      actionId: "enable_mfa",
      name: "Enable MFA",
      d3fend: { id: null, name: "Multi-factor Authentication" },
      confidence: 0.88,
      rank: 1,
      reasons: [
        { feature: "unique_users_ip_5m", sentence: "One address tried 34 different accounts", value: 34, contribution: 0.29 },
        { feature: "distinct_ips_campaign", sentence: "The attack is spread over 6 addresses", value: 6, contribution: 0.21 },
      ],
    },
    {
      actionId: "revoke_sessions",
      name: "Revoke active sessions",
      d3fend: { id: null, name: "Session Termination" },
      confidence: 0.83,
      rank: 2,
      reasons: [
        { feature: "new_ip_user", sentence: "maria.silva is logged in from a new address", value: "203.0.113.24", contribution: 0.27 },
        { feature: "login_during_campaign", sentence: "The login succeeded in the middle of the campaign", value: 1, contribution: 0.18 },
      ],
    },
    {
      actionId: "reset_credentials",
      name: "Reset credentials",
      d3fend: { id: null, name: "Credential Rotation" },
      confidence: 0.79,
      rank: 3,
      reasons: [
        { feature: "stuffed_login_success", sentence: "The attacker's password for maria.silva worked", value: 1, contribution: 0.24 },
        { feature: "failed_logins_ip_5m", sentence: "212 failed logins in 5 minutes", value: 212, contribution: 0.12 },
      ],
    },
  ] satisfies Fix[],
  endsAt: 20000,
};

/** Shift+B: a flash crowd, the "not an attack" moment. */
export const FLASH_CROWD = {
  factor: 4, // events/s jumps about 4x
  durationMs: 20000,
  judgedAt: 6000,
};

/** Shift+F: the live feed stalls, goes down, then recovers. */
export const FEED_FAILURE = {
  downAt: 5000,
  recoverAt: 15000,
};

export const SCENARIO_LENGTH_MS: Record<ScenarioName, number> = {
  credential_stuffing: CREDENTIAL_STUFFING.endsAt,
  flash_crowd: FLASH_CROWD.durationMs,
  feed_failure: FEED_FAILURE.recoverAt,
};
