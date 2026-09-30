// The ONE interface the frontend talks to. Two implementations: the mock engine
// (default) and the real WebSocket. Swapping them needs no UI changes.
import type { BenignAnomaly, Incident, PipelineHealth } from "./types";
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

export interface DataSource {
  /** Only used to show the SIMULATED FEED chip. Nothing else may branch on it. */
  readonly kind: "mock" | "ws";
  /** Start receiving messages. Returns a function that disconnects. */
  connect(onMessage: (msg: ServerMessage) => void, onStatus: (status: ConnectionStatus) => void): () => void;
  sendDecision(decision: Decision): void;
}

export function createDataSource(): DataSource {
  if (import.meta.env.VITE_DATA_SOURCE === "ws") {
    return createWsSource(import.meta.env.VITE_WS_URL ?? "ws://localhost:8000/ws");
  }
  return createMockSource();
}
