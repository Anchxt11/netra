// The pixel break-apart between two drawings: every dot of the first bursts outward a little, then
// travels to a dot of the second, nearest first. Same feel as the globe becoming the network.
// Canvas, in the 760px stage coordinates scaled to the stage.
import { useEffect, useRef } from "react";
import type { MotionValue } from "motion/react";
import { createRng } from "../data/rng";
import type { MorphPoint } from "./morphPoints";
import styles from "./PixelMorph.module.css";

const BASE = 760;
const MAX_DPR = 2;
const MAX_DELAY = 0.35;

interface Particle {
  sx: number; sy: number; tx: number; ty: number;
  sc: [number, number, number]; tc: [number, number, number];
  sa: number; ta: number; ss: number; ts: number;
  dx: number; dy: number; delay: number;
}

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const key = (p: MorphPoint) => p.x + p.y * 0.6; // sort both drawings along one diagonal: a sweep, not a tangle

function pair(from: MorphPoint[], to: MorphPoint[], seed: number): Particle[] {
  const a = [...from].sort((p, q) => key(p) - key(q));
  const b = [...to].sort((p, q) => key(p) - key(q));
  const n = Math.max(a.length, b.length);
  const cx = b.reduce((s, p) => s + p.x, 0) / b.length;
  const cy = b.reduce((s, p) => s + p.y, 0) / b.length;
  const far = Math.max(...a.map((p) => Math.hypot(p.x - cx, p.y - cy)), 1);
  const r = createRng(seed);
  return Array.from({ length: n }, (_, k) => {
    const s = a[Math.floor((k * a.length) / n)];
    const t = b[Math.floor((k * b.length) / n)];
    const ang = r() * Math.PI * 2;
    const burst = 16 + r() * 52;
    return {
      sx: s.x, sy: s.y, tx: t.x, ty: t.y, sc: s.c, tc: t.c, sa: s.a, ta: t.a, ss: s.s, ts: t.s,
      dx: Math.cos(ang) * burst, dy: Math.sin(ang) * burst,
      delay: (Math.hypot(s.x - cx, s.y - cy) / far) * MAX_DELAY,
    };
  });
}

interface Props {
  from: () => MorphPoint[];
  to: () => MorphPoint[];
  /** 0 = the first drawing, 1 = the second. */
  progress: MotionValue<number>;
  /** The layer's opacity: nothing is drawn while it is hidden. */
  visible: MotionValue<number>;
  seed?: number;
}

export function PixelMorph({ from, to, progress, visible, seed = 11 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ from, to, progress, visible, seed });
  live.current = { from, to, progress, visible, seed };

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;

    let parts: Particle[] | null = null;
    let size = 0;
    let dpr = 1;
    let raf = 0;
    let drawn = -1; // the progress last drawn, so a still frame is not redrawn

    const resize = () => {
      size = Math.round(Math.min(wrap.clientWidth, wrap.clientHeight));
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      drawn = -1;
    };

    const draw = (m: number) => {
      parts ??= pair(live.current.from(), live.current.to(), live.current.seed);
      const k = size / BASE;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      for (const p of parts) {
        const local = Math.max(0, Math.min(1, (m - p.delay) / (1 - MAX_DELAY)));
        const e = ease(local);
        const bulge = Math.sin(Math.PI * e);
        const x = (p.sx + (p.tx - p.sx) * e + p.dx * bulge) * k;
        const y = (p.sy + (p.ty - p.sy) * e + p.dy * bulge) * k;
        const s = (p.ss + (p.ts - p.ss) * e) * k;
        const r = Math.round(p.sc[0] + (p.tc[0] - p.sc[0]) * e);
        const g = Math.round(p.sc[1] + (p.tc[1] - p.sc[1]) * e);
        const b = Math.round(p.sc[2] + (p.tc[2] - p.sc[2]) * e);
        const a = p.sa + (p.ta - p.sa) * e;
        ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(2)})`;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (live.current.visible.get() < 0.01) return;
      const m = live.current.progress.get();
      if (Math.abs(m - drawn) < 0.0005) return;
      drawn = m;
      draw(m);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} className={styles.morph}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
