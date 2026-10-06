// The app's shared state. Fed only by the DataSource (mock or WebSocket); pages read from here.
import { useMemo } from "react";
import { create } from "zustand";
import type { BenignAnomaly, FeedEvent, Incident, KpiAlert, KpiPoint, KpiSnapshot, PipelineHealth, TrafficSecond } from "../data/types";
import {
  createDataSource,
  loginRequired,
  type ConnectionStatus,
  type DataSource,
  type Decision,
  type ServerMessage,
  type ThresholdControl,
} from "../data/source";
import { rankIncidents } from "../lib/rank";
import { SCENARIO_LENGTH_MS, type ScenarioName } from "../data/scenarios/demo";
import { SESSION_ENDED, useSession } from "./useSession";
import { kpiAlertSentence } from "../lib/kpiFormat";

const MAX_EXPIRED = 50;
const MAX_BENIGN = 20;
const EPS_HISTORY = 30;
const TRAFFIC_SECONDS = 60;
const FEED_LENGTH = 40;
const KPI_TREND_POINTS = 180; // 15 minutes of readings, one every 5 s
const MAX_KPI_ALERTS = 50;

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
  /** All traffic, one entry per second, last 60 seconds: the live feed's chart. */
  traffic: TrafficSecond[];
  /** Recent events, newest first: the live feed's list. */
  feed: FeedEvent[];
  /** The latest KPI reading (every 5 s), or null until the first one. */
  kpi: KpiSnapshot | null;
  /** Past readings, oldest first: the strip's small trends. */
  kpiTrend: KpiPoint[];
  /** KPI alerts by id, firing and recently cleared. */
  kpiAlerts: Record<string, KpiAlert>;
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

  // Screen state, not data.
  /** The boot screen is showing: the tour waits for it. */
  booting: boolean;
  /** The first-visit tour is open. */
  tourOpen: boolean;
  /** The dashboard section on the home page is on screen: the header shows its status readouts. */
  dashboardInView: boolean;
  setBooting: (booting: boolean) => void;
  setTourOpen: (open: boolean) => void;
  setDashboardInView: (inView: boolean) => void;
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
  traffic: [],
  feed: [],
  kpi: null,
  kpiTrend: [],
  kpiAlerts: {},
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

  booting: false,
  tourOpen: false,
  dashboardInView: false,
  setBooting: (booting) => set({ booting }),
  setTourOpen: (tourOpen) => set({ tourOpen }),
  setDashboardInView: (dashboardInView) => set({ dashboardInView }),

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
    set({ ...EMPTY, demo: { running: null, focusId: null } });
    source.demo.reset(); // replays the same seeded start
  },
}));

/** Everything that came from the source: cleared on a demo reset and on signing out. */
const EMPTY = {
  incidents: {},
  expired: [],
  benign: [],
  health: null,
  epsHistory: [],
  traffic: [],
  feed: [],
  kpi: null,
  kpiTrend: [],
  kpiAlerts: {},
  selection: null,
  decisions: {},
  toast: null,
} satisfies Partial<NetraState>;

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
    case "incident.remove":
      useNetra.setState((s) => {
        const { [msg.payload.id]: _gone, ...rest } = s.incidents;
        // Looking at an incident that just merged into another: follow it there.
        const follow = s.selection?.kind === "incident" && s.selection.id === msg.payload.id && msg.payload.into;
        return { incidents: rest, selection: follow ? { kind: "incident", id: msg.payload.into as string } : s.selection };
      });
      break;
    case "benign.upsert":
      useNetra.setState((s) => ({
        benign: [msg.payload, ...s.benign.filter((b) => b.id !== msg.payload.id)].slice(0, MAX_BENIGN),
      }));
      break;
    case "traffic":
      useNetra.setState((s) => ({
        traffic: [...s.traffic, msg.payload.second].slice(-TRAFFIC_SECONDS),
        feed: msg.payload.events.length ? [...msg.payload.events, ...s.feed].slice(0, FEED_LENGTH) : s.feed,
      }));
      break;
    case "kpi":
      useNetra.setState((s) => ({
        kpi: msg.payload,
        kpiTrend: [...s.kpiTrend, { t: msg.payload.computedAt, values: Object.fromEntries(msg.payload.kpis.map((k) => [k.name, k.value1m])) }].slice(-KPI_TREND_POINTS),
      }));
      break;
    case "kpi_history":
      useNetra.setState({ kpiTrend: msg.payload.slice(-KPI_TREND_POINTS) });
      break;
    case "kpi_alert":
      useNetra.setState((s) => {
        const a = msg.payload;
        const key = String(a.id ?? `${a.origin}:${a.kpi}:${a.startedAt}`);
        const prev = s.kpiAlerts[key];
        if (prev && Date.parse(prev.updatedAt) > Date.parse(a.updatedAt)) return s; // an older copy (REST after the socket)
        const kept = Object.entries({ ...s.kpiAlerts, [key]: a })
          .sort(([, x], [, y]) => Date.parse(y.updatedAt) - Date.parse(x.updatedAt))
          .slice(0, MAX_KPI_ALERTS);
        const opened = a.state === "firing" && (!prev || prev.state !== "firing" || (prev.level === "warn" && a.level === "crit"));
        return {
          kpiAlerts: Object.fromEntries(kept),
          toast: opened ? { id: (s.toast?.id ?? 0) + 1, text: kpiAlertSentence(a), tone: "neutral" as const } : s.toast,
        };
      });
      break;
    case "health":
      useNetra.setState((s) => ({
        health: msg.payload,
        epsHistory: [...s.epsHistory, msg.payload.feed === "live" ? msg.payload.eventsPerSec : 0].slice(-EPS_HISTORY),
      }));
      break;
  }
}

/** The KPI lines, read and changed through whichever source is connected. */
export function thresholdControl(): ThresholdControl | null {
  return source?.thresholds ?? null;
}

function onStatus(connection: ConnectionStatus) {
  useNetra.setState({ connection });
  if (connection === "unauthorized") useSession.getState().signOut(SESSION_ENDED);
}

/** Connect the data source once, and start the one-second clock. Safe to call twice. */
export function startNetra() {
  if (source) return;
  const s = createDataSource();
  source = s;
  useNetra.setState({ simulated: s.kind === "mock", demoAvailable: Boolean(s.demo) });
  window.setInterval(() => useNetra.setState((st) => ({ now: Date.now() + st.clockOffsetMs })), 1000);

  if (!loginRequired) {
    s.connect(apply, onStatus);
    return;
  }
  // The real backend: connected while someone is signed in. Signing out clears the screen.
  let disconnect: (() => void) | null = null;
  const sync = (signedIn: boolean) => {
    if (signedIn && !disconnect) {
      useNetra.setState({ connection: "connecting" });
      disconnect = s.connect(apply, onStatus);
    } else if (!signedIn && disconnect) {
      disconnect();
      disconnect = null;
      useNetra.setState({ ...EMPTY, connection: "connecting", clockOffsetMs: 0 });
    }
  };
  sync(Boolean(useSession.getState().session));
  useSession.subscribe((st) => sync(Boolean(st.session)));
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
