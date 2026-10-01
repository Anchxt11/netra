import type { Incident } from "../../data/types";
import { EntityGraph } from "../../components/EntityGraph";
import { EscalationList } from "../../components/EscalationList";
import { EvidenceBar } from "../../components/EvidenceBar";
import { Panel } from "../../components/Panel";
import styles from "./DetailPanels.module.css";

/** HOW IT ESCALATED: every signal in order, and the bar that adds them up to the attention score. */
export function EscalationPanel({ incident }: { incident: Incident }) {
  const n = incident.signals.length;
  const hasRule = incident.signals.some((s) => s.ruleId !== "ATDE");
  const hasAi = incident.signals.some((s) => s.ruleId === "ATDE");
  const engines = Number(hasRule) + Number(hasAi);
  const meta = `${n} ${n === 1 ? "SIGNAL" : "SIGNALS"}, ${engines} ${engines === 1 ? "ENGINE" : "ENGINES"}`;

  return (
    <Panel title="How it escalated" meta={meta} corners={["tl"]} className={styles.panel} tourId="escalation">
      <div className={styles.escalation}>
        <EscalationList key={incident.id} signals={incident.signals} />
        <EvidenceBar signals={incident.signals} attention={incident.attentionScore} />
      </div>
    </Panel>
  );
}

/** WHO IS INVOLVED: the entity graph. */
export function InvolvedPanel({ incident }: { incident: Incident }) {
  return (
    <Panel title="Who is involved" corners={["tr"]} className={styles.panel} tourId="involved">
      <div className={styles.body}>
        <EntityGraph incident={incident} />
      </div>
    </Panel>
  );
}
