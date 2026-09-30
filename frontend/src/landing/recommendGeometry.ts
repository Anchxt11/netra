// Step 5 (RECOMMEND) layout, in the 760px stage coordinates, shared by the drawing and the
// pixel break-apart that builds it.
import { along, circleOutline, rectOutline, type Look, type MorphPoint } from "./morphPoints";

/** The top fix: the dashboard's FixCard. */
export const FIX_CARD = { x: 130, y: 196, w: 270, h: 310 };
/** Fixes 2 and 3, as slim rows under it. */
export const MINI_ROWS = [
  { rank: 2, name: "Revoke active sessions", confidence: 0.83, y: 528 },
  { rank: 3, name: "Reset credentials", confidence: 0.79, y: 566 },
];
export const MINI_H = 30;

/** Plain-language callouts to the right of the card, at the part they describe. */
export const CALLOUT_X = 430;
export const CALLOUTS = [
  { y: 236, text: "How sure the AI is" },
  { y: 344, text: "Why it picked this fix" },
  { y: 478, text: "A person makes the final call" },
];
/** After approval, under the rows. */
export const LEARN_Y = 630;

/** Step 5's drawing as dots: where step 4's pixels land. */
export function recommendPoints(): MorphPoint[] {
  const out: MorphPoint[] = [];
  const card: Look = { c: [255, 150, 120], a: 0.7, s: 2.2 };
  const cyan: Look = { c: [82, 216, 255], a: 0.9, s: 2.4 };
  const green: Look = { c: [60, 242, 155], a: 0.85, s: 2.2 };
  const { x, y, w, h } = FIX_CARD;
  rectOutline(out, x, y, w, h, 6, card);
  circleOutline(out, x + w - 35, y + 35, 15, 22, cyan); // confidence ring
  along(out, { x: x + 16, y: y + 168 }, { x: x + 170, y: y + 168 }, 6, cyan); // reason bars
  along(out, { x: x + 16, y: y + 226 }, { x: x + 128, y: y + 226 }, 6, cyan);
  rectOutline(out, x + 16, y + h - 48, 150, 34, 6, green); // approve
  rectOutline(out, x + 174, y + h - 48, 80, 34, 7, card); // reject
  for (const r of MINI_ROWS) rectOutline(out, x, r.y, w, MINI_H, 8, { c: [255, 150, 120], a: 0.4, s: 2 });
  for (const c of CALLOUTS) along(out, { x: x + w + 6, y: c.y }, { x: CALLOUT_X - 6, y: c.y }, 5, { c: [245, 227, 220], a: 0.5, s: 1.8 });
  return out;
}
