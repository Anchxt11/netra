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
  /** New alerts that just joined this incident (a repeated attack): shown for a few seconds. */
  bump?: number;
  /** Where it comes from: one address, or "6 addresses" for a spread-out attack. */
  source?: string;
  onSelect?: () => void;
}

/** One incident in Needs attention: a dot for time left (ember to ash), the name, the time. Exactly one row is selected. */
export function QueueRow({ score, name, detectedBy, mitreId, remaining, timeLeftMs, selected, dimmed, bump, source, onSelect }: Props) {
  const cold = isGoingCold(remaining);
  const time = formatCountdown(timeLeftMs);
  const cls = [styles.row, selected && styles.selected, dimmed && !selected && styles.dimmed, bump && styles.bumped].filter(Boolean).join(" ");
  const by = detectedBy === "both" ? "rules and AI" : detectedBy === "ai" ? "AI" : "rules";

  return (
    <button
      type="button"
      className={cls}
      aria-pressed={selected}
      onClick={onSelect}
      data-row
      aria-label={`${name}, ${time} left${cold ? ", going cold" : ""}, attention ${score}, found by ${by}${source ? `, from ${source}` : ""}${mitreId ? `, ${mitreId}` : ""}${bump ? `, ${bump} new ${bump === 1 ? "alert" : "alerts"}` : ""}`}
    >
      <i className={styles.dot} style={{ background: heatColor(remaining) }} aria-hidden="true" />
      <span className={styles.nameCol} aria-hidden="true">
        <span className={styles.name}>{name}</span>
        <span className={styles.meta}>
          {score}
          {source && <span className={styles.source}> · {source}</span>}
          {detectedBy !== "rule" && <span className={styles.ai}> · AI</span>}
          {bump ? (
            <span className={styles.bump}> · +{bump} {bump === 1 ? "alert" : "alerts"}</span>
          ) : (
            mitreId && <span className={styles.mitre}> · {mitreId}</span>
          )}
        </span>
      </span>
      <span className={cold ? styles.cold : styles.time} aria-hidden="true">
        {time}
      </span>
    </button>
  );
}
