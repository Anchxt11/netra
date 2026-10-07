// Landing (/), v2: a calm product page (DESIGN.md v2, PAGES.md section 4).
// Hero with the cooling-words line and the dotted globe; then the ONE particle moment: on scroll the
// globe's dots break apart and re-form as the NETRA eye. Then how it works (hover-alive cards),
// why NETRA, enterprise and the live dashboard, each easing in quietly as it scrolls into view.
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { Globe } from "../landing/Globe";
import { CoolingWords } from "../landing/CoolingWords";
import { HowItWorks } from "../landing/HowItWorks";
import { loadMarkTargets } from "../landing/markTargets";
import { Reveal } from "../landing/Reveal";
import type { TargetPoint } from "../landing/Globe";
import { DASHBOARD_ANCHOR, DashboardSection } from "../landing/DashboardSection";
import styles from "./Landing.module.css";

const WHY = [
  ["Ranked by time left", "Severity alone ignores the clock. Every incident carries a deadline."],
  ["Rules and AI, side by side", "Each warning sign says which engine found it and what it added."],
  ["Every score explained", "Risk is severity times attention times urgency, shown, never hidden."],
  ["A person approves", "Fixes come from a fixed list of 14 actions. Nothing runs on its own."],
  ["Freshness you can see", "A live meter shows how old the data on screen is, against a written target."],
  ["Noise becomes incidents", "Hundreds of alerts from one attack arrive as one story with one deadline."],
];

/** Glides to the live dashboard at the end of the page. */
function toDashboard(e: React.MouseEvent, smooth: boolean) {
  e.preventDefault();
  document.getElementById(DASHBOARD_ANCHOR)?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
}

// Default export so the router can lazy-load it (the globe libraries stay out of the dashboard).
export default function Landing() {
  const heroRef = useRef<HTMLElement>(null);
  const still = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end end"] });
  const p = useSpring(scrollYProgress, { stiffness: 80, damping: 22, mass: 0.6, restDelta: 0.0001 });
  const [markTargets, setMarkTargets] = useState<(() => TargetPoint[]) | undefined>(undefined);
  useEffect(() => {
    loadMarkTargets().then((fn) => setMarkTargets(() => fn), () => {});
  }, []);

  // The hero copy gives way; the globe stops swaying, glides to the centre, breaks apart and
  // re-forms as the NETRA eye; the wordmark then appears under it.
  const copyOpacity = useTransform(p, [0.04, 0.22], [1, 0]);
  const copyY = useTransform(p, [0.04, 0.22], [0, -24]);
  const sway = useTransform(p, [0, 0.12], [1, 0]);
  const stageX = useTransform(p, [0.08, 0.45], ["24vw", "0vw"]);
  const morph = useTransform(p, [0.24, 0.7], [0, 1]);
  const wordOpacity = useTransform(p, [0.72, 0.86], [0, 1]);
  const wordY = useTransform(p, [0.72, 0.86], [12, 0]);
  const ribbonOpacity = useTransform(p, [0, 0.4], [0.32, 0.1]);

  return (
    <>
      <section ref={heroRef} className={`${styles.heroScroll} ${still ? styles.static : ""}`}>
        <div className={styles.sticky}>
          <motion.div className={styles.ribbon} style={still ? undefined : { opacity: ribbonOpacity }} aria-hidden="true" />
          <motion.div className={styles.copy} style={still ? undefined : { opacity: copyOpacity, y: copyY }}>
            <h1 className={styles.headline}>
              Security decisions while the data is <em>still warm.</em>
            </h1>
            <CoolingWords />
            <div className={styles.actions}>
              <a href={`#${DASHBOARD_ANCHOR}`} className={styles.primary} onClick={(e) => toDashboard(e, !still)}>
                See it live
              </a>
              <a href="#how" className={styles.ghost}>
                How it works
              </a>
            </div>
          </motion.div>

          <motion.div className={styles.stage} style={still ? undefined : { x: stageX }}>
            <div className={styles.globeLayer}>
              <Globe sway={sway} morph={morph} targets={markTargets} />
            </div>
          </motion.div>

          {!still && (
            <motion.p className={styles.markWord} style={{ opacity: wordOpacity, y: wordY }} aria-hidden="true">
              NETRA
            </motion.p>
          )}
        </div>
      </section>

      <section id="how" className={styles.section}>
        <Reveal className={styles.intro}>
          <span className={styles.eyebrow}>How it works</span>
          <h2 className={styles.h2}>From a flood of events to the one that matters.</h2>
          <p className={styles.sub}>Five steps. Hover a card and its drawing comes alive.</p>
        </Reveal>
        <Reveal kind="settle" delay={0.1}>
          <HowItWorks />
        </Reveal>
      </section>

      <section id="why" className={styles.section}>
        <Reveal className={styles.intro}>
          <span className={styles.eyebrow}>Why NETRA</span>
          <h2 className={styles.h2}>Most dashboards show you alerts. NETRA tells you which one first, and why.</h2>
        </Reveal>
        <Reveal kind="soften" delay={0.1} className={styles.why}>
          {WHY.map(([title, text]) => (
            <div key={title} className={styles.whyCell}>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </Reveal>
      </section>

      <section id="enterprise" className={styles.section}>
        <Reveal className={styles.intro}>
          <span className={styles.eyebrow}>Enterprise</span>
          <h2 className={styles.h2}>Built to the brief's enterprise bar, and measured.</h2>
        </Reveal>
        <div className={styles.enterprise}>
          <Reveal kind="slide" delay={0.00} className={styles.entCard}>
            <span className={styles.entLabel}>Freshness SLA</span>
            <span className={styles.entBig}>
              5<span> s p95</span>
            </span>
            <p>The target from an event happening to it showing on screen, measured at every hop.</p>
          </Reveal>
          <Reveal kind="slide" delay={0.08} className={styles.entCard}>
            <span className={styles.entLabel}>Concurrent load</span>
            <span className={styles.entBig}>
              10<span>×</span>
            </span>
            <p>Normal traffic with many dashboards open. Results: PENDING until the load test runs.</p>
          </Reveal>
          <Reveal kind="slide" delay={0.16} className={styles.entCard}>
            <span className={styles.entLabel}>Failure alerting</span>
            <span className={styles.entText}>Scheduled jobs that tell you when they fail</span>
            <p>A stalled feed, a slow pipeline or a failed job shows on screen in red, with words.</p>
          </Reveal>
          <Reveal kind="slide" delay={0.24} className={styles.entCard}>
            <span className={styles.entLabel}>Roles and audit</span>
            <span className={styles.entText}>Analyst and admin sign-in, every decision logged</span>
            <p>On the live backend, nothing runs without a named person approving it.</p>
          </Reveal>
        </div>
      </section>

      <Reveal kind="settle">
        <DashboardSection />
      </Reveal>

      <footer className={styles.band}>
        <span className={styles.wordmark}>NETRA</span>
        <span>Microsoft Innovate 2026, Problem 34 · Simulated feed on this site</span>
      </footer>
    </>
  );
}
