// TEMPORARY: shows which incident is selected until the real focus card (Prompt F) replaces it.
import type { Incident } from "../../data/types";
import { GlassCard } from "../../components/GlassCard";
import { BracketLabel } from "../../components/Panel";
import { formatClock } from "../../lib/time";
import styles from "./Detail.module.css";

export function IncidentFocusStub({ incident }: { incident: Incident | undefined }) {
  return (
    <GlassCard className={styles.focus}>
      {incident ? (
        <>
          <div className={styles.head}>
            <BracketLabel>INCIDENT {incident.id}</BracketLabel>
            <span className={styles.opened}>OPENED {formatClock(incident.createdAt)}</span>
          </div>
          <h2 className={styles.name}>{incident.name}</h2>
          <p className={styles.note}>Full incident detail is built in the next step.</p>
        </>
      ) : (
        <p className={styles.note}>Waiting for the first incident.</p>
      )}
    </GlassCard>
  );
}
