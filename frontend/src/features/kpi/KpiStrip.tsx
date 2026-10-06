// The KPI strip above the dashboard: five live numbers from all traffic over the last minute, each
// with a small trend and its state in words. Data: the `kpi` and `kpi_alert` messages (LIVE_API.md 4.1, 4.2).
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { KPI_ORDER } from "../../data/kpi";
import type { KpiAlert, KpiName, KpiPoint, KpiReading } from "../../data/types";
import { formatKpiValue, kpiLabel } from "../../lib/kpiFormat";
import { formatClock } from "../../lib/time";
import { useCanEditThresholds } from "./canEdit";
import { useNetra } from "../../store/useNetra";
import styles from "./KpiStrip.module.css";

type Shown = "pending" | "no_data" | "no_line" | "ok" | "warn" | "crit";

const STATE: Record<Shown, { word: string; className: string }> = {
  pending: { word: "PENDING", className: styles.quiet },
  no_data: { word: "NO DATA", className: styles.quiet },
  no_line: { word: "NO LINE", className: styles.quiet },
  ok: { word: "NORMAL", className: styles.ok },
  warn: { word: "WARNING", className: styles.warn },
  crit: { word: "CRITICAL", className: styles.crit },
};

function shownState(r: KpiReading | undefined): Shown {
  if (!r) return "pending";
  if (r.level === "no_data") return "no_data";
  if (r.level === "ok" && r.warn === null && r.crit === null) return "no_line";
  return r.level;
}

export function KpiStrip() {
  const kpi = useNetra((s) => s.kpi);
  const trend = useNetra((s) => s.kpiTrend);
  const alerts = useNetra((s) => s.kpiAlerts);
  const canEdit = useCanEditThresholds();

  const firing = useMemo(() => {
    const byKpi: Partial<Record<string, KpiAlert>> = {};
    for (const a of Object.values(alerts)) if (a.state === "firing") byKpi[a.kpi] = a;
    return byKpi;
  }, [alerts]);

  return (
    <section className={styles.strip} aria-label="Live KPIs over the last minute" data-tour="kpis">
      {KPI_ORDER.map(({ name }) => (
        <KpiCell
          key={name}
          name={name}
          reading={kpi?.kpis.find((k) => k.name === name)}
          trend={trend}
          alert={firing[name]}
        />
      ))}
      {canEdit && (
        <Link to="/thresholds" className={styles.edit}>
          Thresholds
        </Link>
      )}
    </section>
  );
}

function KpiCell({ name, reading, trend, alert }: { name: KpiName; reading?: KpiReading; trend: KpiPoint[]; alert?: KpiAlert }) {
  const shown = shownState(reading);
  const state = STATE[shown];
  const value = reading?.value1m ?? null;
  const text = value === null ? null : formatKpiValue(name, value);
  const lines = reading && (reading.warn !== null || reading.crit !== null)
    ? [reading.warn !== null && `warning ${formatKpiValue(name, reading.warn)}`, reading.crit !== null && `critical ${formatKpiValue(name, reading.crit)}`].filter(Boolean).join(" · ")
    : null;
  const spoken = `${kpiLabel(name)}: ${text ?? "no value"}, ${state.word.toLowerCase()}.${lines ? ` Lines: ${lines}.` : ""}${alert ? ` Alert open since ${formatClock(alert.startedAt)}.` : ""}`;

  return (
    <div className={`${styles.cell} ${alert ? styles.alerting : ""}`} tabIndex={0} aria-label={spoken}>
      <div className={styles.top} aria-hidden="true">
        <span className={styles.label}>{kpiLabel(name)}</span>
        <span className={`${styles.pill} ${state.className}`}>{state.word}</span>
      </div>
      <div className={styles.mid} aria-hidden="true">
        {text === null ? (
          <span className={styles.pending}>{shown === "pending" ? "PENDING" : "No data"}</span>
        ) : (
          <BigValue text={text} />
        )}
        <Spark name={name} trend={trend} hot={shown === "warn" || shown === "crit"} />
      </div>
      <div className={styles.foot} aria-hidden="true">
        {alert ? (
          <span className={styles.alertNote}>Alert since {formatClock(alert.startedAt)}</span>
        ) : (
          <span>{lines ?? (reading ? "No lines set" : "Waiting for the first reading")}</span>
        )}
      </div>
    </div>
  );
}

/** "148 MB" -> 14<faint>8</faint> MB: the eye reads the size first (DESIGN.md, Type). */
function BigValue({ text }: { text: string }) {
  const m = /^([\d.]+)\s*(.*)$/.exec(text);
  const digits = m ? m[1] : text;
  const unit = m ? m[2] : "";
  return (
    <span className={styles.value}>
      {digits.length > 1 ? digits.slice(0, -1) : ""}
      <span className={styles.faint}>{digits.slice(-1)}</span>
      {unit && <span className={styles.unit}>{unit}</span>}
    </span>
  );
}

const W = 76;
const H = 24;

/** The last 15 minutes of this KPI's 1-minute value, scaled to its own range so movement shows. */
function Spark({ name, trend, hot }: { name: KpiName; trend: KpiPoint[]; hot: boolean }) {
  const path = useMemo(() => {
    const vals = trend.map((p) => p.values[name] ?? null);
    const known = vals.filter((v): v is number => v !== null);
    if (known.length < 2) return null;
    const lo = Math.min(...known);
    const hi = Math.max(...known);
    const span = hi - lo || 1;
    let d = "";
    let pen = false;
    let last: [number, number] | null = null;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      const x = (i / Math.max(1, vals.length - 1)) * (W - 3) + 1.5;
      const y = H - 2 - ((v - lo) / span) * (H - 4);
      d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      pen = true;
      last = [x, y];
    });
    return { d, last: last as [number, number] | null };
  }, [trend, name]);

  if (!path) return <svg className={styles.spark} width={W} height={H} aria-hidden="true" />;
  return (
    <svg className={styles.spark} width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={path.d} className={styles.sparkLine} />
      {path.last && <circle cx={path.last[0]} cy={path.last[1]} r={2} className={hot ? styles.sparkHot : styles.sparkDot} />}
    </svg>
  );
}
