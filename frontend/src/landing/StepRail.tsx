// The rail along the bottom: five labelled bars. A bar fills as the story moves into its step.
import { motion, useTransform, type MotionValue } from "motion/react";
import { STEPS, pad2 } from "./steps";
import styles from "./StepRail.module.css";

function Bar({ t, index }: { t: MotionValue<number>; index: number }) {
  // Step 1's bar is always full; step k's bar fills during the move from step k-1 to step k.
  const fill = useTransform(t, (v) => Math.max(0, Math.min(1, v - index + 1)));
  return (
    <span className={styles.track}>
      <motion.i style={{ scaleX: fill }} />
    </span>
  );
}

export function StepRail({ t, current, built }: { t: MotionValue<number>; current: number; built: number }) {
  return (
    <ol className={styles.rail} aria-hidden="true">
      {STEPS.map((s, i) => (
        <li key={s.n} className={`${i === current ? styles.on : ""} ${i >= built ? styles.later : ""}`}>
          <Bar t={t} index={i} />
          {pad2(s.n)} {s.label}
        </li>
      ))}
    </ol>
  );
}
