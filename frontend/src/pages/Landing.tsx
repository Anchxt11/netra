// Landing (/): a scroll story. The stage stays pinned while scrolling moves through the steps.
// Minimal by design: NETRA, one line, one button, one caption per step. Spec: docs/PAGES.md section 4.
import { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Link } from "react-router-dom";
import { GlassCard } from "../components/GlassCard";
import { StepRail } from "../landing/StepRail";
import { StepStage } from "../landing/StepStage";
import { STEPS, pad2 } from "../landing/steps";
import styles from "./Landing.module.css";

// Steps built so far. The scroll only reaches these, so the story never shows an empty step.
const BUILT_STEPS = 2;

// Default export so the router can lazy-load it (the globe libraries stay out of the dashboard).
export default function Landing() {
  const scrollRef = useRef<HTMLElement>(null);
  const still = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll({ target: scrollRef, offset: ["start start", "end end"] });
  // t runs 0 (step 1) to BUILT_STEPS - 1 (last built step); fractions are the transitions between.
  const t = useTransform(scrollYProgress, [0, 1], [0, BUILT_STEPS - 1]);
  const [current, setCurrent] = useState(0);
  useMotionValueEvent(t, "change", (v) => setCurrent(Math.min(BUILT_STEPS - 1, Math.round(v))));

  // Step 1's hero (NETRA, the line, the button) gives way as the dive begins.
  const heroOpacity = useTransform(t, [0, 0.22], [1, 0]);
  const heroY = useTransform(t, [0, 0.22], still ? [0, 0] : [0, -24]);
  const step = STEPS[current];

  return (
    <section ref={scrollRef} className={styles.scroller} style={{ height: `${BUILT_STEPS * 100}vh` }}>
      <div className={styles.landing}>
        <div className={styles.copy}>
          <motion.div
            className={styles.hero}
            style={{ opacity: heroOpacity, y: heroY, pointerEvents: current === 0 ? "auto" : "none" }}
            aria-hidden={current !== 0}
          >
            <h1 className={styles.mark}>
              <img src="/brand/netra-wordmark-cropped.svg" alt="NETRA" />
            </h1>
            <p className={styles.line}>
              Security decisions while the data is <em>still warm.</em>
            </p>
            <Link to="/live" className={styles.cta} tabIndex={current === 0 ? 0 : -1}>
              OPEN LIVE DASHBOARD
            </Link>
          </motion.div>

          <GlassCard className={styles.caption}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step.n}
                initial={{ opacity: 0, y: still ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                aria-live="polite"
              >
                <span className={styles.captionLabel}>
                  STEP {pad2(step.n)}, {step.label}
                </span>
                <p>{step.caption}</p>
              </motion.div>
            </AnimatePresence>
          </GlassCard>
        </div>

        <div className={styles.stageWrap}>
          <StepStage t={t} still={still} />
        </div>

        <ol className={styles.counter} aria-label="Steps">
          {STEPS.map((s, i) => (
            <li
              key={s.n}
              className={`${i === current ? styles.on : ""} ${i >= BUILT_STEPS ? styles.later : ""}`}
              aria-current={i === current ? "step" : undefined}
            >
              {pad2(s.n)}
            </li>
          ))}
        </ol>

        <StepRail t={t} current={current} built={BUILT_STEPS} />
      </div>
    </section>
  );
}
