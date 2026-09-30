import type { RiskBreakdown } from "../lib/rank";
import { riskFormula } from "../lib/rank";
import { NumText } from "./NumText";
import { TierChip } from "./TierHeader";
import styles from "./Readouts.module.css";

interface Props {
  severity: number;
  breakdown: RiskBreakdown;
}

/** Risk value, its tier, and the sum that produced it, so the number explains itself. */
export function RiskReadout({ severity, breakdown }: Props) {
  return (
    <div>
      <div className={styles.label}>RISK</div>
      <div className={styles.riskRow}>
        <NumText value={breakdown.risk.toFixed(2)} size="l" color="var(--text-hi)" />
        <TierChip tier={breakdown.tier} />
      </div>
      <div className={styles.formula}>{riskFormula(severity, breakdown)}</div>
    </div>
  );
}
