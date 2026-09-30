// Landing (/): the 5-step story. Step 1 (INGEST) is built; steps 2 to 5 follow, driven by scroll.
// Minimal by design: NETRA, one line, one button, one caption. Spec: docs/PAGES.md section 4.
import { Link } from "react-router-dom";
import { GlassCard } from "../components/GlassCard";
import { BracketLabel } from "../components/Panel";
import { StepStage } from "../landing/StepStage";
import { STEPS, pad2 } from "../landing/steps";
import styles from "./Landing.module.css";

// Default export so the router can lazy-load it (the globe libraries stay out of the dashboard).
export default function Landing() {
  const current = 0; // step index; scroll will drive this once steps 2 to 5 exist
  const step = STEPS[current];

  return (
    <section className={styles.landing}>
      <div className={styles.copy}>
        <BracketLabel>
          {pad2(step.n)} / {pad2(STEPS.length)}
        </BracketLabel>
        <span className={styles.stepName}>{step.label}</span>

        <h1 className={styles.mark}>
          <img src="/brand/netra-wordmark-cropped.svg" alt="NETRA" />
        </h1>
        <p className={styles.line}>
          Security decisions while the data is <em>still warm.</em>
        </p>

        <Link to="/live" className={styles.cta}>
          OPEN LIVE DASHBOARD
        </Link>

        <GlassCard className={styles.caption}>
          <span className={styles.captionLabel}>
            STEP {pad2(step.n)}, {step.label}
          </span>
          <p>{step.caption}</p>
        </GlassCard>
      </div>

      <div className={styles.stageWrap}>
        <StepStage />
      </div>

      <ol className={styles.counter} aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.n} className={i === current ? styles.on : undefined} aria-current={i === current ? "step" : undefined}>
            {pad2(s.n)}
          </li>
        ))}
      </ol>

      <ol className={styles.rail} aria-hidden="true">
        {STEPS.map((s, i) => (
          <li key={s.n} className={i === current ? styles.on : undefined}>
            <i />
            {pad2(s.n)} {s.label}
          </li>
        ))}
      </ol>
    </section>
  );
}
