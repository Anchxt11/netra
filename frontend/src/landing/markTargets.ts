// The NETRA eye mark as dots, in the globe's 760px stage coordinates: on scroll the globe's land
// pixels break apart and re-form as the logo. Sampled from the real mark (public/brand/netra-mark.png).
import type { TargetPoint } from "./Globe";

const SRC = "/brand/netra-mark.png";
const BOX_W = 520; // the mark's width on the stage
const CENTRE = { x: 380, y: 360 };
const STEP = 6.5; // dot spacing

let ready: Promise<() => TargetPoint[]> | null = null;

/** Resolves once the mark is loaded and sampled; the function it gives always returns the same points. */
export function loadMarkTargets(): Promise<() => TargetPoint[]> {
  ready ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = BOX_W;
      const h = Math.round((img.naturalHeight / img.naturalWidth) * BOX_W);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(Math.round(y) * w + Math.round(x)) * 4 + 3] > 120;
      const points: TargetPoint[] = [];
      for (let y = 0; y < h; y += STEP) {
        for (let x = 0; x < w; x += STEP) {
          if (!solid(x, y)) continue;
          // Dots on the outline are brighter, so the eye reads crisply.
          const edge = !solid(x - STEP, y) || !solid(x + STEP, y) || !solid(x, y - STEP) || !solid(x, y + STEP);
          points.push({ x: CENTRE.x - w / 2 + x, y: CENTRE.y - h / 2 + y, kind: edge ? "hot" : "block" });
        }
      }
      resolve(() => points);
    };
    img.onerror = () => reject(new Error(`could not load ${SRC}`));
    img.src = SRC;
  });
  return ready;
}
