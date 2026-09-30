// Step 3 (CORRELATE) layout, in the 760px stage coordinates, shared by the SVG and the pixel
// break-apart into step 4.
import { HOSTS, blockEdges, iso, targetPoints } from "./networkGeometry";
import { along, circleOutline, rectOutline, type MorphPoint } from "./morphPoints";

/** The account sits on top of auth-01, like a token on the server it lives on. */
export const ACCOUNT = iso(2, 2, 56);
export const ACCOUNT_NAME = "maria.silva";
export const ACCOUNT_NOTE = "The one account they target";
export const ACCOUNT_W = ACCOUNT_NAME.length * 7 + 18;
export const PLATE_W = 196;

// Six addresses on a ring around auth-01 (grid units), with their last octets as labels.
const RING = 2.8;
export const ADDRESSES = [
  { deg: 75, label: ".24", above: false },
  { deg: 135, label: ".31", above: false },
  { deg: 195, label: ".57", above: true }, // labels above: the account tag sits just below these two
  { deg: -105, label: ".88", above: true },
  { deg: -45, label: ".102", above: false },
  { deg: 15, label: ".140", above: false },
].map((a) => {
  const r = (a.deg * Math.PI) / 180;
  return { ...a, at: iso(2 + RING * Math.cos(r), 2 + RING * Math.sin(r)) };
});

// The incident card (lower right, clear of the addresses), and the warning signs that merge into it.
// Width fits the five chips: 14 + (34 + 34 + 34 + 36 + 42) + 4 x 4 + 14 = 228.
export const CARD = { x: 520, y: 570, w: 228, h: 94 };
export const CHIP_Y = CARD.y + 46;
export const SIGNALS: { id: string; source: "rule" | "ai"; w: number; from: number }[] = [
  { id: "CS-1", source: "rule", w: 34, from: 0 },
  { id: "CS-2", source: "rule", w: 34, from: 1 },
  { id: "CS-3", source: "rule", w: 34, from: 2 },
  { id: "ATDE", source: "ai", w: 36, from: 3 },
  { id: "ATO-1", source: "rule", w: 42, from: 5 },
];
export const CHIP_SLOTS = (() => {
  let x = CARD.x + 14;
  return SIGNALS.map((s) => {
    const at = x;
    x += s.w + 4;
    return at;
  });
})();

/** Step 3's drawing as dots: where step 4's pixels start from. */
export function correlatePoints(): MorphPoint[] {
  const out: MorphPoint[] = [];
  const floor = { c: [255, 120, 90] as [number, number, number], a: 0.35, s: 2 };
  for (const p of targetPoints()) if (p.kind === "floor") out.push({ x: p.x, y: p.y, ...floor });
  for (const h of HOSTS) {
    const look = { c: [255, 150, 120] as [number, number, number], a: h.name === "auth-01" ? 0.95 : 0.2, s: 2.4 };
    for (const [p, q] of blockEdges(h)) along(out, p, q, 5, look);
  }
  for (const a of ADDRESSES) {
    circleOutline(out, a.at.x, a.at.y, 7, 12, { c: [255, 122, 85], a: 0.95, s: 2.2 });
    along(out, a.at, ACCOUNT, 10, { c: [255, 74, 38], a: 0.55, s: 2 });
  }
  rectOutline(out, ACCOUNT.x - ACCOUNT_W / 2, ACCOUNT.y - 12, ACCOUNT_W, 24, 5, { c: [255, 74, 38], a: 1, s: 2.4 });
  rectOutline(out, ACCOUNT.x + ACCOUNT_W / 2, ACCOUNT.y - 12, PLATE_W, 24, 8, { c: [255, 150, 120], a: 0.4, s: 2 });
  rectOutline(out, CARD.x, CARD.y, CARD.w, CARD.h, 7, { c: [255, 150, 120], a: 0.45, s: 2 });
  return out;
}
