// The landing stage: globe, its HUD, and four live readouts from the store in the corners.
import { NumText } from "../components/NumText";
import { RULES } from "../data/catalog";
import { useNetra } from "../store/useNetra";
import { Globe } from "./Globe";
import { GlobeHud } from "./GlobeHud";
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

export function StepStage() {
  const eps = useNetra((s) => s.health?.eventsPerSec);
  const today = useNetra((s) => s.health?.eventsToday);
  const atde = useNetra((s) => s.health?.models.find((m) => m.name === "ATDE"));

  const atdeText = !atde ? "PENDING" : atde.status !== "ready" ? atde.status.toUpperCase() : atde.version === "example" ? "EXAMPLE" : "READY";

  return (
    <div className={styles.stage}>
      <Globe />
      <GlobeHud />
      <Readout label="EVENTS / S" value={eps !== undefined ? String(eps) : "PENDING"} pos="tl" />
      <Readout label="EVENTS TODAY" value={today !== undefined ? today.toLocaleString("en-GB") : "PENDING"} pos="tr" />
      <Readout label="DETECTION RULES" value={String(RULE_COUNT)} pos="bl" />
      <Readout label="ATDE MODEL" value={atdeText} pos="br" tone={atdeText === "READY" ? "ok" : "muted"} />
    </div>
  );
}
