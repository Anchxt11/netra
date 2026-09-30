import { heatColor } from "../lib/heat";
import styles from "./HeatSegments.module.css";

interface Props {
  /** Share of the time window left, 0 to 1. */
  remaining: number;
  count?: number;
  /** Dark segments, for use on the selected rust row. */
  onRust?: boolean;
}

/** Segments switch off one by one as time runs out. Colour = heat. */
export function HeatSegments({ remaining, count = 16, onRust }: Props) {
  const lit = Math.ceil(remaining * count);
  const color = onRust ? "var(--on-rust)" : heatColor(remaining);
  return (
    <span className={`${styles.segs} ${onRust ? styles.onRust : ""}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} style={i < lit ? { background: color } : undefined} />
      ))}
    </span>
  );
}
