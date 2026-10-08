// How a model alert (ATDE, model 1) reads on the dashboard: which attack it names, and its sentence.
// Only what the model said: its class, its score and its top reasons (contracts/LIVE_API.md 5.1).
import type { AttackType } from "../types";
import type { ModelReason } from "./types";

/**
 * Model 1's classes (ml/model1/model_card.md) that are exactly one of our attack types.
 * The others (DoS / Flooding, Reconnaissance / Scanning, Exploitation, Fuzzing, Backdoor, Shellcode)
 * describe network traffic, not our web, login or admin attacks: they open "Unusual activity" and the
 * sentence names the class instead.
 */
const CLASS_TO_TYPE: [RegExp, AttackType][] = [
  [/brute|credential/i, "brute_force"],
  [/exfiltration/i, "data_exfiltration"],
];

/** "anomaly" (or nothing) means the model found something unusual but named no attack. */
export function namedClass(cls: string | null | undefined): string | undefined {
  return cls && cls.toLowerCase() !== "anomaly" ? cls : undefined;
}

export function attackTypeOfClass(cls: string | null | undefined): AttackType {
  const named = namedClass(cls);
  return (named && CLASS_TO_TYPE.find(([re]) => re.test(named))?.[1]) || "unusual_activity";
}

// Model 1's features (ml/model1/features.json) in words. Counts read "42 connections in 60 s".
const COUNTS: Record<string, string> = { cnt: "connections", nports: "ports tried", ndst: "destinations" };
const WINDOWS: Record<string, string> = { "60s": "60 s", "600s": "10 min", "3600s": "1 h" };
const LABELS: Record<string, string> = {
  packets: "packets",
  bytes: "bytes",
  duration: "seconds long",
  bytes_per_packet: "bytes per packet",
  dst_port_logfreq: "port rarity",
  icmp_type: "ICMP type",
  icmp_code: "ICMP code",
};

const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ""));

/** One reason as a short phrase: "42 connections in 60 s from this address". */
export function reasonText(r: ModelReason): string {
  const value = typeof r.value === "number" ? r.value : Number(r.value);
  const count = /^(cnt|nports|ndst)_(\d+s)$/.exec(r.feature);
  if (count && Number.isFinite(value)) return `${num(value)} ${COUNTS[count[1]]} in ${WINDOWS[count[2]] ?? count[2]}`;
  if (r.feature in LABELS && Number.isFinite(value)) return `${num(value)} ${LABELS[r.feature]}`;
  return r.sentence || `${r.feature.replace(/_/g, " ")} ${r.value ?? ""}`.trim();
}

export interface ModelView {
  model: string;
  cls?: string | null;
  probability?: number | null;
  score?: number | null; // risk score, 0 to 1
  reasons?: ModelReason[] | null;
}

/**
 * "AI engine: more unusual than 81% of normal traffic from this source. Most unusual: 42 connections in 60 s".
 * The score is model 1's calibrated risk: the share of normal validation traffic (same log source) it exceeds
 * (ml/model1/model_card.md). Not a probability of attack, so it is never worded as one.
 */
export function aiSentence(v: ModelView, hits: number): string {
  const named = namedClass(v.cls);
  const pct = v.score != null ? Math.min(99, Math.round(v.score * 100)) : null;
  const rarer = pct != null ? `more unusual than ${pct}% of normal traffic from this source` : "unusual for this source";
  const what = named ? `looks like ${named}${v.probability != null ? ` (probability ${v.probability.toFixed(2)})` : ""}` : rarer;
  const score = named && pct != null ? `, ${rarer}` : "";
  const reasons = (v.reasons ?? []).slice(0, 3).map(reasonText).filter(Boolean);
  const why = reasons.length ? `. Most unusual: ${reasons.join(", ")}` : "";
  return `AI engine: ${what}${score}${why}${hits > 1 ? ` (${hits} times)` : ""}`;
}
