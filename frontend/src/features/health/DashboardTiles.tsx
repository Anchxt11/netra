// The four tiles under the incident (PAGES.md "Centre bottom"): closed they show one line or one
// small drawing; hover, focus or click opens them upward over the incident.
import { lazy, Suspense } from "react";
import type { Incident } from "../../data/types";
import { EntityGraph } from "../../components/EntityGraph";
import { SystemList } from "../../components/SystemList";
import { ThreatScope } from "../../components/ThreatScope";
import { Tile } from "../../components/Tile";
import { useNetra, useRankedIncidents } from "../../store/useNetra";
import styles from "./DashboardTiles.module.css";

const DetectionsChart = lazy(() => import("../../components/DetectionsChart"));

const minuteStart = (t: number) => Math.floor(t / 60_000) * 60_000;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function whoSummary(inc: Incident | undefined): string {
  if (!inc) return "Select an incident";
  const { users, hosts, ips } = inc.entities;
  return [plural(users.length, "account", "accounts"), plural(hosts.length, "host", "hosts"), plural(ips.length, "address", "addresses")].join(" · ");
}

export function DashboardTiles({ incident }: { incident?: Incident }) {
  const ranked = useRankedIncidents();
  const selection = useNetra((s) => s.selection);
  const select = useNetra((s) => s.select);
  const health = useNetra((s) => s.health);
  const now = useNetra((s) => s.now);

  const selectedId = selection?.kind === "incident" ? selection.id : null;
  const actNow = ranked.filter((i) => i.rank.tier === "ACT NOW").length;
  const perMin = health?.detectionsPerMin ?? [];
  const lastMin = perMin[perMin.length - 1];
  const windowStart = perMin.length ? Date.parse(perMin[0].t) : Infinity;
  const started = incident ? minuteStart(Date.parse(incident.createdAt)) : null;
  const attackStart = started !== null && started >= windowStart ? started : null;
  const problem = health ? health.feed !== "live" || health.alerts.length > 0 : false;

  return (
    <div className={styles.tiles}>
      <Tile
        title="Threat scope"
        meta={`${ranked.length} open`}
        tourId="scope"
        summary={
          <div className={styles.scopeMini}>
            <div className={styles.mini}>
              <ThreatScope incidents={ranked} selectedId={selectedId} onSelect={() => {}} compact />
            </div>
            <span className={styles.line}>
              <span className={styles.rust}>{actNow}</span> act now
            </span>
          </div>
        }
      >
        <div className={styles.scopeOpen}>
          <ThreatScope incidents={ranked} selectedId={selectedId} onSelect={(id) => select({ kind: "incident", id })} />
        </div>
      </Tile>

      <Tile title="Who is involved" tourId="involved" summary={<span className={styles.line}>{whoSummary(incident)}</span>}>
        {incident ? <EntityGraph incident={incident} /> : <p className={styles.line}>Select an incident to see who is involved.</p>}
      </Tile>

      <Tile
        title="Detections / min"
        meta="last 30 min"
        tourId="detections"
        grow="left"
        summary={
          lastMin ? (
            <span className={styles.big}>
              {lastMin.rule}
              <span className={styles.small}> rules · </span>
              <span className={styles.ai}>{lastMin.ai}</span>
              <span className={styles.small}> AI</span>
            </span>
          ) : (
            <span className={styles.line}>PENDING</span>
          )
        }
      >
        <div className={styles.chartOpen}>
          <p className={styles.line}>
            {health ? `${health.detections.rule} by rules and ${health.detections.ai} by the AI engine in the last 30 minutes.` : "PENDING"}
          </p>
          <Suspense fallback={null}>{perMin.length > 0 && <DetectionsChart perMin={perMin} attackStart={attackStart} />}</Suspense>
        </div>
      </Tile>

      <Tile
        title="System"
        meta="can you trust this?"
        tourId="system"
        grow="left"
        summary={
          <span className={styles.line}>
            <i className={`${styles.dot} ${problem ? styles.bad : ""}`} aria-hidden="true" />
            {!health ? "PENDING" : problem ? "Something needs attention" : "All healthy"}
          </span>
        }
      >
        {health ? <SystemList health={health} now={now} /> : <p className={styles.line}>PENDING</p>}
      </Tile>
    </div>
  );
}
