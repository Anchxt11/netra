// Right column: the big picture (scope), the trend (detections) and whether to trust it (system).
import { lazy, Suspense } from "react";
import { Chip } from "../../components/Chip";
import { Panel } from "../../components/Panel";
import { SystemList } from "../../components/SystemList";
import { ThreatScope } from "../../components/ThreatScope";
import { useNetra, useRankedIncidents } from "../../store/useNetra";
import styles from "./RightColumn.module.css";

const DetectionsChart = lazy(() => import("../../components/DetectionsChart"));

const minuteStart = (t: number) => Math.floor(t / 60_000) * 60_000;

export function RightColumn() {
  const ranked = useRankedIncidents();
  const selection = useNetra((s) => s.selection);
  const select = useNetra((s) => s.select);
  const health = useNetra((s) => s.health);
  const now = useNetra((s) => s.now);
  const selected = useNetra((s) => (s.selection?.kind === "incident" ? s.incidents[s.selection.id] : undefined));

  const selectedId = selection?.kind === "incident" ? selection.id : null;
  const perMin = health?.detectionsPerMin ?? [];
  const windowStart = perMin.length ? Date.parse(perMin[0].t) : Infinity;
  const started = selected ? minuteStart(Date.parse(selected.createdAt)) : null;
  const attackStart = started !== null && started >= windowStart ? started : null;

  return (
    <>
      <Panel title="Threat scope" meta={`${ranked.length} OPEN`} corners={["tr", "bl"]} className={styles.panel} tourId="scope">
        <ThreatScope incidents={ranked} selectedId={selectedId} onSelect={(id) => select({ kind: "incident", id })} />
      </Panel>

      <Panel title="Detections / min" meta="LAST 30 MIN" className={styles.panel} tourId="detections">
        {health && (
          <div className={styles.chips}>
            <Chip tone="rule" dot>
              RULES {health.detections.rule}
            </Chip>
            <Chip tone="ai" dot>
              AI ENGINE {health.detections.ai}
            </Chip>
          </div>
        )}
        <Suspense fallback={<div className={styles.chartSpace} />}>
          {perMin.length > 0 && <DetectionsChart perMin={perMin} attackStart={attackStart} />}
        </Suspense>
      </Panel>

      <Panel title="System" meta="CAN YOU TRUST THIS?" className={styles.panel} tourId="system">
        {health ? <SystemList health={health} now={now} /> : <p className={styles.pending}>PENDING</p>}
      </Panel>
    </>
  );
}
