// Landing (/): a scroll story. The stage stays pinned while scrolling moves through the steps.
// Minimal by design: NETRA, one line, one button; then, per step, a title, one sentence and a
// tiny colour key. Spec: docs/PAGES.md section 4.
import { useRef, useState, type CSSProperties } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { Link } from "react-router-dom";
import { GlassCard } from "../components/GlassCard";
import { StepRail } from "../landing/StepRail";
import { StepStage } from "../landing/StepStage";
import { DASHBOARD_ANCHOR, DashboardSection } from "../landing/DashboardSection";
import { STEPS, pad2, type KeySwatch } from "../landing/steps";
import styles from "./Landing.module.css";

// Steps built so far. The scroll only reaches these, so the story never shows an empty step.
const BUILT_STEPS = 5;
// Scroll distance per step, in viewport heights: enough room for each step to settle.
const PER_STEP_VH = 120;

const SWATCH: Record<KeySwatch, CSSProperties> = {
  heat: { background: "var(--heat-1)" },
  cold: { background: "var(--heat-4)" },
  rule: { background: "var(--rule)" },
  ai: { background: "var(--ai)" },
  rust: { background: "var(--rust)" },
  ring: { border: "1.5px solid var(--rust)", borderRadius: "50%" },
  ok: { background: "var(--ok)" },
};

// Default export so the router can lazy-load it (the globe libraries stay out of the dashboard).
export default function Landing() {
  const scrollRef = useRef<HTMLElement>(null);
  const still = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll({ target: scrollRef, offset: ["start start", "end end"] });
  // A spring between the wheel and the story: each notch glides instead of jumping.
  const smooth = useSpring(scrollYProgress, { stiffness: 70, damping: 20, mass: 0.6, restDelta: 0.0001 });
  // t runs 0 (step 1) to BUILT_STEPS - 1 (last built step); fractions are the moves between steps.
  const t = useTransform(still ? scrollYProgress : smooth, [0, 1], [0, BUILT_STEPS - 1]);
  const [current, setCurrent] = useState(0);
  useMotionValueEvent(t, "change", (v) => setCurrent(Math.min(BUILT_STEPS - 1, Math.round(v))));

  // Step 1's hero gives way as the globe starts to break apart; the step card takes its place.
  const heroOpacity = useTransform(t, [0.02, 0.2], [1, 0]);
  const heroY = useTransform(t, [0.02, 0.2], still ? [0, 0] : [0, -20]);
  const cardOpacity = useTransform(t, [0.3, 0.46], [0, 1]);
  const cardY = useTransform(t, [0.3, 0.46], still ? [0, 0] : [16, 0]);
  const cardStep = STEPS[Math.max(1, current)];
  // Step 5: once the fix is approved, the final call to action appears in the step card.
  const finalCta = useTransform(t, [3.84, 3.92], [0, 1]);
  const [ctaLive, setCtaLive] = useState(false);
  useMotionValueEvent(finalCta, "change", (v) => setCtaLive(v > 0.5));

  return (
    <>
    <section ref={scrollRef} className={styles.scroller} style={{ height: `calc(100vh + ${(BUILT_STEPS - 1) * PER_STEP_VH}vh)` }}>
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
            <GlassCard className={styles.caption}>
              <span className={styles.captionLabel}>STEP 01, {STEPS[0].label}</span>
              <p>{STEPS[0].caption}</p>
            </GlassCard>
          </motion.div>

          {/* Steps 2 to 5: what this step shows, in one sentence, and how to read the drawing. */}
          <motion.div className={styles.stepCardWrap} style={{ opacity: cardOpacity, y: cardY }} aria-hidden={current === 0}>
            <GlassCard className={styles.stepCard}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={cardStep.n}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  aria-live="polite"
                >
                  <span className={styles.captionLabel}>STEP {pad2(cardStep.n)}</span>
                  <h2 className={styles.stepTitle}>{cardStep.label}</h2>
                  <p className={styles.stepText}>{cardStep.caption}</p>
                  {cardStep.key && (
                    <ul className={styles.key}>
                      {cardStep.key.map((k) => (
                        <li key={k.text}>
                          <i style={SWATCH[k.swatch]} aria-hidden="true" />
                          {k.text}
                        </li>
                      ))}
                    </ul>
                  )}
                  {cardStep.n === STEPS.length && (
                    <motion.div style={{ opacity: finalCta, pointerEvents: ctaLive ? "auto" : "none" }}>
                      {/* The live dashboard is right below the story: this glides down to it. */}
                      <a
                        href={`#${DASHBOARD_ANCHOR}`}
                        className={`${styles.cta} ${styles.finalCta}`}
                        tabIndex={ctaLive ? 0 : -1}
                        onClick={(e) => {
                          e.preventDefault();
                          document.getElementById(DASHBOARD_ANCHOR)?.scrollIntoView({ behavior: still ? "auto" : "smooth" });
                        }}
                      >
                        SEE IT LIVE
                      </a>
                    </motion.div>
                  )}
                </motion.div>
              </AnimatePresence>
            </GlassCard>
          </motion.div>
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

    {/* After the story: the real thing. */}
    <DashboardSection />

    {/* Closing band, at the very end. */}
    <footer className={styles.band}>Built on Microsoft Azure, ONNX Runtime and LightGBM from Microsoft Research.</footer>
    </>
  );
}
