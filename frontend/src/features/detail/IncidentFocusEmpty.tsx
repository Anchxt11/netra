// The focus card before the first incident arrives. Never shown with the mock feed, which starts
// with incidents; with a real feed it covers the moment between connecting and the first alert.
import { GlassCard } from "../../components/GlassCard";
import { BoxTitle } from "../../components/Panel";
import styles from "./Detail.module.css";

export function IncidentFocusEmpty() {
  return (
    <GlassCard className={styles.focus}>
      <BoxTitle>INCIDENT</BoxTitle>
      <p className={styles.note}>Waiting for the first incident. Nothing needs action yet.</p>
    </GlassCard>
  );
}
