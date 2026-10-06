import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // `--mode live`: the dashboard on the real backend (login, WebSocket), without editing .env files.
  if (mode === "live") process.env.VITE_DATA_SOURCE ??= "ws";
  return {
    plugins: [react()],
    server: { port: 5173 },
  };
});
