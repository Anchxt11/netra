// FIX: the incident's recommended fixes behind one rust button. Hover or focus fans the top three;
// click opens them full size over the incident card (Approve fix, Reject). Esc closes.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Incident } from "../../data/types";
import { useNetra } from "../../store/useNetra";
import { Fixes } from "./Fixes";
import styles from "./FixButton.module.css";

export function FixButton({ incident }: { incident: Incident }) {
  const [open, setOpen] = useState(false);
  const crie = useNetra((s) => s.health?.models.find((m) => m.name === "CRIE"));
  const record = useNetra((s) => s.decisions[incident.id]);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const crieReady = !crie || crie.status === "ready";
  const fixes = crieReady ? incident.fixes.filter((f) => !record?.rejected.includes(f.actionId)) : [];
  const approved = record?.approved && incident.fixes.find((f) => f.actionId === record.approved?.actionId);
  const sub = approved ? "approved" : fixes.length > 0 ? `${fixes.length} ${fixes.length === 1 ? "fix" : "fixes"}` : "standard fixes";

  // Open: focus moves into the dialog. Close: back to the button.
  useEffect(() => {
    if (open) dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className={styles.wrap} data-tour="fixes">
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.fix} ${approved ? styles.approved : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        Fix <span className={styles.sub}>{sub}</span>
      </button>

      {!approved && fixes.length > 0 && (
        <ol className={styles.fan} aria-hidden="true">
          {fixes.slice(0, 3).map((f, i) => (
            <li key={f.actionId} className={styles.card} style={{ "--i": i } as CSSProperties}>
              <span className={styles.cardMeta}>
                {i + 1} · {f.confidence.toFixed(2)} sure
              </span>
              <span className={styles.cardName}>{f.name}</span>
            </li>
          ))}
        </ol>
      )}

      {open && (
        <div
          ref={dialogRef}
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
          aria-label={`Recommended fixes for ${incident.name}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <div className={styles.overlayHead}>
            <h3 className={styles.overlayTitle}>Fixes for {incident.name.toLowerCase()}</h3>
            <button type="button" className={styles.close} onClick={close}>
              Close
            </button>
          </div>
          <Fixes incident={incident} bare />
        </div>
      )}
    </div>
  );
}
