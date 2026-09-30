// The landing stage. Layers change with scroll (`t`, in steps: 0 = step 1, 1 = step 2 ...).
// Step 1 to 2: the globe settles, its land pixels break apart and rearrange into the network
// drawing, then the crisp drawing takes over. Four live readouts stay in the corners throughout.
import { motion, useTransform, type MotionValue } from "motion/react";
import { NumText } from "../components/NumText";
import { RULES } from "../data/catalog";
import { useNetra } from "../store/useNetra";
import { Globe } from "./Globe";
import { GlobeHud } from "./GlobeHud";
import { NetworkIso } from "./NetworkIso";
import { CorrelateLayer } from "./CorrelateLayer";
import { PixelMorph } from "./PixelMorph";
import { PrioritiseLayer } from "./PrioritiseLayer";
import { correlatePoints } from "./correlateGeometry";
import { prioritisePoints } from "./prioritiseGeometry";
import styles from "./StepStage.module.css";

const RULE_COUNT = Object.keys(RULES).length;

function Readout({ label, value, pos, tone }: { label: string; value: string; pos: string; tone?: "ok" | "muted" }) {
  return (
    <div className={`${styles.readout} ${styles[pos]}`}>
      <span className={styles.label}>{label}</span>
      <NumText value={value} size="m" className={tone ? styles[tone] : styles.value} />
    </div>
  );
}

interface Props {
  t: MotionValue<number>;
  /** Reduced motion: a plain crossfade instead of the pixel break-apart. */
  still?: boolean;
}

export function StepStage({ t, still }: Props) {
  const eps = useNetra((s) => s.health?.eventsPerSec);
  const today = useNetra((s) => s.health?.eventsToday);
  const atde = useNetra((s) => s.health?.models.find((m) => m.name === "ATDE"));
  const atdeText = !atde ? "PENDING" : atde.status !== "ready" ? atde.status.toUpperCase() : atde.version === "example" ? "EXAMPLE" : "READY";

  const sway = useTransform(t, [0, 0.08], [1, 0]);
  const morph = useTransform(t, [0.1, 0.52], [0, 1]);
  const hudOpacity = useTransform(t, [0.08, 0.24], [1, 0]);
  // With reduced motion the globe simply fades; otherwise its pixels become the drawing, then hand over.
  const canvasOpacity = useTransform(t, still ? [0.3, 0.5] : [0.54, 0.64], [1, 0]);
  // Step 3 to 4: the same break-apart, from the correlation drawing to the ring and queue.
  const morph34 = useTransform(t, [2.1, 2.5], [0, 1]);
  const morph34Visible = useTransform(t, [2.03, 2.08, 2.54, 2.64], [0, 1, 1, 0]);

  return (
    <div className={styles.stage}>
      <motion.div className={styles.layer} style={{ opacity: canvasOpacity }}>
        <Globe sway={sway} morph={still ? undefined : morph} visible={canvasOpacity} />
      </motion.div>
      <motion.div className={styles.layer} style={{ opacity: hudOpacity }}>
        <GlobeHud />
      </motion.div>

      <NetworkIso t={t} />
      <CorrelateLayer t={t} />

      {/* Step 3 to 4: the drawing breaks into pixels that re-form as the ring and the queue. */}
      {!still && (
        <motion.div className={styles.layer} style={{ opacity: morph34Visible }}>
          <PixelMorph from={correlatePoints} to={prioritisePoints} progress={morph34} visible={morph34Visible} />
        </motion.div>
      )}
      <PrioritiseLayer t={t} still={still} />

      <Readout label="EVENTS / S" value={eps !== undefined ? String(eps) : "PENDING"} pos="tl" />
      <Readout label="EVENTS TODAY" value={today !== undefined ? today.toLocaleString("en-GB") : "PENDING"} pos="tr" />
      <Readout label="DETECTION RULES" value={String(RULE_COUNT)} pos="bl" />
      <Readout label="ATDE MODEL" value={atdeText} pos="br" tone={atdeText === "READY" ? "ok" : "muted"} />
    </div>
  );
}
