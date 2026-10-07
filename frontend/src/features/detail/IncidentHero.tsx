// The incident, front and centre (PAGES.md "Centre: the incident"): what it is, how long is left,
// how it escalated, and how bad, sure and urgent it is. The fixes wait behind the FIX button.
import type { Incident } from "../../data/types";
import { Chip } from "../../components/Chip";
import { CountdownRing } from "../../components/CountdownRing";
import { EscalationChart } from "../../components/EscalationChart";
import { EvidenceBar } from "../../components/EvidenceBar";
import { SevBars } from "../../components/SevBars";
import { TierChip } from "../../components/TierHeader";
import { remainingShare } from "../../lib/heat";
import { assessRisk, riskFormula } from "../../lib/rank";
import { formatClock } from "../../lib/time";
import { useNetra } from "../../store/useNetra";
import { FixButton } from "../fixes/FixButton";
import styles from "./IncidentHero.module.css";

const DETECTED = { rule: "rules", ai: "the AI engine", both: "rules + AI" } as const;

export function IncidentHero({ incident }: { incident: Incident }) {
  const now = useNetra((s) => s.now);
  const remaining = remainingShare(incident.createdAt, incident.staleBy, now);
  const breakdown = assessRisk(incident.severity, incident.attentionScore, remaining);
  const timeLeftMs = Math.max(0, Date.parse(incident.staleBy) - now);
  const { users, ips, hosts } = incident.entities;

  const who = [
    users.length === 1 ? users[0] : users.length > 1 ? `${users.length} accounts` : null,
    ips.length === 1 ? "1 address" : ips.length > 1 ? `${ips.length} addresses` : null,
    hosts.length ? hosts.slice(0, 2).join(", ") + (hosts.length > 2 ? ` +${hosts.length - 2}` : "") : null,
  ].filter(Boolean);

  return (
    <section className={styles.hero} data-tour="focus" aria-label={`Incident ${incident.id}: ${incident.name}`}>
      <div className={styles.dots} aria-hidden="true" />

      <header className={styles.head}>
        <div className={styles.titleCol}>
          <div className={styles.meta}>
            <TierChip tier={breakdown.tier} />
            <span>
              Incident {incident.id} · opened {formatClock(incident.createdAt)} · found by{" "}
              <span className={incident.detectedBy === "rule" ? undefined : styles.ai}>{DETECTED[incident.detectedBy]}</span>
            </span>
            {incident.status === "approved" && <Chip tone="ok">Fix approved</Chip>}
          </div>
          <h2 className={styles.name}>{incident.name}</h2>
          <p className={styles.who}>
            {who.join(" · ")}
            {who.length > 0 && " · "}
            <span className={styles.mono} title={incident.mitre.name}>
              {incident.mitre.id}
            </span>
          </p>
        </div>
        <FixButton incident={incident} />
      </header>

      <div className={styles.body}>
        <CountdownRing remaining={remaining} timeLeftMs={timeLeftMs} staleBy={incident.staleBy} />
        <EscalationChart key={incident.id} signals={incident.signals} />
        <div className={styles.evidence}>
          <EvidenceBar signals={incident.signals} attention={incident.attentionScore} />
        </div>
      </div>

      <footer className={styles.facts}>
        <div className={styles.fact}>
          <span className={styles.factLabel}>Severity</span>
          <span className={styles.factValue}>
            <SevBars severity={incident.severity} />
          </span>
        </div>
        <div className={styles.fact}>
          <span className={styles.factLabel}>Attention</span>
          <span className={styles.factValue}>
            {incident.attentionScore}
            <span className={styles.faint}>/100</span>
          </span>
        </div>
        <div className={styles.fact}>
          <span className={styles.factLabel}>Risk = severity × attention × urgency</span>
          <span className={styles.factValue}>
            <span className={breakdown.tier === "ACT NOW" ? styles.rust : undefined}>{breakdown.risk.toFixed(2)}</span>
            <span className={styles.formula}>{riskFormula(incident.severity, breakdown)}</span>
          </span>
        </div>
      </footer>
    </section>
  );
}
