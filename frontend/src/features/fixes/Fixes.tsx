// RECOMMENDED FIXES: CRIE's top 3 from a fixed list, or MITRE's mitigations when nothing is
// confident enough or CRIE is not ready. Nothing runs without an analyst's approval.
import { AnimatePresence, motion } from "motion/react";
import type { Incident, ModelStatus } from "../../data/types";
import { Chip } from "../../components/Chip";
import { FixCard } from "../../components/FixCard";
import { GlassCard } from "../../components/GlassCard";
import { BoxTitle } from "../../components/Panel";
import { useNetra } from "../../store/useNetra";
import styles from "./Fixes.module.css";

const CRIE_STATE: Record<Exclude<ModelStatus["status"], "ready">, { chip: string; tone: "muted" | "fail"; sentence: string }> = {
  pending: { chip: "CRIE PENDING", tone: "muted", sentence: "The remediation model is not ready yet." },
  training: { chip: "CRIE TRAINING", tone: "muted", sentence: "The remediation model is retraining." },
  failed: { chip: "CRIE FAILED", tone: "fail", sentence: "The remediation model failed to load." },
};

export function MitigationsCard({ incident, crie }: { incident: Incident; crie?: ModelStatus }) {
  const technique = incident.fallback?.technique ?? incident.mitre.id.split(".")[0];
  const mitigations = incident.fallback?.mitigations ?? [];
  const state = crie && crie.status !== "ready" ? CRIE_STATE[crie.status] : null;

  return (
    <GlassCard className={styles.fallback}>
      {state && (
        <Chip tone={state.tone} className={styles.state}>
          {state.chip}
        </Chip>
      )}
      <p className={styles.fallbackText}>
        {state ? state.sentence : "No fix was confident enough."} Showing MITRE's standard mitigations for {technique}.
      </p>
      {mitigations.length > 0 ? (
        <ul className={styles.mitigations}>
          {mitigations.map((m) => (
            <li key={m.id}>
              <span className={styles.mid}>{m.id}</span>
              <span>{m.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.pending}>MITIGATIONS PENDING</p>
      )}
    </GlassCard>
  );
}

/** `bare`: no header of its own (inside the fixes overlay, which has one). */
export function Fixes({ incident, bare = false }: { incident: Incident; bare?: boolean }) {
  const crie = useNetra((s) => s.health?.models.find((m) => m.name === "CRIE"));
  const record = useNetra((s) => s.decisions[incident.id]);
  const decide = useNetra((s) => s.decide);

  const crieReady = !crie || crie.status === "ready";
  const fixes = incident.fixes.filter((f) => !record?.rejected.includes(f.actionId));
  const approvedId = record?.approved?.actionId;
  const settled = approvedId !== undefined || incident.status !== "open";

  return (
    <section className={styles.fixes} aria-label="Recommended fixes">
      {!bare && (
        <header className={styles.head}>
          <BoxTitle>Recommended fixes</BoxTitle>
        </header>
      )}

      {!crieReady || fixes.length === 0 ? (
        <MitigationsCard incident={incident} crie={crie} />
      ) : (
        <div className={styles.cards}>
          <AnimatePresence initial={false} mode="popLayout">
            {fixes.map((f) => (
              <motion.div
                key={`${incident.id}-${f.actionId}`}
                layout
                className={styles.slot}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.2 }}
              >
                <FixCard
                  fix={f}
                  approvedAt={approvedId === f.actionId ? record?.approved?.at : undefined}
                  locked={settled && approvedId !== f.actionId}
                  onApprove={() => decide({ incidentId: incident.id, actionId: f.actionId, decision: "approve" })}
                  onReject={() => decide({ incidentId: incident.id, actionId: f.actionId, decision: "reject" })}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
