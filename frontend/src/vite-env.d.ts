/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: "mock" | "ws";
  readonly VITE_WS_URL?: string;
  /** Backend REST base. Defaults to the WebSocket's host: ws://localhost:8000/ws -> http://localhost:8000 */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
