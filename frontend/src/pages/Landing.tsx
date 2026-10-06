// Landing (/), v2: a calm product page (DESIGN.md v2, PAGES.md section 4).
// Hero with the cooling-words line and the dotted globe; then the ONE particle moment: on scroll the
// globe's dots break apart and re-form as the dashboard, and the live product shot takes over.
// Then how it works (hover-alive cards), why NETRA, enterprise, and the live dashboard itself.
import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { Globe } from "../landing/Globe";
import { CoolingWords } from "../landing/CoolingWords";
import { HowItWorks } from "../landing/HowItWorks";
import { ProductShot } from "../landing/ProductShot";
import { SHOT, dashboardOutline } from "../landing/dashboardOutline";
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

  // The hero copy gives way; the globe stops swaying, glides to the centre, breaks apart and
  // re-forms as the dashboard; the live product shot then appears exactly over the dots.
  const copyOpacity = useTransform(p, [0.04, 0.22], [1, 0]);
  const copyY = useTransform(p, [0.04, 0.22], [0, -24]);
  const sway = useTransform(p, [0, 0.12], [1, 0]);
  const stageX = useTransform(p, [0.08, 0.45], ["24vw", "0vw"]);
  const morph = useTransform(p, [0.24, 0.7], [0, 1]);
  const globeVisible = useTransform(p, [0.8, 0.9], [1, 0]);
  const shotOpacity = useTransform(p, [0.74, 0.88], [0, 1]);
  const ribbonOpacity = useTransform(p, [0, 0.4], [0.32, 0.1]);

  return (
    <>
      <section ref={heroRef} className={`${styles.heroScroll} ${still ? styles.static : ""}`}>
        <div className={styles.sticky}>
          <motion.div className={styles.ribbon} style={still ? undefined : { opacity: ribbonOpacity }} aria-hidden="true" />
          <motion.div className={styles.copy} style={still ? undefined : { opacity: copyOpacity, y: copyY }}>
            <span className={styles.kicker}>
              <i aria-hidden="true" />
              Real-time security risk, ranked by the time left to act
            </span>
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
            <motion.div className={styles.globeLayer} style={still ? undefined : { opacity: globeVisible }}>
              <Globe sway={sway} morph={morph} visible={globeVisible} targets={dashboardOutline} />
            </motion.div>
            {!still && (
              <motion.div
                className={styles.shot}
                style={{
                  opacity: shotOpacity,
                  left: `${(SHOT.x / 760) * 100}%`,
                  top: `${(SHOT.y / 760) * 100}%`,
                  width: `${(SHOT.w / 760) * 100}%`,
                }}
              >
                <ProductShot />
              </motion.div>
            )}
          </motion.div>

          {!still && (
            <motion.p className={styles.shotCaption} style={{ opacity: shotOpacity }}>
              The live dashboard, running below on a simulated feed.
            </motion.p>
          )}
        </div>
      </section>

      {still && (
        <section className={styles.section}>
          <ProductShot />
        </section>
      )}

      <section id="how" className={styles.section}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>How it works</span>
          <h2 className={styles.h2}>From a flood of events to the one that matters.</h2>
          <p className={styles.sub}>Five steps. Hover a card and its drawing comes alive.</p>
        </div>
        <HowItWorks />
      </section>

      <section id="why" className={styles.section}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>Why NETRA</span>
          <h2 className={styles.h2}>Most dashboards show you alerts. NETRA tells you which one first, and why.</h2>
        </div>
        <div className={styles.why}>
          {WHY.map(([title, text]) => (
            <div key={title} className={styles.whyCell}>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="enterprise" className={styles.section}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>Enterprise</span>
          <h2 className={styles.h2}>Built to the brief's enterprise bar, and measured.</h2>
        </div>
        <div className={styles.enterprise}>
          <div className={styles.entCard}>
            <span className={styles.entLabel}>Freshness SLA</span>
            <span className={styles.entBig}>
              5<span> s p95</span>
            </span>
            <p>The target from an event happening to it showing on screen, measured at every hop.</p>
          </div>
          <div className={styles.entCard}>
            <span className={styles.entLabel}>Concurrent load</span>
            <span className={styles.entBig}>
              10<span>×</span>
            </span>
            <p>Normal traffic with many dashboards open. Results: PENDING until the load test runs.</p>
          </div>
          <div className={styles.entCard}>
            <span className={styles.entLabel}>Failure alerting</span>
            <span className={styles.entText}>Scheduled jobs that tell you when they fail</span>
            <p>A stalled feed, a slow pipeline or a failed job shows on screen in red, with words.</p>
          </div>
          <div className={styles.entCard}>
            <span className={styles.entLabel}>Roles and audit</span>
            <span className={styles.entText}>Analyst and admin sign-in, every decision logged</span>
            <p>On the live backend, nothing runs without a named person approving it.</p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.cta}>
          <h2 className={styles.ctaTitle}>Watch the data cool.</h2>
          <p className={styles.sub}>The live dashboard runs right below, on a simulated feed.</p>
          <a href={`#${DASHBOARD_ANCHOR}`} className={styles.primary} onClick={(e) => toDashboard(e, !still)}>
            Open the live dashboard
          </a>
        </div>
      </section>

      <DashboardSection />

      <footer className={styles.band}>
        <span className={styles.wordmark}>NETRA</span>
        <span>Microsoft Innovate 2026, Problem 34 · Simulated feed on this site</span>
      </footer>
    </>
  );
}
