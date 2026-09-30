// Helpers for the pixel break-apart: turn a drawing's lines into evenly spaced dots.
// All in the 760px stage coordinates.

export interface MorphPoint {
  x: number;
  y: number;
  c: [number, number, number]; // colour
  a: number; // alpha
  s: number; // square size
}

export interface Look {
  c: [number, number, number];
  a: number;
  s: number;
}

export function along(out: MorphPoint[], p: { x: number; y: number }, q: { x: number; y: number }, spacing: number, look: Look) {
  const n = Math.max(1, Math.round(Math.hypot(q.x - p.x, q.y - p.y) / spacing));
  for (let i = 0; i <= n; i++) out.push({ x: p.x + ((q.x - p.x) * i) / n, y: p.y + ((q.y - p.y) * i) / n, ...look });
}

export function rectOutline(out: MorphPoint[], x: number, y: number, w: number, h: number, spacing: number, look: Look) {
  const a = { x, y };
  const b = { x: x + w, y };
  const c = { x: x + w, y: y + h };
  const d = { x, y: y + h };
  along(out, a, b, spacing, look);
  along(out, b, c, spacing, look);
  along(out, c, d, spacing, look);
  along(out, d, a, spacing, look);
}

export function circleOutline(out: MorphPoint[], cx: number, cy: number, r: number, count: number, look: Look) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), ...look });
  }
}
