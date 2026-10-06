// Demo mode (?demo=1): scripted scenarios for presenting. Keys Shift+A, Shift+B, Shift+F, Shift+R.
// A small "DEMO" tab in the corner opens into the buttons on hover or keyboard focus, so it never
// covers the dashboard while presenting. Spec: docs/PAGES.md "Demo mode".
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { ScenarioName } from "../../data/scenarios/demo";
import { useNetra, useRankedIncidents } from "../../store/useNetra";
import styles from "./DemoDock.module.css";

const ACTIONS: { key: string; code: string; label: string; scenario?: ScenarioName }[] = [
  { key: "Shift+A", code: "KeyA", label: "Run credential stuffing", scenario: "credential_stuffing" },
  { key: "Shift+B", code: "KeyB", label: "Run flash crowd", scenario: "flash_crowd" },
  { key: "Shift+F", code: "KeyF", label: "Stall the feed", scenario: "feed_failure" },
  { key: "Shift+R", code: "KeyR", label: "Reset" },
];

export function DemoDock() {
  const [params] = useSearchParams();
  const enabled = params.get("demo") === "1";
  const available = useNetra((s) => s.demoAvailable);
  const demo = useNetra((s) => s.demo);
  const runScenario = useNetra((s) => s.runScenario);
  const resetDemo = useNetra((s) => s.resetDemo);
  const select = useNetra((s) => s.select);
  const ranked = useRankedIncidents();
  const focused = useRef<Set<string>>(new Set());
  const active = enabled && available;

  const trigger = (a: (typeof ACTIONS)[number]) => (a.scenario ? runScenario(a.scenario) : resetDemo());

  // Keyboard shortcuts.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const a = ACTIONS.find((x) => x.code === e.code);
      if (!a) return;
      e.preventDefault();
      if (a.scenario) runScenario(a.scenario);
      else resetDemo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, runScenario, resetDemo]);

  // When the scripted incident jumps into ACT NOW, select it (once per run).
  useEffect(() => {
    const id = demo.focusId;
    if (!id) {
      focused.current.clear(); // after a reset, incident numbers start again
      return;
    }
    if (focused.current.has(id)) return;
    if (ranked.find((i) => i.id === id)?.rank.tier === "ACT NOW") {
      focused.current.add(id);
      select({ kind: "incident", id });
    }
  }, [demo.focusId, ranked, select]);

  if (!active) return null;

  return (
    <div className={styles.dock}>
      <div className={styles.buttons} role="group" aria-label="Demo scenarios">
        {ACTIONS.map((a) => {
          const running = a.scenario !== undefined && demo.running === a.scenario;
          return (
            <button
              key={a.code}
              type="button"
              className={`${styles.button} ${running ? styles.running : ""}`}
              aria-keyshortcuts={a.key}
              title={a.key.toUpperCase()}
              disabled={a.scenario !== undefined && demo.running !== null && !running}
              aria-pressed={a.scenario ? running : undefined}
              onClick={() => trigger(a)}
            >
              {a.label}
            </button>
          );
        })}
      </div>
      <span className={styles.tab}>
        {demo.running && <i className={styles.dot} aria-hidden="true" />}
        DEMO
      </span>
    </div>
  );
}
