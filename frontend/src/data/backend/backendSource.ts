// The real backend as a DataSource: the WebSocket at /ws?token=… plus a few REST calls.
// Turns the backend's messages ({ type, data, server_ts }) into the dashboard's own (source.ts),
// so nothing in the UI changes with the source.
import type { ConnectionStatus, DataSource, Decision, ServerMessage } from "../source";
import { ApiError, createApi } from "./api";
import { Correlator } from "./correlate";
import { HealthTracker } from "./health";
import { isRealModel } from "./rules";
import type { AlertRow, BackendMessage, EnrichedEvent } from "./types";

const FRESHNESS_EVERY_MS = 5_000;
const SERVER_HEALTH_EVERY_MS = 10_000;
const MAX_RETRY_MS = 10_000;
const UNAUTHORIZED = 4401; // the backend closes the socket with this code on a bad or expired token

interface Options {
  apiUrl: string;
  wsUrl: string;
  getToken: () => string | null;
}

/** ClickHouse returns "2026-10-06 10:00:00.123" (UTC, no zone): make it ISO so the browser does not read it as local time. */
function utc(ts: string): string {
  return /^\d{4}-\d\d-\d\d \d/.test(ts) && !/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? `${ts.replace(" ", "T")}Z` : ts;
}
const normalise = (ev: EnrichedEvent): EnrichedEvent => ({ ...ev, event_ts: utc(String(ev.event_ts)) });

function parse(data: unknown): BackendMessage | null {
  try {
    const msg = JSON.parse(String(data)) as BackendMessage;
    return typeof msg?.type === "string" ? msg : null;
  } catch {
    return null;
  }
}

export function createBackendSource({ apiUrl, wsUrl, getToken }: Options): DataSource {
  const api = createApi(apiUrl);
  let correlator: Correlator | null = null;
  let tracker: HealthTracker | null = null;
  let username = "";
  const log = new Map<string, string[]>(); // decisions per incident, written to the backend row's notes

  return {
    kind: "ws",

    connect(onMessage: (msg: ServerMessage) => void, onStatus: (status: ConnectionStatus) => void) {
      let stopped = false;
      let socket: WebSocket | null = null;
      let retry = 0;
      let attempt = 0;
      let offset = 0; // server clock minus ours, from "hello"
      const now = () => Date.now() + offset;

      const health = new HealthTracker();
      const corr = new Correlator({
        upsert: (incident) => onMessage({ type: "incident.upsert", payload: incident }),
        remove: (id, into) => onMessage({ type: "incident.remove", payload: { id, into } }),
        expire: (id) => {
          health.expiredOne();
          onMessage({ type: "incident.expire", payload: { id } });
        },
      });
      correlator = corr;
      tracker = health;

      const unauthorized = () => {
        stopped = true;
        socket?.close();
        onStatus("unauthorized");
      };

      const alert = (row: AlertRow) => {
        if (corr.addAlert(row, now())) {
          const model = !row.rule_id && isRealModel(row.model) ? row.model : null;
          health.detection(model, Date.parse(row.created_ts) || now());
        }
      };

      // On every (re)connect: the recent past, so a reload does not start from an empty screen.
      const backfill = async (token: string) => {
        try {
          const [events, alerts] = await Promise.all([api.recentEvents(token), api.recentAlerts(token)]);
          if (stopped) return;
          corr.addEvents(events.map(normalise).reverse(), now()); // the API returns newest first
          for (const row of [...alerts].reverse()) alert(row);
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) unauthorized();
          // Otherwise carry on live: history is a nice-to-have.
        }
      };

      const handle = (msg: BackendMessage) => {
        switch (msg.type) {
          case "hello":
            offset = Date.parse(msg.server_ts) - Date.now() || 0;
            username = msg.data.username;
            onMessage({ type: "hello", payload: { serverTime: msg.server_ts } });
            break;
          case "events": {
            const batch = (msg.data ?? []).map(normalise);
            corr.addEvents(batch, now());
            health.events(batch.length + (msg.dropped ?? 0), now());
            break;
          }
          case "alert":
            alert(msg.data);
            break;
          // incident_update (a status change made elsewhere) and pong need nothing on screen yet.
        }
      };

      let wasOpen = false;
      const open = () => {
        const token = getToken();
        if (!token) return unauthorized();
        if (!wasOpen) onStatus("connecting"); // a retry stays "closed" (RECONNECTING) until it works
        const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
        socket = ws;
        ws.onopen = () => {
          wasOpen = true;
          attempt = 0;
          health.setConnected(true, now());
          onMessage({ type: "health", payload: health.snapshot(now()) }); // not a second-old "stalled"
          onStatus("open");
          void backfill(token);
        };
        ws.onmessage = (e) => {
          const msg = parse(e.data);
          if (msg) handle(msg);
        };
        ws.onclose = (e) => {
          if (socket === ws) socket = null;
          health.setConnected(false, now());
          if (stopped) return;
          if (e.code === UNAUTHORIZED) return unauthorized();
          onStatus("closed");
          retry = window.setTimeout(open, Math.min(MAX_RETRY_MS, 1000 * 2 ** attempt++));
        };
      };

      const pollFreshness = () =>
        api.freshness().then(
          (r) => health.setFreshness(r, now()),
          () => health.setFreshness(null, now()),
        );
      const pollServer = () => api.health().then((h) => health.setServer(h), () => health.setServer(null));

      const timers = [
        window.setInterval(() => {
          corr.tick(now());
          onMessage({ type: "health", payload: health.snapshot(now()) });
        }, 1000),
        window.setInterval(pollFreshness, FRESHNESS_EVERY_MS),
        window.setInterval(pollServer, SERVER_HEALTH_EVERY_MS),
      ];
      void pollFreshness();
      void pollServer();
      open();

      return () => {
        stopped = true;
        timers.forEach((t) => window.clearInterval(t));
        window.clearTimeout(retry);
        socket?.close();
        correlator = null;
        tracker = null;
        log.clear();
      };
    },

    /** Recorded on the backend: the first alert row of the incident gets the decision log in its notes. */
    sendDecision(d: Decision) {
      tracker?.decided(d.decision);
      const token = getToken();
      const row = correlator?.rowsOf(d.incidentId)[0];
      if (!token || row === undefined) return;
      const line = `${new Date().toISOString()} ${username || "analyst"} ${d.decision === "approve" ? "APPROVED" : "REJECTED"} ${d.actionId}`;
      const lines = [...(log.get(d.incidentId) ?? []), line];
      log.set(d.incidentId, lines);
      const health = tracker;
      void api
        .updateIncident(token, row, { notes: lines.join("\n"), ...(d.decision === "approve" ? { status: "acknowledged" as const } : {}) })
        .catch(() => health?.decisionNotSaved(Date.now())); // the screen shows the decision, so say it was not logged
    },
  };
}
