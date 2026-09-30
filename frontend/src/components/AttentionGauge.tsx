import { NumText } from "./NumText";
import styles from "./Readouts.module.css";

const R = 19;
const CIRC = 2 * Math.PI * R;

/** How strong the evidence is: a rust ring from 0 to 100. */
export function AttentionGauge({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={styles.gauge} role="img" aria-label={`Attention ${v} out of 100`}>
      <svg width="46" height="46" aria-hidden="true">
        <circle cx="23" cy="23" r={R} stroke="var(--unlit)" strokeWidth="5" fill="none" />
        <circle
          cx="23"
          cy="23"
          r={R}
          stroke="var(--rust)"
          strokeWidth="5"
          fill="none"
          strokeDasharray={`${(v / 100) * CIRC} ${CIRC}`}
          transform="rotate(-90 23 23)"
          strokeLinecap={v > 0 && v < 100 ? "round" : "butt"}
        />
      </svg>
      <div aria-hidden="true">
        <div className={styles.label}>ATTENTION</div>
        <NumText value={v} size="l" color="var(--text-hi)" />
        <span className={styles.unit}> /100</span>
      </div>
    </div>
  );
}
