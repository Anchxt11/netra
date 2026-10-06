// The ONE interface the frontend talks to. Two implementations: the mock engine
// (default) and the real backend. Swapping them needs no UI changes.
import type {
  BenignAnomaly,
  FeedEvent,
  Incident,
  KpiAlert,
  KpiName,
  KpiPoint,
  KpiSnapshot,
  KpiThresholds,
  PipelineHealth,
  TrafficSecond,
} from "./types";
import type { ScenarioName } from "./scenarios/demo";
import { createMockSource } from "./mockEngine";
import { createBackendSource } from "./backend/backendSource";
import { useSession } from "../store/useSession";

/** What a source tells the dashboard, in the envelope { type, payload }. */
export type ServerMessage =
  | { type: "incident.upsert"; payload: Incident }
  | { type: "incident.expire"; payload: { id: string } }
  /** Merged into another incident (`into`): gone without expiring. */
  | { type: "incident.remove"; payload: { id: string; into?: string } }
  | { type: "benign.upsert"; payload: BenignAnomaly }
  | { type: "health"; payload: PipelineHealth }
  /** Once a second: counts for all traffic, and a sample of the events behind them. */
  | { type: "traffic"; payload: { second: TrafficSecond; events: FeedEvent[] } }
  /** Every 5 s: the five live KPIs (contracts/LIVE_API.md 4.1). */
  | { type: "kpi"; payload: KpiSnapshot }
  /** The last few minutes of KPI readings, so the strip's trend is not empty after a (re)connect. */
  | { type: "kpi_history"; payload: KpiPoint[] }
  /** A KPI alert opened, changed level or cleared (contracts/LIVE_API.md 4.2). */
  | { type: "kpi_alert"; payload: KpiAlert }
  | { type: "hello"; payload: { serverTime: string } };

/** Frontend to backend: an analyst approved or rejected a recommended fix. */
export interface Decision {
  incidentId: string;
  actionId: string;
  decision: "approve" | "reject";
}

/** The KPI lines: anyone may read them, only an admin may change them on the real backend. */
export interface ThresholdControl {
  get(): Promise<KpiThresholds>;
  /** `value` null removes the line. Rejects with a message to show when it was not saved. */
  set(name: KpiName, level: "warn" | "crit", value: number | null): Promise<void>;
}

/** "closed" = lost, retrying. "unauthorized" = the login is no longer valid: sign in again. */
export type ConnectionStatus = "connecting" | "open" | "closed" | "unauthorized";

/** Scripted demo scenarios (?demo=1). Only a source that can play them provides this. */
export interface DemoControl {
  /** Returns the id of the incident the scenario will create, if it creates one. */
  run(name: ScenarioName): string | null;
  reset(): void;
}

export interface DataSource {
  /** Only used to show the SIMULATED FEED chip. Nothing else may branch on it. */
  readonly kind: "mock" | "ws";
  /** Start receiving messages. Returns a function that disconnects. */
  connect(onMessage: (msg: ServerMessage) => void, onStatus: (status: ConnectionStatus) => void): () => void;
  sendDecision(decision: Decision): void;
  readonly thresholds: ThresholdControl;
  readonly demo?: DemoControl;
}

const live = import.meta.env.VITE_DATA_SOURCE === "ws";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000/ws";
/** REST lives next to the WebSocket unless set: ws://host:8000/ws -> http://host:8000 */
export const API_URL = import.meta.env.VITE_API_URL ?? WS_URL.replace(/^ws/, "http").replace(/\/ws\/?$/, "");

/** The real backend has accounts (analyst, admin); the simulated feed is open to everyone. */
export const loginRequired = live;

export function createDataSource(): DataSource {
  if (live) return createBackendSource({ apiUrl: API_URL, wsUrl: WS_URL, getToken: () => useSession.getState().session?.token ?? null });
  return createMockSource();
}
