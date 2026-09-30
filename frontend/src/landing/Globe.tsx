// The landing globe (step 1, INGEST): rust pixel land, a faint graticule, a halo, and dashed arcs
// carrying pale-yellow events (heat-1: the data is fresh) to "YOUR NETWORK".
// Drawn on canvas with d3-geo. Geometry from docs/reference/landing-step1.html (a 760px stage).
import { useEffect, useRef } from "react";
import type { MotionValue } from "motion/react";
import { geoDistance, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { ARCS, HOME_ROTATION, TARGET, buildLandDots, type LonLat } from "./globeData";
import styles from "./Globe.module.css";

const BASE = 760; // reference stage size; everything scales from it
const MAX_DPR = 1.5;
const FPS = 30;
const [HOME_LON, TILT] = HOME_ROTATION;
const SWAY_DEG = 22; // the globe turns slowly left and right, like an eye scanning
const SWAY_PERIOD_S = 40;
const EVENT_TRAVEL_S = 5; // seconds for an event to travel its arc
const GRATICULE = geoGraticule10();
const HALF_PI = Math.PI / 2;

let landCache: LonLat[] | null = null;

interface Props {
  /** 0 to 1: how much the globe sways. Scrolling to step 2 brings it to rest before the dive. */
  sway?: MotionValue<number>;
  /** The globe layer's opacity: nothing is drawn once it has faded out. */
  visible?: MotionValue<number>;
}

export function Globe({ sway, visible }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const swayRef = useRef(sway);
  const visibleRef = useRef(visible);
  swayRef.current = sway;
  visibleRef.current = visible;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;

    const land = (landCache ??= buildLandDots());
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let size = 0;
    let dpr = 1;
    let raf = 0;
    let last = 0;
    let onScreen = true;
    const t0 = performance.now();

    const resize = () => {
      size = Math.round(Math.min(wrap.clientWidth, wrap.clientHeight));
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
    };

    const draw = (tSec: number, still: boolean) => {
      const k = size / BASE;
      const cx = size / 2;
      const cy = size / 2;
      const R = 292 * k;
      const amp = swayRef.current?.get() ?? 1;
      const lon = still ? HOME_LON : HOME_LON + amp * SWAY_DEG * Math.sin((2 * Math.PI * tSec) / SWAY_PERIOD_S);
      const proj = geoOrthographic().scale(R).translate([cx, cy]).rotate([lon, TILT]).clipAngle(90);
      const centre: LonLat = [-lon, -TILT];
      const path = geoPath(proj, ctx);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      // halo
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R + 26 * k);
      halo.addColorStop(0.7, "rgba(255,74,38,0)");
      halo.addColorStop(1, "rgba(255,74,38,0.13)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, R + 26 * k, 0, Math.PI * 2);
      ctx.fill();

      // sphere, shaded from the upper left
      const shade = ctx.createRadialGradient(cx - R * 0.16, cy - R * 0.24, 0, cx, cy, R * 1.3);
      shade.addColorStop(0, "rgba(40,14,10,0.55)");
      shade.addColorStop(1, "rgba(8,3,2,0.85)");
      ctx.fillStyle = shade;
      ctx.strokeStyle = "rgba(255,120,90,0.55)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // graticule
      ctx.beginPath();
      path(GRATICULE);
      ctx.strokeStyle = "rgba(255,120,90,0.10)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // dotted land: rust squares, fading toward the edge
      const sq = 3.4 * k;
      for (const p of land) {
        const d = geoDistance(p, centre);
        if (d > HALF_PI - 0.02) continue;
        const xy = proj(p);
        if (!xy) continue;
        const n = d / HALF_PI;
        ctx.fillStyle = `rgba(255,108,70,${(0.95 - 0.65 * n * n).toFixed(2)})`;
        ctx.fillRect(xy[0] - sq / 2, xy[1] - sq / 2, sq, sq);
      }

      // arcs, lifted outward for a 3D feel, each carrying one event
      const lift = (x: number, y: number, t: number) => {
        const dx = x - cx;
        const dy = y - cy;
        const dd = Math.hypot(dx, dy) || 1;
        const h = Math.sin(Math.PI * t) * 18 * k;
        return [x + (dx / dd) * h, y + (dy / dd) * h] as const;
      };
      ctx.setLineDash([5 * k, 4 * k]);
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = "rgba(255,74,38,0.75)";
      ARCS.forEach((arc, ai) => {
        const end = arc.length - 1;
        const pts: (readonly [number, number] | null)[] = arc.map((p, i) => {
          if (geoDistance(p, centre) >= HALF_PI) return null;
          const xy = proj(p);
          return xy ? lift(xy[0], xy[1], i / end) : null;
        });

        ctx.beginPath();
        let pen = false;
        for (const pt of pts) {
          if (!pt) {
            pen = false;
            continue;
          }
          if (pen) ctx.lineTo(pt[0], pt[1]);
          else ctx.moveTo(pt[0], pt[1]);
          pen = true;
        }
        ctx.stroke();

        // source ring
        const src = pts[0];
        if (src) {
          ctx.setLineDash([]);
          ctx.strokeStyle = "#FF9A3C";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(src[0], src[1], 3 * k + 0.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([5 * k, 4 * k]);
          ctx.strokeStyle = "rgba(255,74,38,0.75)";
          ctx.lineWidth = 1.3;
        }

        // the travelling event: pale yellow, with a soft glow
        const phase = still ? 0.62 : (tSec / EVENT_TRAVEL_S + ai * 0.137) % 1;
        const head = pts[Math.round(phase * end)];
        if (head) {
          ctx.fillStyle = "rgba(255,217,90,0.18)";
          ctx.fillRect(head[0] - 6 * k, head[1] - 6 * k, 12 * k, 12 * k);
          ctx.fillStyle = "#FFE9A8";
          ctx.fillRect(head[0] - 2.5 * k, head[1] - 2.5 * k, 5 * k, 5 * k);
        }
      });
      ctx.setLineDash([]);

      // YOUR NETWORK: crosshair and label
      if (geoDistance(TARGET, centre) < HALF_PI) {
        const t = proj(TARGET);
        if (t) drawTarget(ctx, t[0], t[1], k);
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / FPS) return;
      last = now;
      if ((visibleRef.current?.get() ?? 1) < 0.01) return; // faded out: skip the work
      draw((now - t0) / 1000, false);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      if (reduced.matches) {
        draw(0, true); // one still frame
        return;
      }
      if (onScreen && !document.hidden) raf = requestAnimationFrame(loop);
    };

    const ro = new ResizeObserver(() => {
      resize();
      draw((performance.now() - t0) / 1000, reduced.matches);
    });
    ro.observe(wrap);
    // Only draw while the stage is on screen.
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      start();
    });
    io.observe(wrap);
    document.addEventListener("visibilitychange", start);
    reduced.addEventListener("change", start);

    resize();
    start();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", start);
      reduced.removeEventListener("change", start);
    };
  }, []);

  return (
    <div ref={wrapRef} className={styles.globe}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}

function drawTarget(ctx: CanvasRenderingContext2D, x: number, y: number, k: number) {
  const cream = "#FFF1EA";
  ctx.strokeStyle = cream;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, 26 * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#FF4A26";
  ctx.beginPath();
  ctx.arc(x, y, 5 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    ctx.moveTo(x + dx * 30 * k, y + dy * 30 * k);
    ctx.lineTo(x + dx * 40 * k, y + dy * 40 * k);
  }
  ctx.stroke();

  // label: YOUR NETWORK, and the four hosts under it
  ctx.fillStyle = "#FF4A26";
  roundRect(ctx, x + 34 * k, y - 40 * k, 132 * k, 22 * k, 4 * k);
  ctx.fillStyle = "#1A0906";
  ctx.font = `500 ${Math.max(9, 11 * k)}px "IBM Plex Mono", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("YOUR NETWORK", x + 100 * k, y - 29 * k);

  ctx.fillStyle = "rgba(11,6,5,0.85)";
  roundRect(ctx, x + 32 * k, y - 15 * k, 178 * k, 16 * k, 3 * k);
  ctx.fillStyle = "#F5E3DC";
  ctx.font = `400 ${Math.max(8.5, 10 * k)}px "IBM Plex Mono", monospace`;
  ctx.textAlign = "left";
  ctx.fillText("web-01 web-02 auth-01 db-01", x + 36 * k, y - 7 * k);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
