// /live: left = what needs action, centre = how much time and why, right = the big picture and trust.
// Layout: docs/DESIGN.md "Live dashboard layout" and docs/reference/dashboard.png.
import { useEffect } from "react";
import { Panel } from "../components/Panel";
import { Queue } from "../features/queue/Queue";
import { IncidentFocusStub } from "../features/detail/IncidentFocusStub";
import { IncidentFocus } from "../features/detail/IncidentFocus";
import { EscalationPanel, InvolvedPanel } from "../features/detail/DetailPanels";
import { JudgedNormalDetail } from "../features/detail/JudgedNormalDetail";
import { useNetra, useRankedIncidents } from "../store/useNetra";
import styles from "./LiveDashboard.module.css";

/** TEMPORARY stand-in for panels built in later steps. */
function Upcoming({ title, meta, className }: { title: string; meta?: string; className?: string }) {
  return (
    <Panel title={title} meta={meta} className={`${styles.upcoming} ${className ?? ""}`}>
      <p className={styles.upcomingNote}>Built in a later step.</p>
    </Panel>
  );
}

export function LiveDashboard() {
  const ranked = useRankedIncidents();
  const incidents = useNetra((s) => s.incidents);
  const benign = useNetra((s) => s.benign);
  const selection = useNetra((s) => s.selection);
  const select = useNetra((s) => s.select);

  // Never an empty centre: select the top incident whenever nothing valid is selected.
  // A choice the analyst made stays put while rows move around it.
  useEffect(() => {
    const valid =
      selection !== null &&
      (selection.kind === "incident" ? selection.id in incidents : benign.some((b) => b.id === selection.id));
    if (!valid && ranked.length > 0) select({ kind: "incident", id: ranked[0].id });
  }, [selection, incidents, benign, ranked, select]);

  const selectedBenign = selection?.kind === "benign" ? benign.find((b) => b.id === selection.id) : undefined;
  const selectedIncident = selection?.kind === "incident" ? incidents[selection.id] : undefined;

  return (
    <div className={styles.dash}>
      <h1 className="visually-hidden">Live dashboard</h1>
      <p className="visually-hidden">Live incidents, ranked by how bad, how sure and how soon.</p>

      <div className={styles.left}>
        <Queue />
      </div>

      {selectedBenign ? (
        <div className={styles.centreSingle}>
          <JudgedNormalDetail anomaly={selectedBenign} />
        </div>
      ) : (
        <div className={styles.centre}>
          {selectedIncident ? (
            <>
              <IncidentFocus incident={selectedIncident} />
              <div className={styles.middle}>
                <EscalationPanel incident={selectedIncident} />
                <InvolvedPanel incident={selectedIncident} />
              </div>
            </>
          ) : (
            <>
              <IncidentFocusStub incident={undefined} />
              <div className={styles.middle}>
                <Upcoming title="How it escalated" />
                <Upcoming title="Who is involved" />
              </div>
            </>
          )}
          <Upcoming title="Recommended fixes" meta="FROM A FIXED LIST OF 14, NOTHING RUNS WITHOUT APPROVAL" />
        </div>
      )}

      <div className={styles.right}>
        <Upcoming title="Threat scope" />
        <Upcoming title="Detections / min" meta="LAST 30 MIN" />
        <Upcoming title="System" meta="CAN YOU TRUST THIS?" />
      </div>
    </div>
  );
}
