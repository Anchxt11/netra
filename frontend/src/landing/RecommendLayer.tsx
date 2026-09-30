// Step 5 (RECOMMEND): the top fix, as the dashboard's own FixCard, with three short callouts saying
// what each part is. As you scroll, APPROVE FIX presses itself and the card turns green-outlined:
// nothing runs until a person approves, and every approval teaches both engines.
// Scroll-driven through `t` (4 = step 5 settled).
import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useTransform, type MotionValue } from "motion/react";
import type { Fix } from "../data/types";
import { FixCard } from "../components/FixCard";
import { CREDENTIAL_STUFFING } from "../data/scenarios/demo";
import { CALLOUTS, CALLOUT_X, FIX_CARD, LEARN_Y, MINI_H, MINI_ROWS } from "./recommendGeometry";
import styles from "./RecommendLayer.module.css";

// The same top fix the dashboard's demo shows: Enable MFA, 0.88, two reasons.
const TOP_FIX: Fix = CREDENTIAL_STUFFING.fixes[0];
const pct = (v: number) => `${(v / 760) * 100}%`;

export function RecommendLayer({ t, still }: { t: MotionValue<number>; still?: boolean }) {
  const layer = useTransform(t, still ? [3.1, 3.3] : [3.48, 3.6], [0, 1]);
  const callouts = useTransform(t, [3.6, 3.68], [0, 1]);
  const learn = useTransform(t, [3.8, 3.88], [0, 1]);
  // The approve button presses itself, then the card settles as approved.
  const [phase, setPhase] = useState<"idle" | "pressing" | "approved">("idle");
  const approvedAt = useRef(Date.now());
  useMotionValueEvent(t, "change", (v) => {
    const next = v >= 3.76 ? "approved" : v >= 3.7 ? "pressing" : "idle";
    if (next === "approved" && phase !== "approved") approvedAt.current = Date.now();
    if (next !== phase) setPhase(next);
  });

  return (
    <motion.div className={styles.layer} style={{ opacity: layer }} aria-hidden="true">
      <div
        className={`${styles.card} ${phase === "pressing" ? styles.pressing : ""}`}
        style={{ left: pct(FIX_CARD.x), top: pct(FIX_CARD.y), width: pct(FIX_CARD.w), height: pct(FIX_CARD.h) }}
        inert
      >
        <FixCard
          fix={TOP_FIX}
          approvedAt={phase === "approved" ? approvedAt.current : undefined}
          onApprove={() => {}}
          onReject={() => {}}
        />
      </div>

      <svg viewBox="0 0 760 760" className={styles.svg}>
        {/* fixes 2 and 3 */}
        {MINI_ROWS.map((r) => (
          <g key={r.rank} className={phase === "approved" ? styles.settled : undefined}>
            <rect x={FIX_CARD.x} y={r.y} width={FIX_CARD.w} height={MINI_H} rx="8" className={styles.mini} />
            <text x={FIX_CARD.x + 14} y={r.y + 19.5} className={styles.miniRank}>
              {r.rank}
            </text>
            <text x={FIX_CARD.x + 34} y={r.y + 19.5} className={styles.miniName}>
              {r.name.toUpperCase()}
            </text>
            <text x={FIX_CARD.x + FIX_CARD.w - 14} y={r.y + 19.5} className={styles.miniConfidence}>
              {r.confidence.toFixed(2)}
            </text>
          </g>
        ))}

        {/* what each part of the card means */}
        <motion.g style={{ opacity: callouts }}>
          {CALLOUTS.map((c) => (
            <g key={c.text}>
              <line x1={FIX_CARD.x + FIX_CARD.w + 6} y1={c.y} x2={CALLOUT_X - 6} y2={c.y} className={styles.leader} />
              <circle cx={FIX_CARD.x + FIX_CARD.w + 6} cy={c.y} r="2" className={styles.leaderDot} />
              <text x={CALLOUT_X} y={c.y + 4.5} className={styles.callout}>
                {c.text}
              </text>
            </g>
          ))}
        </motion.g>

        <motion.text x={FIX_CARD.x} y={LEARN_Y} className={styles.learn} style={{ opacity: learn }}>
          Every approval is saved and teaches both engines.
        </motion.text>
      </svg>
    </motion.div>
  );
}
