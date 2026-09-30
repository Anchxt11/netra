// The glass incident focus card: what it is, how bad, how sure, how soon. Spec: docs/PAGES.md "Centre top".
import type { Incident } from "../../data/types";
import { AttentionGauge } from "../../components/AttentionGauge";
import { Chip, SplitChip } from "../../components/Chip";
import { CountdownRing } from "../../components/CountdownRing";
import { GlassCard } from "../../components/GlassCard";
import { BracketLabel } from "../../components/Panel";
import { RiskReadout } from "../../components/RiskReadout";
import { SevBars } from "../../components/SevBars";
import { remainingShare } from "../../lib/heat";
import { assessRisk } from "../../lib/rank";
import { formatClock } from "../../lib/time";
import { useNetra } from "../../store/useNetra";
import styles from "./IncidentFocus.module.css";

function DetectedChip({ by }: { by: Incident["detectedBy"] }) {
  if (by === "both") return <SplitChip left="DETECTED BY RULES" right="+ AI" />;
  return (
    <Chip tone={by === "rule" ? "rule" : "ai"} dot>
      {by === "rule" ? "DETECTED BY RULES" : "DETECTED BY AI"}
    </Chip>
  );
}

export function IncidentFocus({ incident }: { incident: Incident }) {
  const now = useNetra((s) => s.now);
  const remaining = remainingShare(incident.createdAt, incident.staleBy, now);
  const breakdown = assessRisk(incident.severity, incident.attentionScore, remaining);
  const timeLeftMs = Math.max(0, Date.parse(incident.staleBy) - now);
  const { users, ips } = incident.entities;

  return (
    <GlassCard className={styles.card}>
      <div className={styles.main}>
        <div className={styles.head}>
          <BracketLabel>INCIDENT {incident.id}</BracketLabel>
          <span className={styles.opened}>OPENED {formatClock(incident.createdAt)}</span>
          {incident.status === "approved" && (
            <Chip tone="ok" className={styles.approved}>
              FIX APPROVED
            </Chip>
          )}
        </div>
        <h2 className={styles.name}>{incident.name}</h2>
        <div className={styles.chips}>
          <DetectedChip by={incident.detectedBy} />
          <Chip>{incident.mitre.id}</Chip>
          {users.length === 1 && <Chip>{users[0]}</Chip>}
          {users.length > 1 && <Chip>{users.length} ACCOUNTS</Chip>}
          {ips.length > 0 && <Chip>{ips.length === 1 ? "1 ADDRESS" : `${ips.length} ADDRESSES`}</Chip>}
        </div>
        <div className={styles.readouts}>
          <SevBars severity={incident.severity} labelled />
          <AttentionGauge value={incident.attentionScore} />
          <RiskReadout severity={incident.severity} breakdown={breakdown} />
        </div>
      </div>
      <div className={styles.ring}>
        <CountdownRing remaining={remaining} timeLeftMs={timeLeftMs} staleBy={incident.staleBy} />
      </div>
    </GlassCard>
  );
}
