// The dashboard drawn as dots, in the globe's 760px stage coordinates: the globe's land pixels
// re-form into this outline on scroll, and the live product shot then appears exactly over it.
import type { TargetKind, TargetPoint } from "./Globe";

/** Where the product shot sits in the stage (the outline's frame). */
export const SHOT = { x: 40, y: 170, w: 680, h: 420 };

const along = (out: TargetPoint[], x1: number, y1: number, x2: number, y2: number, spacing: number, kind: TargetKind) => {
  const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / spacing));
  for (let i = 0; i <= n; i++) out.push({ x: x1 + ((x2 - x1) * i) / n, y: y1 + ((y2 - y1) * i) / n, kind });
};

const rect = (out: TargetPoint[], x: number, y: number, w: number, h: number, spacing: number, kind: TargetKind) => {
  along(out, x, y, x + w, y, spacing, kind);
  along(out, x + w, y, x + w, y + h, spacing, kind);
  along(out, x + w, y + h, x, y + h, spacing, kind);
  along(out, x, y + h, x, y, spacing, kind);
};

let cache: TargetPoint[] | null = null;

export function dashboardOutline(): TargetPoint[] {
  if (cache) return cache;
  const out: TargetPoint[] = [];
  const { x, y, w, h } = SHOT;

  rect(out, x, y, w, h, 9, "floor"); // the window

  // left: the queue, with the selected row
  rect(out, 54, 184, 140, 392, 9, "floor");
  rect(out, 62, 206, 124, 26, 6, "hot");
  for (let r = 0; r < 6; r++) along(out, 70, 252 + r * 30, 180, 252 + r * 30, 8, "stream");

  // centre: the incident card, its countdown ring, the escalation steps and the FIX button
  rect(out, 206, 184, 350, 286, 7, "block");
  along(out, 222, 214, 400, 214, 7, "stream");
  rect(out, 494, 196, 50, 18, 5, "hot");
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    out.push({ x: 288 + 54 * Math.cos(a), y: 352 + 54 * Math.sin(a), kind: "hot" });
  }
  for (let s = 0; s < 5; s++) along(out, 362 + s * 36, 420 - s * 26, 392 + s * 36, 420 - s * 26, 6, "stream");

  // centre bottom: the four tiles
  for (let t = 0; t < 4; t++) rect(out, 206 + t * 91, 482, 79, 94, 9, "floor");

  // right: the live feed, its bars and rows
  rect(out, 568, 184, 138, 392, 9, "floor");
  for (let b = 0; b < 19; b++) {
    const bh = 10 + ((b * 7) % 13) * 2;
    along(out, 580 + b * 6, 262, 580 + b * 6, 262 - bh, 4, b % 6 === 4 ? "hot" : "stream");
  }
  for (let r = 0; r < 11; r++) along(out, 580, 292 + r * 25, 694, 292 + r * 25, 9, "floor");

  cache = out;
  return out;
}
