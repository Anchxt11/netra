import type { CSSProperties } from "react";
import { heatColor } from "../lib/heat";
import { formatClock, formatCountdown } from "../lib/time";
import { NumText } from "./NumText";
import styles from "./CountdownRing.module.css";

interface Props {
  remaining: number; // share of the window left, 0 to 1
  timeLeftMs: number;
  staleBy: string; // ISO deadline
  /** Pixel size. Leave it out to size the ring from CSS with --ring-size (default 184px). */
  size?: number;
}

const BOX = 184; // drawing size; the SVG scales to the rendered size
const SEGMENTS = 48;
const STEP = 360 / SEGMENTS; // 7.5° per segment
const GAP = 2; // degrees between segments

function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number) {
  const p = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180; // 0° = top
    return `${(cx + r * Math.cos(rad)).toFixed(2)},${(cy + r * Math.sin(rad)).toFixed(2)}`;
  };
  return `M${p(fromDeg)} A${r},${r} 0 0 1 ${p(toDeg)}`;
}

const PATHS = Array.from({ length: SEGMENTS }, (_, i) => arc(BOX / 2, BOX / 2, 80, i * STEP + GAP / 2, (i + 1) * STEP - GAP / 2));

/** 48 arc segments; the lit share is the time left, coloured by heat. */
export function CountdownRing({ remaining, timeLeftMs, staleBy, size }: Props) {
  const lit = Math.ceil(remaining * SEGMENTS);
  const color = heatColor(remaining);
  const time = formatCountdown(timeLeftMs);
  const staleAt = formatClock(staleBy);

  return (
    <div
      className={styles.ring}
      style={size ? ({ "--ring-size": `${size}px` } as CSSProperties) : undefined}
      role="img"
      aria-label={`Time left ${time}, data goes stale at ${staleAt}`}
    >
      <svg viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true">
        {PATHS.map((d, i) => (
          <path key={i} d={d} stroke={i < lit ? color : "var(--unlit)"} strokeWidth={9} fill="none" />
        ))}
      </svg>
      <div className={styles.centre} aria-hidden="true">
        <span className={styles.label}>TIME LEFT</span>
        <NumText value={time} size="xl" color="var(--text-hi)" className={styles.time} />
        <span className={styles.stale}>STALE AT {staleAt}</span>
      </div>
    </div>
  );
}
