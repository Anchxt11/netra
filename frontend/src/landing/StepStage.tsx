// The landing stage. Layers change with scroll (`t`, in steps: 0 = step 1, 1 = step 2 ...):
// the globe (step 1) dives into YOUR NETWORK and hands over to the isometric network (step 2).
// Four live readouts from the store stay in the corners throughout.
import { motion, useTransform, type MotionValue } from "motion/react";
import { NumText } from "../components/NumText";
import { RULES } from "../data/catalog";
import { useNetra } from "../store/useNetra";
import { Globe } from "./Globe";
import { GlobeHud } from "./GlobeHud";
import { NetworkIso } from "./NetworkIso";
import { targetOnStage } from "./globeData";
import styles from "./StepStage.module.css";

const RULE_COUNT = Object.keys(RULES).length;
const TARGET_AT = targetOnStage();

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
  /** Reduced motion: crossfades only, no zoom. */
  still?: boolean;
}

export function StepStage({ t, still }: Props) {
  const eps = useNetra((s) => s.health?.eventsPerSec);
  const today = useNetra((s) => s.health?.eventsToday);
  const atde = useNetra((s) => s.health?.models.find((m) => m.name === "ATDE"));
  const atdeText = !atde ? "PENDING" : atde.status !== "ready" ? atde.status.toUpperCase() : atde.version === "example" ? "EXAMPLE" : "READY";

  // Step 1 to 2: the sway settles, then the globe dives into the target and fades.
  const sway = useTransform(t, [0, 0.12], [1, 0]);
  const globeScale = useTransform(t, [0.1, 0.55], still ? [1, 1] : [1, 3.4]);
  const globeOpacity = useTransform(t, [0.3, 0.52], [1, 0]);

  return (
    <div className={styles.stage}>
      <motion.div
        className={styles.layer}
        style={{ scale: globeScale, opacity: globeOpacity, transformOrigin: `${TARGET_AT.x * 100}% ${TARGET_AT.y * 100}%` }}
      >
        <Globe sway={sway} visible={globeOpacity} />
        <GlobeHud />
      </motion.div>

      <NetworkIso t={t} still={still} />

      <Readout label="EVENTS / S" value={eps !== undefined ? String(eps) : "PENDING"} pos="tl" />
      <Readout label="EVENTS TODAY" value={today !== undefined ? today.toLocaleString("en-GB") : "PENDING"} pos="tr" />
      <Readout label="DETECTION RULES" value={String(RULE_COUNT)} pos="bl" />
      <Readout label="ATDE MODEL" value={atdeText} pos="br" tone={atdeText === "READY" ? "ok" : "muted"} />
    </div>
  );
}
