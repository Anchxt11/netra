// The live dashboard's entrance on the home page, played once: a rust scan line sweeps down and
// the dashboard powers on behind it, coming into focus. Afterwards the wrapper clears its clip and
// filter (so nothing left behind can trap the dashboard's fixed overlays) without remounting the
// dashboard. Reduced motion: none.
//
// "In view" is measured on the outer box, which is never clipped: a fully clipped element can read
// as invisible to the browser and would never start its own reveal.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import styles from "./ScanReveal.module.css";

const EASE = [0.65, 0, 0.35, 1] as const;
const DURATION = 1.3;
const HIDDEN = { clipPath: "inset(0% 0% 100% 0%)", filter: "blur(6px) brightness(1.6)" };
const SHOWN = { clipPath: "inset(0% 0% 0% 0%)", filter: "blur(0px) brightness(1)" };

export function ScanReveal({ children }: { children: ReactNode }) {
  const still = useReducedMotion() ?? false;
  const outer = useRef<HTMLDivElement>(null);
  const inView = useInView(outer, { once: true, amount: 0.15 });
  const [done, setDone] = useState(false);

  const finish = () => setDone(true);

  // Backstop: if the animation never completes (a paused or throttled tab), show the dashboard anyway.
  useEffect(() => {
    if (!inView || done) return;
    const t = window.setTimeout(finish, (DURATION + 1.7) * 1000);
    return () => window.clearTimeout(t);
  }, [inView, done]);

  if (still) return <div className={styles.wrap}>{children}</div>;

  return (
    <div ref={outer}>
      <motion.div
        className={`${styles.wrap} ${done ? styles.done : ""}`}
        initial={HIDDEN}
        animate={inView ? SHOWN : HIDDEN}
        transition={{ duration: DURATION, ease: EASE, filter: { duration: DURATION + 0.3, ease: "easeOut" } }}
        onAnimationComplete={() => inView && finish()}
      >
        {children}
        {!done && (
          <motion.i
            className={styles.line}
            aria-hidden="true"
            initial={{ top: "0%", opacity: 1 }}
            animate={inView ? { top: "100%", opacity: [1, 1, 0] } : { top: "0%", opacity: 1 }}
            transition={{ duration: DURATION, ease: EASE, opacity: { duration: DURATION, times: [0, 0.85, 1] } }}
          />
        )}
      </motion.div>
    </div>
  );
}
