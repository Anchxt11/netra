// HOW IT ESCALATED as a step chart: attention climbs one step per signal, each step labelled with
// its points and a short reason. Hover or focus a step for the full sentence; "List" shows them all.
import { useState } from "react";
import type { Signal } from "../data/types";
import { formatClock } from "../lib/time";
import { EscalationList } from "./EscalationList";
import styles from "./EscalationChart.module.css";

const isAi = (s: Signal) => s.ruleId === "ATDE";

/** The first words of a sentence, cut at a word boundary. */
function short(sentence: string, max = 26): string {
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 12))}…`;
}

export function EscalationChart({ signals }: { signals: Signal[] }) {
  const [focus, setFocus] = useState<number | null>(null);
  const [list, setList] = useState(false);

  let total = 0;
  const steps = signals.map((s) => {
    const from = total;
    total = Math.min(100, total + s.points);
    return { s, from, to: total };
  });
  const n = Math.max(1, steps.length);
  const shown = focus !== null ? steps[focus]?.s : steps[steps.length - 1]?.s;

  return (
    <div className={styles.wrap} data-tour="escalation">
      <div className={styles.head}>
        <span className={styles.title}>How it escalated</span>
        <span className={styles.meta}>
          {signals.length} {signals.length === 1 ? "signal" : "signals"}
        </span>
        <button type="button" className={styles.toggle} onClick={() => setList((v) => !v)} aria-pressed={list}>
          {list ? "Chart" : "List"}
        </button>
      </div>

      {list ? (
        <div className={styles.list}>
          <EscalationList signals={signals} />
        </div>
      ) : (
        <>
          <div className={styles.chart} role="list" aria-label="Attention climbing, one step per signal">
            <i className={styles.mark} style={{ bottom: `${30 * 0.82}%` }} aria-hidden="true" />
            <i className={styles.mark} style={{ bottom: `${60 * 0.82}%` }} aria-hidden="true" />
            {steps.map(({ s, from, to }, i) => {
              const left = (i / n) * 100;
              const width = 100 / n;
              const tone = isAi(s) ? styles.ai : to >= 60 ? styles.hot : to >= 30 ? styles.warm : styles.cool;
              return (
                <div key={s.id} role="listitem">
                  <i className={styles.riser} style={{ left: `${left}%`, bottom: `${from * 0.82}%`, height: `${(to - from) * 0.82}%` }} aria-hidden="true" />
                  <i className={`${styles.step} ${tone}`} style={{ left: `${left}%`, width: `calc(${width}% - 4px)`, bottom: `${to * 0.82}%` }} aria-hidden="true" />
                  <button
                    type="button"
                    className={`${styles.label} ${focus === i ? styles.active : ""}`}
                    style={{ left: `${left}%`, width: `${width}%`, bottom: `calc(${to * 0.82}% + 6px)` }}
                    onMouseEnter={() => setFocus(i)}
                    onMouseLeave={() => setFocus(null)}
                    onFocus={() => setFocus(i)}
                    onBlur={() => setFocus(null)}
                    aria-label={`${s.ruleId}, plus ${s.points}: ${s.sentence}`}
                  >
                    <span className={`${styles.points} ${isAi(s) ? styles.aiText : ""}`}>+{s.points}</span>
                    <span className={styles.reason}>{isAi(s) ? "AI engine" : short(s.sentence)}</span>
                  </button>
                </div>
              );
            })}
          </div>
          {shown && (
            <p className={styles.caption} aria-live="polite">
              <span className={styles.time}>{formatClock(shown.ts)}</span>
              <span className={isAi(shown) ? styles.aiText : styles.code}>{shown.ruleId}</span>
              <span className={styles.sentence}>{shown.sentence}</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
