// The app's shared state. Fed only by the DataSource (mock or WebSocket); pages read from here.
import { useMemo } from "react";
import { create } from "zustand";
import type { BenignAnomaly, Incident, PipelineHealth } from "../data/types";
import { createDataSource, type ConnectionStatus, type DataSource, type Decision, type ServerMessage } from "../data/source";
import { rankIncidents } from "../lib/rank";
import { SCENARIO_LENGTH_MS, type ScenarioName } from "../data/scenarios/demo";

const MAX_EXPIRED = 50;
const MAX_BENIGN = 20;
const EPS_HISTORY = 30;

/** Exactly one thing is selected: an incident, or a judged-normal item. */
export type Selection = { kind: "incident" | "benign"; id: string } | null;

/** What the analyst decided on one incident's fixes, in this session. */
export interface DecisionRecord {
  approved?: { actionId: string; at: number };
  rejected: string[]; // action ids
}

export interface Toast {
  id: number;
  text: string;
  tone: "ok" | "neutral";
}

const TOAST_TEXT = {
  approve: "Fix approved. Saved as training data for both engines.",
  reject: "Fix rejected. Saved as training data for both engines.",
};

interface NetraState {
  /** True on mock data: shows the SIMULATED FEED chip. The only place the source leaks into the UI. */
  simulated: boolean;
  connection: ConnectionStatus;
  /** Server time minus local time, from the "hello" message. */
  clockOffsetMs: number;
  /** Ticks once a second; countdowns, heat and ranking all read it. */
  now: number;
  incidents: Record<string, Incident>; // open and decided
  expired: Incident[]; // newest first
  benign: BenignAnomaly[]; // newest first
  health: PipelineHealth | null;
  /** Events per second, last 30 health messages: drives the live trace in the top bar. */
  epsHistory: number[];
  selection: Selection;
  decisions: Record<string, DecisionRecord>; // by incident id
  toast: Toast | null;
  /** Demo mode: can the source play scripted scenarios, and which one is playing. */
  demoAvailable: boolean;
  demo: { running: ScenarioName | null; focusId: string | null };
  runScenario: (name: ScenarioName) => void;
  resetDemo: () => void;
  select: (selection: Selection) => void;
  /** Approve or reject a fix. Updates the screen at once, then the source confirms. */
  decide: (decision: Decision) => void;
  dismissToast: () => void;
}

let source: DataSource | null = null;

export const useNetra = create<NetraState>()((set) => ({
  simulated: false,
  connection: "connecting",
  clockOffsetMs: 0,
  now: Date.now(),
  incidents: {},
  expired: [],
  benign: [],
  health: null,
  epsHistory: [],
  selection: null,
  decisions: {},
  toast: null,
  select: (selection) => set({ selection }),
  decide: (d) => {
    // Optimistic: the analyst sees the result immediately; the source's next messages confirm it.
    set((s) => {
      const prev = s.decisions[d.incidentId] ?? { rejected: [] };
      const record: DecisionRecord =
        d.decision === "approve"
          ? { ...prev, approved: { actionId: d.actionId, at: s.now } }
          : { ...prev, rejected: [...prev.rejected, d.actionId] };
      const inc = s.incidents[d.incidentId];
      const health = s.health && {
        ...s.health,
        decisions: {
          approved: s.health.decisions.approved + (d.decision === "approve" ? 1 : 0),
          rejected: s.health.decisions.rejected + (d.decision === "reject" ? 1 : 0),
        },
      };
      return {
        decisions: { ...s.decisions, [d.incidentId]: record },
        incidents: inc && d.decision === "approve" ? { ...s.incidents, [inc.id]: { ...inc, status: "approved" as const } } : s.incidents,
        health,
        toast: { id: (s.toast?.id ?? 0) + 1, text: TOAST_TEXT[d.decision], tone: d.decision === "approve" ? "ok" : "neutral" },
      };
    });
    source?.sendDecision(d);
  },
  dismissToast: () => set({ toast: null }),

  demoAvailable: false,
  demo: { running: null, focusId: null },
  runScenario: (name) => {
    if (!source?.demo || useNetra.getState().demo.running) return;
    const focusId = source.demo.run(name);
    set({ demo: { running: name, focusId } });
    window.clearTimeout(demoTimer);
    demoTimer = window.setTimeout(() => set((s) => ({ demo: { ...s.demo, running: null } })), SCENARIO_LENGTH_MS[name]);
  },
  resetDemo: () => {
    if (!source?.demo) return;
    window.clearTimeout(demoTimer);
    set({
      incidents: {},
      expired: [],
      benign: [],
      health: null,
      epsHistory: [],
      selection: null,
      decisions: {},
      toast: null,
      demo: { running: null, focusId: null },
    });
    source.demo.reset(); // replays the same seeded start
  },
}));

let demoTimer = 0;

function apply(msg: ServerMessage) {
  switch (msg.type) {
    case "hello":
      useNetra.setState({ clockOffsetMs: Date.parse(msg.payload.serverTime) - Date.now() });
      break;
    case "incident.upsert":
      useNetra.setState((s) => ({ incidents: { ...s.incidents, [msg.payload.id]: msg.payload } }));
      break;
    case "incident.expire":
      useNetra.setState((s) => {
        const inc = s.incidents[msg.payload.id];
        if (!inc) return s;
        const { [msg.payload.id]: _gone, ...rest } = s.incidents;
        return { incidents: rest, expired: [{ ...inc, status: "expired" as const }, ...s.expired].slice(0, MAX_EXPIRED) };
      });
      break;
    case "benign.upsert":
      useNetra.setState((s) => ({
        benign: [msg.payload, ...s.benign.filter((b) => b.id !== msg.payload.id)].slice(0, MAX_BENIGN),
      }));
      break;
    case "health":
      useNetra.setState((s) => ({
        health: msg.payload,
        epsHistory: [...s.epsHistory, msg.payload.feed === "live" ? msg.payload.eventsPerSec : 0].slice(-EPS_HISTORY),
      }));
      break;
  }
}

/** Connect the data source once, and start the one-second clock. Safe to call twice. */
export function startNetra() {
  if (source) return;
  source = createDataSource();
  useNetra.setState({ simulated: source.kind === "mock", demoAvailable: Boolean(source.demo) });
  source.connect(apply, (connection) => useNetra.setState({ connection }));
  window.setInterval(() => useNetra.setState((s) => ({ now: Date.now() + s.clockOffsetMs })), 1000);
}

/** Open incidents in queue order. The only ranking in the app: src/lib/rank.ts. */
export function useRankedIncidents() {
  const incidents = useNetra((s) => s.incidents);
  const now = useNetra((s) => s.now);
  return useMemo(
    () =>
      rankIncidents(
        Object.values(incidents).filter((i) => i.status === "open"),
        now,
      ),
    [incidents, now],
  );
}
