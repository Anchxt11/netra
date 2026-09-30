// Step 4 (PRIORITISE) layout, in the 760px stage coordinates, shared by the drawing and the
// pixel break-apart that builds it.
import { along, rectOutline, type Look, type MorphPoint } from "./morphPoints";

/** The countdown ring (the dashboard's CountdownRing, at 40% of the stage). */
export const RING = { cx: 250, cy: 330, size: 304 };
/** Radius of the ring's segments (80 of 184 in the ring's own drawing). */
export const RING_R = (RING.size * 80) / 184;

/** The tier scale under the ring: WATCH, ACT SOON, ACT NOW. */
export const TIERS = [
  { tier: "WATCH", w: 62 },
  { tier: "ACT SOON", w: 84 },
  { tier: "ACT NOW", w: 78 },
] as const;
export const TIER_Y = 506;
const TIER_GAP = 8;
const tiersWidth = TIERS.reduce((s, t) => s + t.w, 0) + TIER_GAP * (TIERS.length - 1);
export const TIER_X = TIERS.map((_, i) => RING.cx - tiersWidth / 2 + TIERS.slice(0, i).reduce((s, t) => s + t.w + TIER_GAP, 0));

/** The mini queue, top right. */
export const QUEUE = { x: 440, y: 250, w: 300, rowH: 44, step: 52, rows: 4 };

/** Step 4's drawing as dots: where step 3's pixels land. */
export function prioritisePoints(): MorphPoint[] {
  const out: MorphPoint[] = [];
  const ring: Look = { c: [255, 217, 90], a: 0.9, s: 2.6 };
  for (let seg = 0; seg < 48; seg++) {
    for (const f of [0.2, 0.5, 0.8]) {
      const deg = (seg + f) * 7.5 - 90;
      const rad = (deg * Math.PI) / 180;
      for (const r of [RING_R - 4, RING_R + 4]) out.push({ x: RING.cx + r * Math.cos(rad), y: RING.cy + r * Math.sin(rad), ...ring });
    }
  }
  const row: Look = { c: [255, 120, 90], a: 0.55, s: 2 };
  for (let i = 0; i < QUEUE.rows; i++) rectOutline(out, QUEUE.x, QUEUE.y + i * QUEUE.step, QUEUE.w, QUEUE.rowH, 8, row);
  const chip: Look = { c: [245, 227, 220], a: 0.5, s: 2 };
  TIERS.forEach((t, i) => rectOutline(out, TIER_X[i], TIER_Y, t.w, 22, 6, chip));
  // a short rule under the queue heading
  along(out, { x: QUEUE.x, y: QUEUE.y - 10 }, { x: QUEUE.x + QUEUE.w, y: QUEUE.y - 10 }, 10, { c: [255, 120, 90], a: 0.3, s: 1.6 });
  return out;
}
