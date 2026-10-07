// How the live KPIs read on screen: names, values and the units an admin types lines in.
// The wire carries rates as ratios (0.46) and data as bytes; people read 46% and 148 MB.
import type { KpiAlert, KpiName } from "../data/types.ts";

const KPI_TEXT: Record<KpiName, { label: string; input: string }> = {
  events_per_sec: { label: "Events / s", input: "events/s" },
  login_failure_rate: { label: "Login failures", input: "% of logins" },
  http_5xx_rate: { label: "Server errors", input: "% of requests" },
  bytes_out_per_min: { label: "Data out / min", input: "MB per minute" },
  rule_hit_rate: { label: "Rule hits", input: "% of events" },
};

const isRate = (name: string) => name === "login_failure_rate" || name === "http_5xx_rate" || name === "rule_hit_rate";
const known = (name: string): name is KpiName => name in KPI_TEXT;

// Not a strip KPI: the dashboard's own SLA alert (kind "sla", docs/SLA.md), in seconds.
const SCREEN = "time_to_screen_p95";

export const kpiLabel = (name: string) => (known(name) ? KPI_TEXT[name].label : name === SCREEN ? "Time to screen p95" : name);
export const kpiInputUnit = (name: KpiName) => KPI_TEXT[name].input;

/** One decimal under 10, whole numbers above: 0.4, 8.4, 46, 214. */
function short(v: number): string {
  if (v === 0) return "0";
  if (Math.abs(v) < 10) return String(Math.round(v * 10) / 10);
  return String(Math.round(v));
}

export function formatBytes(b: number): string {
  if (b >= 1e9) return `${short(b / 1e9)} GB`;
  if (b >= 1e6) return `${short(b / 1e6)} MB`;
  if (b >= 1e3) return `${short(b / 1e3)} KB`;
  return `${Math.round(b)} B`;
}

/** A KPI value as people read it: "214", "46%", "148 MB". */
export function formatKpiValue(name: string, v: number): string {
  if (isRate(name)) return `${short(v * 100)}%`;
  if (name === "bytes_out_per_min") return formatBytes(v);
  if (name === SCREEN) return `${(Math.round(v * 10) / 10).toFixed(1)} s`;
  return short(v);
}

/** A stored line in the unit the Thresholds page shows (percent, MB). */
export function toInput(name: KpiName, v: number | null): string {
  if (v === null) return "";
  if (isRate(name)) return String(Math.round(v * 100 * 1e4) / 1e4);
  if (name === "bytes_out_per_min") return String(Math.round((v / 1e6) * 1e3) / 1e3);
  return String(v);
}

/** What an admin typed, as the value to store. Empty means no line; anything else unreadable is an error. */
export function fromInput(name: KpiName, text: string): { value: number | null } | { error: string } {
  const t = text.trim().replace(",", ".");
  if (t === "") return { value: null };
  const x = Number(t);
  if (!Number.isFinite(x) || x < 0) return { error: "Use a number of 0 or more, or leave it empty for no line." };
  if (isRate(name)) {
    if (x > 100) return { error: "A share of 100% or less." };
    return { value: Math.round((x / 100) * 1e8) / 1e8 };
  }
  if (name === "bytes_out_per_min") return { value: Math.round(x * 1e6) };
  return { value: x };
}

/** The toast when a KPI alert opens or turns critical: "Login failures: critical at 46%, over the 40% line." */
export function kpiAlertSentence(a: KpiAlert): string {
  const line = a.threshold === null ? "" : `, over the ${formatKpiValue(a.kpi, a.threshold)} line`;
  return `${kpiLabel(a.kpi)}: ${a.level === "crit" ? "critical" : "warning"} at ${formatKpiValue(a.kpi, a.value)}${line}.`;
}
