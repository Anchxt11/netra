// SYSTEM: can you trust what the dashboard shows? Green = healthy. Pink = our own pipeline failing.
import type { ModelStatus, PipelineHealth } from "../data/types";
import { formatHM } from "../lib/time";
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
  if (m.status === "pending") return { key, label, value: "PENDING", tone: "muted" };
  if (m.status === "training") return { key, label, value: "TRAINING", tone: "muted" };
  if (m.version === "example") return { key, label, value: "EXAMPLE", tone: "muted" };
  return { key, label, value: `v${m.version} READY`, tone: "ok" };
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
  const p95 = health.freshnessMs.p95;
  const over = p95 > health.slaMs;
  const stoppedFor = Math.max(0, Math.round((now - Date.parse(health.lastEventAt)) / 1000));

  // Any pipeline problem replaces the first row with a pink status and a plain sentence.
  const first: Row =
    health.feed !== "live"
      ? { key: "feed", label: `Live feed stopped ${stoppedFor} s ago. Showing the last known state.`, value: "", tone: "fail" }
      : health.alerts.length > 0
        ? { key: "feed", label: health.alerts[0].sentence, value: "", tone: "fail" }
        : { key: "feed", label: "Live feed", value: `${health.eventsPerSec} EVENTS/S`, tone: "ok" };

  const retrain: Row =
    health.retraining.status === "failed"
      ? { key: "retrain", label: "Next retraining", value: "LAST RUN FAILED", tone: "fail" }
      : { key: "retrain", label: "Next retraining", value: health.retraining.nextRun ? formatHM(health.retraining.nextRun) : "PENDING", tone: "ok" };

  const rows: Row[] = [
    first,
    {
      key: "fresh",
      label: "Freshness p95",
      value: `${(p95 / 1000).toFixed(1)}S/${health.slaMs / 1000}S${over ? " OVER" : ""}`,
      tone: over ? "fail" : "ok",
      spark: health.freshnessHistory.map((f) => f.p95),
    },
    modelRow(health.models.find((m) => m.name === "ATDE"), "ATDE detection model"),
    modelRow(health.models.find((m) => m.name === "CRIE"), "CRIE remediation model"),
    retrain,
    {
      key: "decisions",
      label: "Fixes approved today",
      value: `${health.decisions.approved} / ${health.decisions.rejected} REJECTED`,
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
