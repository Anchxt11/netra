// Once per session, about 1.6 s, skippable. Every status line reads the real store: nothing is faked.
import { useEffect, useRef, useState } from "react";
import type { ModelStatus } from "../data/types";
import { RULES } from "../data/catalog";
import { useNetra } from "../store/useNetra";
import styles from "./BootScreen.module.css";

const DURATION_MS = 1600;
const SEGMENTS = 20;
const RULE_COUNT = Object.keys(RULES).length;

type Tone = "ok" | "muted" | "fail";

function modelLine(m: ModelStatus | undefined): [string, Tone] {
  if (!m) return ["...", "muted"];
  if (m.status === "failed") return ["FAILED", "fail"];
  if (m.status === "pending") return ["PENDING", "muted"];
  if (m.status === "training") return ["TRAINING", "muted"];
  if (m.version === "example") return ["EXAMPLE", "muted"];
  return [`v${m.version} READY`, "ok"];
}

export function BootScreen({ onDone }: { onDone: () => void }) {
  const connection = useNetra((s) => s.connection);
  const simulated = useNetra((s) => s.simulated);
  const models = useNetra((s) => s.health?.models);
  const [leaving, setLeaving] = useState(false);
  const skipRef = useRef<HTMLButtonElement>(null);

  const finish = () => setLeaving(true);

  useEffect(() => {
    skipRef.current?.focus();
    const t = window.setTimeout(finish, DURATION_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(onDone, 200);
    return () => window.clearTimeout(t);
  }, [leaving, onDone]);

  const feed: [string, Tone] =
    connection === "open" ? (simulated ? ["SIMULATED FEED", "muted"] : ["OK", "ok"]) : connection === "closed" ? ["OFFLINE", "fail"] : ["...", "muted"];
  const lines: [string, [string, Tone]][] = [
    ["CONNECTING TO LIVE FEED", feed],
    [`LOADING ${RULE_COUNT} DETECTION RULES`, ["OK", "ok"]],
    ["ATDE", modelLine(models?.find((m) => m.name === "ATDE"))],
    ["CRIE", modelLine(models?.find((m) => m.name === "CRIE"))],
  ];

  return (
    <div className={`${styles.boot} ${leaving ? styles.leaving : ""}`} role="dialog" aria-label="Starting NETRA" onClick={finish}>
      <p className={styles.motto}>
        WE WATCH THE STREAM.
        <br />
        YOU MAKE THE CALL.
      </p>

      <div className={styles.centre}>
        <span className={styles.mark} role="img" aria-label="NETRA" />
        <p className={styles.tagline}>REAL-TIME THREAT TRIAGE</p>
        <ul className={styles.lines}>
          {lines.map(([label, [status, tone]], i) => (
            <li key={label} style={{ animationDelay: `${150 + i * 180}ms` }}>
              <span>{label}</span>
              <span className={styles.leader} aria-hidden="true" />
              <span className={styles[tone]}>{status}</span>
            </li>
          ))}
        </ul>
        <div className={styles.bar} aria-hidden="true">
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <i key={i} style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
      </div>

      <button ref={skipRef} type="button" className={styles.skip} onClick={finish}>
        SKIP
      </button>
    </div>
  );
}
