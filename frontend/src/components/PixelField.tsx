import { useEffect, useRef } from "react";
import styles from "./PixelField.module.css";

interface Blob {
  x: number; // centre, share of viewport width
  y: number; // centre, share of viewport height
  r: number; // radius in px at 1440 wide
  color: [number, number, number];
  strength: number;
  period: number; // seconds for one drift loop (40 to 60 s)
}

// Positions and colours from docs/reference/dashboard.html.
const BLOBS: Blob[] = [
  { x: 0.16, y: 0.92, r: 560, color: [255, 74, 38], strength: 1, period: 52 },
  { x: 0.88, y: 0.13, r: 520, color: [168, 46, 92], strength: 0.85, period: 60 },
  { x: 0.64, y: 0.67, r: 300, color: [255, 120, 50], strength: 0.45, period: 44 },
  { x: 0.44, y: 0.1, r: 260, color: [255, 74, 38], strength: 0.25, period: 48 },
];

const CELL = 9; // grid pitch in CSS px (the 3px dot is cut by a CSS mask)
const FPS = 15;
const DRIFT = 0.05; // how far blobs wander, as a share of the viewport

interface Props {
  /** 0 to 1. Overall brightness of the dots and the glow behind them. */
  intensity?: number;
}

/**
 * The page background: 3px squares on a 9px grid, lit by slow drifting colour blobs.
 * One canvas pixel per dot, scaled up by CSS and masked into squares, so a frame costs under 1 ms.
 */
export function PixelField({ intensity = 1 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const n = BLOBS.length;
    const bx = new Float32Array(n);
    const by = new Float32Array(n);
    const invR2 = new Float32Array(n);
    const dy2 = new Float32Array(n);
    let cols = 0;
    let rows = 0;
    let image: ImageData;
    let noise: Float32Array; // stable per-dot randomness, so dots never flicker
    let raf = 0;
    let last = 0;

    const setup = () => {
      cols = Math.ceil(window.innerWidth / CELL);
      rows = Math.ceil(window.innerHeight / CELL);
      canvas.width = cols;
      canvas.height = rows;
      canvas.style.width = `${cols * CELL}px`;
      canvas.style.height = `${rows * CELL}px`;
      image = ctx.createImageData(cols, rows);
      let seed = 42;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      noise = new Float32Array(cols * rows * 3);
      for (let i = 0; i < noise.length; i++) noise[i] = rnd();
    };

    const draw = (tSec: number) => {
      const data = image.data;
      data.fill(0);
      const w = window.innerWidth;
      const h = window.innerHeight;
      const scale = w / 1440;
      for (let k = 0; k < n; k++) {
        const b = BLOBS[k];
        const phase = (tSec / b.period) * Math.PI * 2;
        bx[k] = (b.x + Math.sin(phase) * DRIFT) * w;
        by[k] = (b.y + Math.cos(phase * 0.8) * DRIFT) * h;
        invR2[k] = 1 / (b.r * scale) ** 2;
      }

      for (let gy = 0; gy < rows; gy++) {
        const py = gy * CELL;
        for (let k = 0; k < n; k++) dy2[k] = (py - by[k]) ** 2 * invR2[k];
        for (let gx = 0; gx < cols; gx++) {
          const px = gx * CELL;
          let R = 0;
          let G = 0;
          let B = 0;
          let v = 0;
          for (let k = 0; k < n; k++) {
            const dx = px - bx[k];
            const f = 1 - dx * dx * invR2[k] - dy2[k];
            if (f <= 0) continue;
            const wgt = f * BLOBS[k].strength;
            const c = BLOBS[k].color;
            v += wgt;
            R += c[0] * wgt;
            G += c[1] * wgt;
            B += c[2] * wgt;
          }
          if (v <= 0.02) continue;
          const cell = gy * cols + gx;
          const t = v < 1 ? v : 1;
          if (noise[cell * 3] > t * 1.1 + 0.08) continue; // dithered: fewer dots where the glow is weak
          const i = cell * 4;
          if (noise[cell * 3 + 2] < 0.012 * t) {
            data[i] = 255; // rare cream sparkle
            data[i + 1] = 230;
            data[i + 2] = 210;
            data[i + 3] = 0.5 * t * intensity * 255;
            continue;
          }
          data[i] = R / v;
          data[i + 1] = G / v;
          data[i + 2] = B / v;
          data[i + 3] = (0.1 + 0.45 * t) * (0.55 + 0.45 * noise[cell * 3 + 1]) * intensity * 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / FPS) return;
      last = now;
      draw(now / 1000);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      if (reduced.matches || document.hidden) {
        draw(0); // one still frame
        return;
      }
      raf = requestAnimationFrame(loop);
    };

    const onResize = () => {
      setup();
      start();
    };

    setup();
    start();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", start);
    reduced.addEventListener("change", start);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", start);
      reduced.removeEventListener("change", start);
    };
  }, [intensity]);

  return (
    <div className={styles.field} aria-hidden="true">
      <div className={styles.glow} style={{ opacity: intensity }} />
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
