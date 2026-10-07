// SYSTEM: can you trust what the dashboard shows? Green = healthy. Pink = our own pipeline failing.
import type { JobStatus, ModelStatus, PipelineHealth } from "../data/types";
import { formatClock, formatHM } from "../lib/time";
import styles from "./SystemList.module.css";

type Tone = "ok" | "muted" | "fail";

interface Row {
  key: string;
  label: string;
  value: string;
  tone: Tone;
  spark?: number[];
}

function modelRow(m: ModelStatus | undefined, label: string): Row {
  const key = label;
  if (!m) return { key, label, value: "PENDING", tone: "muted" };
  if (m.status === "failed") return { key, label, value: "FAILED", tone: "fail" };
  if (m.status === "offline") return { key, label, value: m.version ? `v${m.version} offline` : "offline", tone: "fail" };
  if (m.status === "pending") return { key, label, value: "PENDING", tone: "muted" };
  if (m.status === "training") return { key, label, value: "TRAINING", tone: "muted" };
  if (m.version === "example") return { key, label, value: "EXAMPLE", tone: "muted" };
  return { key, label, value: `v${m.version} ready`, tone: "ok" };
}

// The ops service's jobs, in the order they matter on the day (contracts/LIVE_API.md 4.5).
const JOBS: [string, string][] = [
  ["health_watch", "Health watch"],
  ["sla_check", "SLA check"],
  ["daily_report", "Daily report"],
  ["model_retrain", "Model retrain"],
  ["data_retention", "Data retention"],
];

function jobRows(jobs: JobStatus[] | null): Row[] {
  if (jobs === null) return [{ key: "jobs", label: "Scheduled jobs", value: "PENDING", tone: "muted" }];
  return JOBS.map(([job, label]) => {
    const j = jobs.find((x) => x.job === job);
    const key = `job-${job}`;
    if (!j || !j.status || !j.lastRunAt) return { key, label, value: j?.nextRunAt ? `first run ${formatHM(j.nextRunAt)}` : "not run yet", tone: "muted" };
    const at = formatClock(j.lastRunAt);
    if (j.status === "failed") return { key, label, value: `failed ${at}`, tone: "fail" };
    if (j.status === "skipped") return { key, label, value: `skipped ${at}`, tone: "muted" };
    return { key, label, value: `ok ${at}`, tone: "ok" };
  });
}

/** Freshness p95 over the last minute, scaled against the 5 s target (top = target). */
function Sparkline({ values, max }: { values: number[]; max: number }) {
  const w = 56;
  const h = 16;
  const step = w / Math.max(1, values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 1 - Math.min(1, v / max) * (h - 2)).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className={styles.spark} aria-hidden="true">
      <line x1="0" y1="1" x2={w} y2="1" className={styles.target} />
      <polyline points={points} className={styles.sparkLine} />
    </svg>
  );
}

export function SystemList({ health, now }: { health: PipelineHealth; now: number }) {
  const p95 = health.freshnessMs?.p95;
  const over = p95 !== undefined && p95 > health.slaMs;
  const stoppedFor = Math.max(0, Math.round((now - Date.parse(health.lastEventAt)) / 1000));

  // Any pipeline problem replaces the first row with a pink status and a plain sentence.
  const first: Row =
    health.feed !== "live"
      ? { key: "feed", label: `Live feed stopped ${stoppedFor} s ago. Showing the last known state.`, value: "", tone: "fail" }
      : health.alerts.length > 0
        ? { key: "feed", label: health.alerts[0].sentence, value: "", tone: "fail" }
        : { key: "feed", label: "Live feed", value: `${health.eventsPerSec} events/s`, tone: "ok" };

  const retrain: Row =
    health.retraining.status === "failed"
      ? { key: "retrain", label: "Next retraining", value: "last run failed", tone: "fail" }
      : health.retraining.nextRun
        ? { key: "retrain", label: "Next retraining", value: formatHM(health.retraining.nextRun), tone: "ok" }
        : { key: "retrain", label: "Next retraining", value: "PENDING", tone: "muted" };

  // Every open ops alert is its own pink sentence (the first one may already be the top row).
  const ops: Row[] = health.opsAlerts.map((a) => ({ key: `ops-${a.id}`, label: a.message, value: "", tone: "fail" }));

  const rows: Row[] = [
    first,
    ...ops,
    p95 === undefined
      ? { key: "fresh", label: "Freshness p95", value: "PENDING", tone: "muted" }
      : {
          key: "fresh",
          label: "Freshness p95",
          value: `${(p95 / 1000).toFixed(1)} s / ${health.slaMs / 1000} s${over ? " over" : ""}`,
          tone: over ? "fail" : "ok",
          spark: health.freshnessHistory.map((f) => f.p95),
        },
    health.timeToScreenMs === null
      ? { key: "screen", label: "Time to screen p95", value: "PENDING", tone: "muted" }
      : {
          key: "screen",
          label: "Time to screen p95",
          value: `${(health.timeToScreenMs.p95 / 1000).toFixed(1)} s / ${health.slaMs / 1000} s${health.timeToScreenMs.p95 > health.slaMs ? " over" : ""}`,
          tone: health.timeToScreenMs.p95 > health.slaMs ? "fail" : "ok",
          spark: health.timeToScreenHistory.map((f) => f.p95),
        },
    modelRow(health.models.find((m) => m.name === "ATDE"), "ATDE detection model"),
    modelRow(health.models.find((m) => m.name === "CRIE"), "CRIE remediation model"),
    retrain,
    ...jobRows(health.jobs),
    {
      key: "decisions",
      label: "Fixes approved today",
      value: `${health.decisions.approved} / ${health.decisions.rejected} rejected`,
      tone: "ok",
    },
  ];

  return (
    <ul className={styles.list}>
      {rows.map((r) => (
        <li key={r.key} className={`${styles.row} ${r.tone === "fail" && !r.value ? styles.alert : ""}`}>
          <i className={`${styles.dot} ${styles[r.tone]}`} aria-hidden="true" />
          <span className={styles.label}>{r.label}</span>
          {r.spark && <Sparkline values={r.spark} max={health.slaMs} />}
          {r.value && <span className={`${styles.value} ${r.tone === "fail" ? styles.failText : ""}`}>{r.value}</span>}
          {r.tone === "fail" && <span className="visually-hidden">, problem</span>}
        </li>
      ))}
    </ul>
  );
}
