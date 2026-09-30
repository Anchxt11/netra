// The real backend: a WebSocket that forwards the envelope messages in source.ts.
// The URL and message types are still (confirm) in docs/DATA_CONTRACT.md.
import type { ConnectionStatus, DataSource, Decision, ServerMessage } from "./source";

const TYPES = new Set(["incident.upsert", "incident.expire", "benign.upsert", "health", "hello"]);
const RETRY_MS = 2000;

function isServerMessage(value: unknown): value is ServerMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { type?: unknown; payload?: unknown };
  return typeof v.type === "string" && TYPES.has(v.type) && typeof v.payload === "object" && v.payload !== null;
}

export function createWsSource(url: string): DataSource {
  let socket: WebSocket | null = null;

  return {
    kind: "ws",

    connect(onMessage: (msg: ServerMessage) => void, onStatus: (status: ConnectionStatus) => void) {
      let stopped = false;
      let retry = 0;

      const open = () => {
        onStatus("connecting");
        socket = new WebSocket(url);
        socket.onopen = () => onStatus("open");
        socket.onmessage = (e) => {
          try {
            const msg: unknown = JSON.parse(String(e.data));
            if (isServerMessage(msg)) onMessage(msg);
          } catch {
            // Ignore anything that is not valid JSON in our envelope.
          }
        };
        socket.onclose = () => {
          onStatus("closed");
          if (!stopped) retry = window.setTimeout(open, RETRY_MS);
        };
      };

      open();
      return () => {
        stopped = true;
        window.clearTimeout(retry);
        socket?.close();
      };
    },

    sendDecision(decision: Decision) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "decision", payload: decision }));
      }
    },
  };
}
