import { useEffect, useRef } from "react";
import type { Signal } from "../data/types";
import { formatClock } from "../lib/time";
import { SourceTag } from "./SourceTag";
import styles from "./EscalationList.module.css";

/** The incident's story in time order: when, who found it (rule ID or ATDE), what, how many points. */
export function EscalationList({ signals }: { signals: Signal[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  const shown = useRef(signals.length);

  // When a new signal arrives (not on first show) and the list overflows, keep the newest in view.
  useEffect(() => {
    const el = listRef.current;
    if (el && signals.length > shown.current) el.scrollTop = el.scrollHeight;
    shown.current = signals.length;
  }, [signals.length]);

  return (
    <ol ref={listRef} className={styles.list}>
      {signals.map((s) => (
        <li key={s.id} className={styles.row}>
          <span className={styles.time}>{formatClock(s.ts)}</span>
          <SourceTag source={s.ruleId === "ATDE" ? "ai" : "rule"} label={s.ruleId} className={styles.tag} />
          <span className={styles.sentence}>{s.sentence}</span>
          <span className={styles.points}>+{s.points}</span>
        </li>
      ))}
    </ol>
  );
}
