// Heat = how much of an incident's time window is left. Rules from docs/DATA_CONTRACT.md, "Heat".
import type { HeatState } from "../data/types.ts";

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Share of the window still left, 1 = just opened, 0 = stale. */
export function remainingShare(createdAt: string | number, staleBy: string | number, now: number): number {
  const start = new Date(createdAt).getTime();
  const end = new Date(staleBy).getTime();
  if (end <= start) return 0;
  return clamp((end - now) / (end - start), 0, 1);
}

export function heatState(remaining: number): HeatState {
  if (remaining <= 0) return "stale";
  if (remaining > 0.66) return "hot";
  if (remaining > 0.33) return "warm";
  return "cool";
}

/** Under 15% left: the queue row's time turns into a solid rust chip. */
export function isGoingCold(remaining: number): boolean {
  return remaining > 0 && remaining < 0.15;
}

/** CSS colour for a time element. Going cold uses heat-4, the darkest step. */
export function heatColor(remaining: number): string {
  if (isGoingCold(remaining)) return "var(--heat-4)";
  switch (heatState(remaining)) {
    case "hot":
      return "var(--heat-1)";
    case "warm":
      return "var(--heat-2)";
    case "cool":
      return "var(--heat-3)";
    case "stale":
      return "var(--stale)";
  }
}
