// The live dashboard's entrance on the home page, played once: a rust scan line sweeps down and
// the dashboard powers on behind it, coming into focus. Afterwards the wrapper clears its clip and
// filter (so nothing left behind can trap the dashboard's fixed overlays) without remounting the
// dashboard. Reduced motion: none.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import styles from "./ScanReveal.module.css";

const EASE = [0.65, 0, 0.35, 1] as const;
const DURATION = 1.3;
const VIEWPORT = { once: true, amount: 0.25 } as const;

export function ScanReveal({ children }: { children: ReactNode }) {
  const still = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  const [entered, setEntered] = useState(false);

  const finish = () => {
    const el = ref.current;
    if (el) {
      el.style.clipPath = "none";
      el.style.filter = "none";
    }
    setDone(true);
  };

  // Backstop: if the animation never completes (a paused or throttled tab), show the dashboard anyway.
  useEffect(() => {
    if (!entered || done) return;
    const t = window.setTimeout(finish, (DURATION + 1.7) * 1000);
    return () => window.clearTimeout(t);
  }, [entered, done]);

  if (still) return <div className={styles.wrap}>{children}</div>;

  return (
    <motion.div
      ref={ref}
      className={styles.wrap}
      initial={{ clipPath: "inset(0% 0% 100% 0%)", filter: "blur(6px) brightness(1.6)" }}
      whileInView={{ clipPath: "inset(0% 0% 0% 0%)", filter: "blur(0px) brightness(1)" }}
      viewport={VIEWPORT}
      transition={{ duration: DURATION, ease: EASE, filter: { duration: DURATION + 0.3, ease: "easeOut" } }}
      onViewportEnter={() => setEntered(true)}
      onAnimationComplete={finish}
    >
      {children}
      {!done && (
        <motion.i
          className={styles.line}
          aria-hidden="true"
          initial={{ top: "0%", opacity: 1 }}
          whileInView={{ top: "100%", opacity: [1, 1, 0] }}
          viewport={VIEWPORT}
          transition={{ duration: DURATION, ease: EASE, opacity: { duration: DURATION, times: [0, 0.85, 1] } }}
        />
      )}
    </motion.div>
  );
}
