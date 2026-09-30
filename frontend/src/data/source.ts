// The ONE interface the frontend talks to. Two implementations: the mock engine
// (default) and the real WebSocket. Swapping them needs no UI changes.
import type { BenignAnomaly, Incident, PipelineHealth } from "./types";
import type { ScenarioName } from "./scenarios/demo";
import { createMockSource } from "./mockEngine";
import { createWsSource } from "./wsSource";

/** Messages from the backend, in the WebSocket envelope { type, payload }. */
export type ServerMessage =
  | { type: "incident.upsert"; payload: Incident }
  | { type: "incident.expire"; payload: { id: string } }
  | { type: "benign.upsert"; payload: BenignAnomaly }
  | { type: "health"; payload: PipelineHealth }
  | { type: "hello"; payload: { serverTime: string } };

/** Frontend to backend: an analyst approved or rejected a recommended fix. */
export interface Decision {
  incidentId: string;
  actionId: string;
  decision: "approve" | "reject";
}

export type ConnectionStatus = "connecting" | "open" | "closed";

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
  readonly demo?: DemoControl;
}

export function createDataSource(): DataSource {
  if (import.meta.env.VITE_DATA_SOURCE === "ws") {
    return createWsSource(import.meta.env.VITE_WS_URL ?? "ws://localhost:8000/ws");
  }
  return createMockSource();
}
