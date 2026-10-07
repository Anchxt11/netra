// The real backend as a DataSource: the WebSocket at /ws?token=… plus a few REST calls.
// Turns the backend's messages ({ type, data, server_ts }) into the dashboard's own (source.ts),
// so nothing in the UI changes with the source.
import type { ConnectionStatus, DataSource, Decision, ServerMessage } from "../source";
import { ApiError, createApi } from "./api";
import { Correlator } from "./correlate";
import { HealthTracker } from "./health";
import { ScreenTimer } from "./screenTime";
import { kpiAlertFromApi, kpiHistoryFromApi, kpiSnapshotFromApi, thresholdsFromConfig } from "./kpi";
import { isRealModel } from "./rules";
import { TrafficMeter } from "./traffic";
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
      const meter = new TrafficMeter();
      const screen = new ScreenTimer(); // time to screen, p95 per minute (docs/SLA.md)
      const screenAlert = (a: ReturnType<ScreenTimer["tick"]>) => {
        health.setScreenTime(screen.minutes());
        if (a) onMessage({ type: "kpi_alert", payload: a });
      };
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

      const alert = (row: AlertRow, live = true) => {
        if (corr.addAlert(row, now())) {
          const byModel = !row.rule_id && isRealModel(row.model);
          health.detection(byModel, Date.parse(row.created_ts) || now());
          // The model's own score: an event's risk_score comes from the placeholder scorer.
          if (byModel && live) meter.addAi(corr.event(row.event_ids?.[0]), row.risk_score ?? row.anomaly_score ?? undefined);
        }
      };

      // The ops service's jobs and open alerts. Without it (404, or not running yet) SYSTEM shows PENDING.
      const backfillOps = async (token: string) => {
        try {
          const [jobs, ops] = await Promise.all([api.jobs(token), api.opsAlerts(token)]);
          if (stopped) return;
          health.setJobs(jobs);
          for (const a of ops) health.opsAlert(a);
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) unauthorized();
        }
      };

      // Which models are running. An API without /models (404): ATDE and CRIE stay PENDING.
      const backfillModels = async (token: string) => {
        try {
          const models = await api.models(token);
          if (!stopped) health.setModels(models);
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) unauthorized();
        }
      };

      // The KPI strip's past and any alert still open. An API without KPIs answers 404: the strip shows PENDING.
      const backfillKpi = async (token: string) => {
        try {
          const [report, firing] = await Promise.all([api.kpi(token), api.kpiAlerts(token)]);
          if (stopped) return;
          onMessage({ type: "kpi_history", payload: kpiHistoryFromApi(report) });
          for (const w of [...firing].reverse()) {
            const a = kpiAlertFromApi(w);
            if (a) onMessage({ type: "kpi_alert", payload: a });
          }
          if (report.latest) onMessage({ type: "kpi", payload: kpiSnapshotFromApi(report.latest) });
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) unauthorized();
        }
      };

      // On every (re)connect: the recent past, so a reload does not start from an empty screen.
      const backfill = async (token: string) => {
        try {
          const [events, alerts] = await Promise.all([api.recentEvents(token), api.recentAlerts(token)]);
          if (stopped) return;
          corr.addEvents(events.map(normalise).reverse(), now()); // the API returns newest first
          for (const row of [...alerts].reverse()) alert(row, false);
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
            const received = Date.now();
            for (const ev of batch) screenAlert(screen.record(ev.event_ts, received, offset));
            corr.addEvents(batch, now());
            health.events(batch.length + (msg.dropped ?? 0), now());
            meter.addEvents(batch, msg.dropped ?? 0);
            break;
          }
          case "alert":
            alert(msg.data);
            break;
          case "job_runs":
            for (const r of msg.data ?? []) health.jobRun(r);
            break;
          case "ops_alert":
            health.opsAlert(msg.data);
            break;
          case "models":
            health.setModels(msg.data ?? []);
            break;
          case "kpi":
            onMessage({ type: "kpi", payload: kpiSnapshotFromApi(msg.data) });
            break;
          case "kpi_alert": {
            const a = kpiAlertFromApi(msg.data);
            if (a) onMessage({ type: "kpi_alert", payload: a });
            break;
          }
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
          void backfillKpi(token);
          void backfillOps(token);
          void backfillModels(token);
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
          screenAlert(screen.tick(now()));
          onMessage({ type: "health", payload: health.snapshot(now()) });
          onMessage({ type: "traffic", payload: meter.flush(now()) });
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

    // GET /config for anyone signed in; PUT /config is admin only (the API answers 403 otherwise).
    thresholds: {
      async get() {
        const token = getToken();
        if (!token) throw new Error("Sign in to see the thresholds.");
        return thresholdsFromConfig(await api.config(token));
      },
      async set(name, level, value) {
        const token = getToken();
        if (!token) throw new Error("Sign in to change the thresholds.");
        try {
          await api.putConfig(token, `kpi.${name}.${level}`, value);
        } catch (e) {
          if (e instanceof ApiError && e.status === 403) throw new Error("Only an admin can change thresholds.");
          if (e instanceof ApiError && e.status === 0) throw new Error("The server cannot be reached. Nothing was saved.");
          throw new Error("The server did not save this line. Nothing changed.");
        }
      },
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
      if (d.decision === "approve") correlator?.close(d.incidentId);
      const health = tracker;
      void api
        .updateIncident(token, row, { notes: lines.join("\n"), ...(d.decision === "approve" ? { status: "acknowledged" as const } : {}) })
        .catch(() => health?.decisionNotSaved(Date.now())); // the screen shows the decision, so say it was not logged
    },
  };
}
