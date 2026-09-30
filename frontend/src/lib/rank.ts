// The ONE ranking rule. Components never sort incidents any other way.
// risk = how bad × how sure × how soon. Spec: docs/DATA_CONTRACT.md, "Ranking".
import { remainingShare } from "./heat.ts";

export type Tier = "ACT NOW" | "ACT SOON" | "WATCH";
export const TIER_ORDER: readonly Tier[] = ["ACT NOW", "ACT SOON", "WATCH"];

export interface RiskBreakdown {
  bad: number; // severity / 5
  sure: number; // attention / 100
  soon: number; // 0.5 fresh .. 1.0 at the deadline
  risk: number;
  tier: Tier;
}

export function assessRisk(severity: number, attentionScore: number, remaining: number): RiskBreakdown {
  const bad = severity / 5;
  const sure = attentionScore / 100;
  const soon = 0.5 + 0.5 * (1 - remaining);
  const risk = bad * sure * soon;
  const tier: Tier =
    attentionScore < 30
      ? "WATCH" // weak evidence never jumps the queue
      : risk >= 0.45 && attentionScore >= 50
        ? "ACT NOW"
        : risk >= 0.2
          ? "ACT SOON"
          : "WATCH";
  return { bad, sure, soon, risk, tier };
}

/** The line printed under RISK: "= SEV 5/5 × ATTN 1.00 × URGENCY 0.52". */
export function riskFormula(severity: number, b: RiskBreakdown): string {
  return `= SEV ${severity}/5 × ATTN ${b.sure.toFixed(2)} × URGENCY ${b.soon.toFixed(2)}`;
}

export interface Rankable {
  severity: number;
  attentionScore: number;
  createdAt: string;
  staleBy: string;
}

export type Ranked<T> = T & { rank: RiskBreakdown & { remaining: number; timeLeftMs: number } };

/** Sort: tier (ACT NOW, ACT SOON, WATCH), then risk descending, then time left ascending. */
export function rankIncidents<T extends Rankable>(items: readonly T[], now: number): Ranked<T>[] {
  return items
    .map((item) => {
      const remaining = remainingShare(item.createdAt, item.staleBy, now);
      const timeLeftMs = Math.max(0, new Date(item.staleBy).getTime() - now);
      return { ...item, rank: { ...assessRisk(item.severity, item.attentionScore, remaining), remaining, timeLeftMs } };
    })
    .sort(
      (a, b) =>
        TIER_ORDER.indexOf(a.rank.tier) - TIER_ORDER.indexOf(b.rank.tier) ||
        b.rank.risk - a.rank.risk ||
        a.rank.timeLeftMs - b.rank.timeLeftMs,
    );
}
