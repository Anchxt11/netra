import type { DetectedBy } from "../data/types";
import { heatColor, isGoingCold } from "../lib/heat";
import { formatCountdown } from "../lib/time";
import styles from "./QueueRow.module.css";

interface Props {
  score: number; // attention score
  name: string;
  detectedBy: DetectedBy;
  mitreId: string;
  remaining: number;
  timeLeftMs: number;
  selected?: boolean;
  /** WATCH rows are dimmed. */
  dimmed?: boolean;
  onSelect?: () => void;
}

/** One incident in Needs attention: a dot for time left (ember to ash), the name, the time. Exactly one row is selected. */
export function QueueRow({ score, name, detectedBy, mitreId, remaining, timeLeftMs, selected, dimmed, onSelect }: Props) {
  const cold = isGoingCold(remaining);
  const time = formatCountdown(timeLeftMs);
  const cls = [styles.row, selected && styles.selected, dimmed && !selected && styles.dimmed].filter(Boolean).join(" ");
  const by = detectedBy === "both" ? "rules and AI" : detectedBy === "ai" ? "AI" : "rules";

  return (
    <button
      type="button"
      className={cls}
      aria-pressed={selected}
      onClick={onSelect}
      data-row
      aria-label={`${name}, ${time} left${cold ? ", going cold" : ""}, attention ${score}, found by ${by}${mitreId ? `, ${mitreId}` : ""}`}
    >
      <i className={styles.dot} style={{ background: heatColor(remaining) }} aria-hidden="true" />
      <span className={styles.nameCol} aria-hidden="true">
        <span className={styles.name}>{name}</span>
        <span className={styles.meta}>
          {score}
          {detectedBy !== "rule" && <span className={styles.ai}> · AI</span>}
          {mitreId && <span className={styles.mitre}> · {mitreId}</span>}
        </span>
      </span>
      <span className={cold ? styles.cold : styles.time} aria-hidden="true">
        {time}
      </span>
    </button>
  );
}
