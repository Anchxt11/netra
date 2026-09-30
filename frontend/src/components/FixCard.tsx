import type { Fix } from "../data/types";
import { formatClock } from "../lib/time";
import { Button } from "./Button";
import { GlassCard } from "./GlassCard";
import { NumText } from "./NumText";
import styles from "./FixCard.module.css";

const SIZE = 38;
const R = 15;
const CIRC = 2 * Math.PI * R;
const BAR_FULL = 0.32; // a contribution this large fills the reason bar

/** CRIE's confidence in this fix: a cyan ring, because an ML model produced it. */
function ConfidenceRing({ value }: { value: number }) {
  return (
    <span className={styles.ring} role="img" aria-label={`Confidence ${value.toFixed(2)}`}>
      <svg width={SIZE} height={SIZE} aria-hidden="true">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke="var(--unlit)" strokeWidth="3.5" fill="none" />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke="var(--ai)"
          strokeWidth="3.5"
          fill="none"
          strokeDasharray={`${value * CIRC} ${CIRC}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          strokeLinecap="round"
        />
      </svg>
      <span className={styles.ringValue} aria-hidden="true">
        {value.toFixed(2)}
      </span>
    </span>
  );
}

interface Props {
  fix: Fix;
  /** Set once this fix was approved: the card turns green-outlined. */
  approvedAt?: number;
  /** Another fix on this incident was approved: this card is settled. */
  locked?: boolean;
  onApprove: () => void;
  onReject: () => void;
}

export function FixCard({ fix, approvedAt, locked, onApprove, onReject }: Props) {
  const d3fend = fix.d3fend.name || "PENDING";
  const cls = [styles.card, approvedAt !== undefined && styles.approved, locked && styles.locked].filter(Boolean).join(" ");

  return (
    <GlassCard className={cls}>
      <article className={styles.inner} aria-label={`Fix ${fix.rank}: ${fix.name}`}>
        <header className={styles.head}>
          <span className={`${styles.rank} ${fix.rank === 1 ? styles.rankFirst : ""}`} aria-label={`Rank ${fix.rank}`}>
            <NumText value={fix.rank} size="s" />
          </span>
          <div className={styles.title}>
            <h3 className={styles.name}>{fix.name}</h3>
            <p className={styles.d3fend} title={`D3FEND: ${d3fend}`}>
              D3FEND: {d3fend}
            </p>
          </div>
          <ConfidenceRing value={fix.confidence} />
        </header>

        <p className={styles.why}>WHY THE AI PICKED IT</p>
        <ul className={styles.reasons}>
          {fix.reasons.slice(0, 2).map((r) => {
            const width = Math.max(0.06, Math.min(1, Math.abs(r.contribution) / BAR_FULL)) * 100;
            const sign = r.contribution >= 0 ? "+" : "−";
            return (
              <li key={r.feature}>
                <span className={styles.sentence}>{r.sentence}</span>
                <span className={styles.bar}>
                  <i className={r.contribution < 0 ? styles.negative : undefined} style={{ width: `${width}%` }} />
                  <span className={styles.contrib}>
                    {sign}
                    {Math.abs(r.contribution).toFixed(2)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        <footer className={styles.actions}>
          {approvedAt !== undefined ? (
            <p className={styles.approvedAt} role="status">
              APPROVED {formatClock(approvedAt)}
            </p>
          ) : (
            <>
              <Button variant="approve" className={styles.approve} onClick={onApprove} disabled={locked}>
                APPROVE FIX
              </Button>
              <Button variant="reject" className={styles.reject} onClick={onReject} disabled={locked}>
                REJECT
              </Button>
            </>
          )}
        </footer>
      </article>
    </GlassCard>
  );
}
