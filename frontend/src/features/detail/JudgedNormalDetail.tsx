import { Check } from "@phosphor-icons/react";
import type { BenignAnomaly } from "../../data/types";
import { GlassCard } from "../../components/GlassCard";
import { BoxTitle } from "../../components/Panel";
import { formatClock } from "../../lib/time";
import styles from "./Detail.module.css";

/** Replaces the centre when a judged-normal item is selected. Proves NETRA does not cry wolf. */
export function JudgedNormalDetail({ anomaly }: { anomaly: BenignAnomaly }) {
  return (
    <GlassCard className={styles.judged}>
      <div className={styles.head}>
        <BoxTitle>JUDGED NORMAL</BoxTitle>
        <span className={styles.opened}>{formatClock(anomaly.ts)}</span>
      </div>
      <h2 className={styles.name}>{anomaly.name}</h2>
      <p className={styles.sentence}>{anomaly.sentence}</p>
      <ul className={styles.checks}>
        {anomaly.checks.map((c) => (
          <li key={c.label}>
            <Check weight="bold" size={14} className={c.passed ? styles.pass : styles.nopass} aria-hidden="true" />
            <span>{c.label}</span>
            <span className="visually-hidden">{c.passed ? ", passed" : ", not passed"}</span>
          </li>
        ))}
      </ul>
      <p className={styles.closing}>No incident raised. Nothing for an analyst to do.</p>
    </GlassCard>
  );
}
