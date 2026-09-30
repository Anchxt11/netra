// The isometric network (step 2 onwards), in the 760px stage coordinates shared by the globe canvas
// and the SVG. The pixel transition uses targetPoints() so the dots land exactly on the drawing.

export const CX = 380;
export const CY = 400;
export const U = 44; // one grid unit
const COS30 = Math.cos(Math.PI / 6);

export interface Pt {
  x: number;
  y: number;
}

/** Grid (i, j, height in px) to stage coordinates. */
export const iso = (i: number, j: number, z = 0): Pt => ({ x: CX + (i - j) * U * COS30, y: CY + (i + j) * U * 0.5 - z });

export interface Host {
  name: string;
  role: string; // plain words for a first-time viewer
  i: number;
  j: number;
  h: number; // block height in px
}

export const HOSTS: Host[] = [
  { name: "web-02", role: "website", i: -2, j: -2, h: 46 },
  { name: "web-01", role: "website", i: -2, j: 2, h: 46 },
  { name: "db-01", role: "database", i: 2, j: -2, h: 64 },
  { name: "auth-01", role: "logins", i: 2, j: 2, h: 56 },
];

export const HALF = 0.7; // block half-width in grid units

/** A block's corners: floor a, b, c, d and the same four raised by its height. */
export function blockCorners(host: Host) {
  const { i, j, h } = host;
  const a = iso(i - HALF, j - HALF);
  const b = iso(i + HALF, j - HALF);
  const c = iso(i + HALF, j + HALF);
  const d = iso(i - HALF, j + HALF);
  const up = (p: Pt): Pt => ({ x: p.x, y: p.y - h });
  return { a, b, c, d, A: up(a), B: up(b), C: up(c), D: up(d) };
}

/** Visible edges of a block (the back-bottom edges are hidden behind it). */
export function blockEdges(host: Host): [Pt, Pt][] {
  const { b, c, d, A, B, C, D } = blockCorners(host);
  return [
    [A, B], [B, C], [C, D], [D, A], // top
    [d, c], [c, b], // bottom front
    [D, d], [C, c], [B, b], // verticals
  ];
}

export const FLOOR = Array.from({ length: 9 }, (_, k) => k - 4);

export type Path = [number, number][];

// Streams arrive along the grid lines, from beyond the floor's edge into a host.
export const STREAMS: { id: string; path: Path }[] = [
  { id: "s-web01", path: [[-6.5, 2], [-2.7, 2]] },
  { id: "s-web02", path: [[-2, -6.5], [-2, -2.7]] },
  { id: "s-db01", path: [[6.5, -2], [2.7, -2]] },
  { id: "s-side", path: [[-1, 6.5], [-1, 2], [1.3, 2]] },
];
/** The stream that turns yellow: into auth-01 (logins) from the front edge. */
export const HOT: Path = [[2, 6.8], [2, 2.7]];
/** Where the bracket locks on. */
export const EVENT_AT = iso(2, 4.9);

export const pathPoints = (path: Path) => path.map(([i, j]) => iso(i, j));

export type TargetKind = "floor" | "block" | "stream" | "hot";

/** Points spread along every line of the drawing: where the globe's pixels land. */
export function targetPoints(): { x: number; y: number; kind: TargetKind }[] {
  const out: { x: number; y: number; kind: TargetKind }[] = [];
  const along = (p: Pt, q: Pt, spacing: number, kind: TargetKind) => {
    const n = Math.max(1, Math.round(Math.hypot(q.x - p.x, q.y - p.y) / spacing));
    for (let s = 0; s <= n; s++) out.push({ x: p.x + ((q.x - p.x) * s) / n, y: p.y + ((q.y - p.y) * s) / n, kind });
  };
  for (const k of FLOOR) {
    along(iso(k, -4), iso(k, 4), 16, "floor");
    along(iso(-4, k), iso(4, k), 16, "floor");
  }
  for (const h of HOSTS) for (const [p, q] of blockEdges(h)) along(p, q, 5, "block");
  for (const s of STREAMS) {
    const ps = pathPoints(s.path);
    for (let n = 1; n < ps.length; n++) along(ps[n - 1], ps[n], 9, "stream");
  }
  const hot = pathPoints(HOT);
  along(hot[0], hot[1], 7, "hot");
  return out;
}
