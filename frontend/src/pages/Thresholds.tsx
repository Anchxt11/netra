// /thresholds: where each live KPI turns to warning and critical. Admins change the lines; the API
// stores them in its config table (PUT /config/kpi.<name>.warn|crit) and the next reading uses them.
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { KPI_ORDER } from "../data/kpi";
import type { KpiName, KpiThresholds } from "../data/types";
import { useCanEditThresholds } from "../features/kpi/canEdit";
import { formatKpiValue, fromInput, kpiInputUnit, kpiLabel, toInput } from "../lib/kpiFormat";
import { thresholdControl, useNetra } from "../store/useNetra";
import { useSession } from "../store/useSession";
import styles from "./Thresholds.module.css";

type Level = "warn" | "crit";

export default function Thresholds() {
  const canEdit = useCanEditThresholds();
  const simulated = useNetra((s) => s.simulated);
  const user = useSession((s) => s.session?.user);
  const [lines, setLines] = useState<KpiThresholds | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const control = thresholdControl();
    if (!control) {
      setLoadError("Not connected yet. Open the dashboard first, then come back.");
      return;
    }
    let live = true;
    control.get().then(
      (t) => live && setLines(t),
      (e: unknown) => live && setLoadError(e instanceof Error ? e.message : "The thresholds could not be read."),
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Thresholds</h1>
        <p className={styles.lead}>
          Where each live KPI turns to warning and critical. A reading at or over a line counts; two readings in a row
          (10 seconds) raise an alert, and two normal readings clear it. Changes apply from the next reading.
        </p>
        {simulated && <p className={styles.note}>Simulated feed: these lines change only this simulation, in this tab.</p>}
        {!canEdit && (
          <p className={styles.note} role="status">
            Only an admin can change thresholds. You are signed in as {user?.username ?? "an analyst"}.
          </p>
        )}
      </header>

      <section className={styles.card} aria-label="KPI lines">
        <div className={`${styles.row} ${styles.header}`} aria-hidden="true">
          <span>KPI</span>
          <span>Now</span>
          <span>Warning at</span>
          <span>Critical at</span>
          <span />
        </div>
        {loadError && <p className={styles.error}>{loadError}</p>}
        {!lines && !loadError && <p className={styles.waiting}>Reading the lines.</p>}
        {lines &&
          KPI_ORDER.map(({ name }) => (
            <ThresholdRow
              key={name}
              name={name}
              saved={lines[name]}
              canEdit={canEdit}
              onSaved={(v) => setLines((l) => (l ? { ...l, [name]: v } : l))}
            />
          ))}
      </section>

      <Link to="/live" className={styles.back}>
        Back to the dashboard
      </Link>
    </div>
  );
}

function ThresholdRow({
  name,
  saved,
  canEdit,
  onSaved,
}: {
  name: KpiName;
  saved: { warn: number | null; crit: number | null };
  canEdit: boolean;
  onSaved: (v: { warn: number | null; crit: number | null }) => void;
}) {
  const now = useNetra((s) => s.kpi?.kpis.find((k) => k.name === name)?.value1m ?? null);
  const [text, setText] = useState({ warn: toInput(name, saved.warn), crit: toInput(name, saved.crit) });
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const unit = kpiInputUnit(name);
  const dirty = text.warn !== toInput(name, saved.warn) || text.crit !== toInput(name, saved.crit);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const warn = fromInput(name, text.warn);
    const crit = fromInput(name, text.crit);
    if ("error" in warn || "error" in crit) {
      setStatus({ tone: "error", text: ("error" in warn ? warn.error : "") || ("error" in crit ? crit.error : "") });
      return;
    }
    if (warn.value !== null && crit.value !== null && warn.value > crit.value) {
      setStatus({ tone: "error", text: "The warning line must be at or below the critical line." });
      return;
    }
    const control = thresholdControl();
    if (!control) return;
    setBusy(true);
    setStatus(null);
    try {
      const next = { warn: warn.value, crit: crit.value };
      for (const level of ["warn", "crit"] as Level[]) {
        if (next[level] !== saved[level]) await control.set(name, level, next[level]);
      }
      onSaved(next);
      setText({ warn: toInput(name, next.warn), crit: toInput(name, next.crit) });
      setStatus({ tone: "ok", text: "Saved. The next reading uses these lines." });
    } catch (err) {
      setStatus({ tone: "error", text: err instanceof Error ? err.message : "Not saved." });
    } finally {
      setBusy(false);
    }
  };

  const field = (level: Level) => (
    <label className={styles.field}>
      <span className="visually-hidden">
        {kpiLabel(name)}, {level === "warn" ? "warning" : "critical"} line, in {unit}
      </span>
      <input
        className={styles.input}
        inputMode="decimal"
        value={text[level]}
        placeholder="no line"
        disabled={!canEdit || busy}
        onChange={(e) => {
          setText((t) => ({ ...t, [level]: e.target.value }));
          setStatus(null);
        }}
      />
      <span className={styles.unit} aria-hidden="true">
        {unit}
      </span>
    </label>
  );

  return (
    <form className={styles.row} onSubmit={save} noValidate>
      <span className={styles.name}>{kpiLabel(name)}</span>
      <span className={styles.now}>{now === null ? "PENDING" : formatKpiValue(name, now)}</span>
      {field("warn")}
      {field("crit")}
      <span className={styles.actions}>
        {canEdit && (
          <Button variant="reject" type="submit" disabled={!dirty || busy}>
            {busy ? "Saving" : "Save"}
          </Button>
        )}
      </span>
      <p className={status?.tone === "error" ? styles.rowError : styles.rowOk} role="status" aria-live="polite">
        {status?.text ?? ""}
      </p>
    </form>
  );
}
