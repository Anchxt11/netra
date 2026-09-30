import type { DetectedBy } from "../data/types";
import { isGoingCold } from "../lib/heat";
import { formatCountdown } from "../lib/time";
import { HeatSegments } from "./HeatSegments";
import { NumText } from "./NumText";
import { SourceTag } from "./SourceTag";
import styles from "./QueueRow.module.css";

interface Props {
  score: number; // attention score
  name: string;
  detectedBy: DetectedBy;
  mitreId: string;
  remaining: number;
  timeLeftMs: number;
  selected?: boolean;
  /** WATCH rows are dimmed to 62%. */
  dimmed?: boolean;
  onSelect?: () => void;
}

/** One incident in NEEDS ATTENTION. Exactly one row is ever selected. */
export function QueueRow({ score, name, detectedBy, mitreId, remaining, timeLeftMs, selected, dimmed, onSelect }: Props) {
  const cold = isGoingCold(remaining);
  const time = formatCountdown(timeLeftMs);
  const cls = [styles.row, selected && styles.selected, dimmed && !selected && styles.dimmed].filter(Boolean).join(" ");

  return (
    <button type="button" className={cls} aria-pressed={selected} onClick={onSelect} data-row>
      <NumText value={score} size="m" className={styles.score} />
      <span className={styles.nameCol}>
        <span className={styles.name}>{name}</span>
        <span className={styles.meta}>
          {detectedBy !== "ai" && <SourceTag source="rule" className={styles.tag} />}
          {detectedBy !== "rule" && <SourceTag source="ai" className={styles.tag} />}
          <span className={styles.mitre}>{mitreId}</span>
        </span>
      </span>
      <span className={styles.timeCol}>
        <HeatSegments remaining={remaining} onRust={selected} />
        {cold ? (
          <span className={styles.cold}>
            <span className="visually-hidden">Going cold, </span>
            {time}
          </span>
        ) : (
          <span className={styles.time}>{time}</span>
        )}
      </span>
    </button>
  );
}
