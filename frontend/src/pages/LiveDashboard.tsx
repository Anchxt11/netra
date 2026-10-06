// /live: left = what needs action, centre = the incident (how long, how it escalated, how bad) with
// the details a hover away, right = the traffic itself. Layout: docs/PAGES.md, design board "Dashboard B".
import { useEffect } from "react";
import { Queue } from "../features/queue/Queue";
import { IncidentFocusEmpty } from "../features/detail/IncidentFocusEmpty";
import { IncidentHero } from "../features/detail/IncidentHero";
import { JudgedNormalDetail } from "../features/detail/JudgedNormalDetail";
import { DashboardTiles } from "../features/health/DashboardTiles";
import { LiveFeed } from "../features/traffic/LiveFeed";
import { Toast } from "../components/Toast";
import { DemoDock } from "../features/demo/DemoDock";
import { Tour } from "../features/tour/Tour";
import { useNetra, useRankedIncidents } from "../store/useNetra";
import styles from "./LiveDashboard.module.css";

/** `embedded`: shown at the end of the home page's story (the tour then only plays on request). */
export function LiveDashboard({ embedded = false }: { embedded?: boolean }) {
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

      <div className={styles.centre}>
        {selectedBenign ? (
          <JudgedNormalDetail anomaly={selectedBenign} />
        ) : selectedIncident ? (
          <IncidentHero incident={selectedIncident} />
        ) : (
          <IncidentFocusEmpty />
        )}
        <DashboardTiles incident={selectedIncident} />
      </div>

      <div className={styles.right}>
        <LiveFeed />
      </div>

      <Toast />
      <DemoDock />
      <Tour autoStart={!embedded} />
    </div>
  );
}
