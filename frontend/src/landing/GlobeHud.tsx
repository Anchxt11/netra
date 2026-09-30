// The still parts of the globe stage: dashed outer ring, tick ring and side brackets (SVG, 760 base).
import styles from "./GlobeHud.module.css";

const C = 380;
const R = 292;
const TICKS = Array.from({ length: 120 }, (_, k) => {
  const a = (k * 3 * Math.PI) / 180;
  const len = k % 10 ? 5 : 12;
  return {
    x1: C + (R + 46) * Math.cos(a),
    y1: C + (R + 46) * Math.sin(a),
    x2: C + (R + 46 + len) * Math.cos(a),
    y2: C + (R + 46 + len) * Math.sin(a),
  };
});
const BX = R + 70;

export function GlobeHud() {
  return (
    <svg viewBox="0 0 760 760" className={styles.hud} aria-hidden="true">
      <circle cx={C} cy={C} r={R + 40} className={styles.ring} />
      {TICKS.map((t, i) => (
        <line key={i} {...t} className={styles.tick} />
      ))}
      <path d={`M${C - BX + 18},${C - 150} H${C - BX} V${C + 150} H${C - BX + 18}`} className={styles.bracket} />
      <path d={`M${C + BX - 18},${C - 150} H${C + BX} V${C + 150} H${C + BX - 18}`} className={styles.bracket} />
    </svg>
  );
}
