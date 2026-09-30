import type { Signal } from "../data/types";
import styles from "./EvidenceBar.module.css";

interface Props {
  signals: Signal[];
  attention: number;
}

const isAi = (s: Signal) => s.ruleId === "ATDE";

/**
 * The attention score, explained: each signal is a stacked segment coloured by who raised it
 * (violet = rule, cyan = AI), climbing to the score. Dashed marks at 30 (suspicious) and 60 (critical).
 */
export function EvidenceBar({ signals, attention }: Props) {
  let total = 0;
  const segments = signals.map((s, i) => {
    const h = Math.max(0, Math.min(s.points, 100 - total));
    total += h;
    const opacity = 0.55 + (0.36 * (i + 1)) / Math.max(1, signals.length); // older signals a little dimmer
    return { id: s.id, h, ai: isAi(s), opacity };
  });
  const rules = signals.filter((s) => !isAi(s)).length;
  const ai = signals.length - rules;

  return (
    <div
      className={styles.wrap}
      role="img"
      aria-label={`Attention ${attention} of 100: ${rules} rule signals and ${ai} AI signals. Suspicious from 30, critical from 60.`}
    >
      <div className={styles.bar} aria-hidden="true">
        {segments.map((s) =>
          s.h > 0 ? (
            <i key={s.id} className={s.ai ? styles.ai : styles.rule} style={{ height: `${s.h}%`, opacity: s.opacity }} />
          ) : null,
        )}
        <span className={styles.mark} style={{ bottom: "30%" }} />
        <span className={styles.mark} style={{ bottom: "60%" }} />
      </div>
      <span className={styles.label} style={{ bottom: "60%" }} aria-hidden="true">
        60
      </span>
      <span className={styles.label} style={{ bottom: "30%" }} aria-hidden="true">
        30
      </span>
    </div>
  );
}
