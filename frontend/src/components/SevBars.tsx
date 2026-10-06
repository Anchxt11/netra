import styles from "./Readouts.module.css";

const HEIGHTS = [6, 10, 14, 17, 21];

interface Props {
  severity: number; // 1 to 5
  /** Show the "SEVERITY" label above. */
  labelled?: boolean;
}

/** How bad if real. Severity is never a colour: bars plus "4/5". */
export function SevBars({ severity, labelled }: Props) {
  return (
    <div>
      {labelled && <div className={styles.label}>Severity</div>}
      <div className={styles.sev} role="img" aria-label={`Severity ${severity} of 5`}>
        <span className={styles.bars} aria-hidden="true">
          {HEIGHTS.map((h, i) => (
            <i key={h} style={{ height: h }} className={i < severity ? styles.barOn : undefined} />
          ))}
        </span>
        <span className={styles.sevText} aria-hidden="true">
          {severity}
          <span style={{ color: "var(--faint)" }}>/5</span>
        </span>
      </div>
    </div>
  );
}
