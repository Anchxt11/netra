// REST calls to the backend API (api/app/routes on the backend branch). Spec: contracts/API_SPEC.md there.
import type { AlertRow, EnrichedEvent, FreshnessReport, JobWire, KpiAlertWire, OpsAlertWire, KpiReport, LoginResponse, ServerHealth } from "./types";

export class ApiError extends Error {
  /** HTTP status, or 0 when the server could not be reached at all. */
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(base: string, path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new ApiError(0, `Cannot reach ${base}`);
  }
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
  return (await res.json()) as T;
}

export function createApi(base: string) {
  return {
    base,
    login: (username: string, password: string) =>
      call<LoginResponse>(base, "/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
    recentEvents: (token: string, limit = 1000) => call<EnrichedEvent[]>(base, `/events/recent?limit=${limit}`, {}, token),
    recentAlerts: (token: string, limit = 500) => call<AlertRow[]>(base, `/alerts/recent?limit=${limit}`, {}, token),
    /** Public on purpose (the load test polls it). */
    freshness: () => call<FreshnessReport>(base, "/freshness"),
    health: () => call<ServerHealth>(base, "/health"),
    updateIncident: (token: string, id: number, body: { status?: "acknowledged" | "resolved"; notes?: string }) =>
      call<AlertRow>(base, `/incidents/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token),
    /** The latest KPI reading and the trend behind it (contracts/LIVE_API.md 4.1). 404 on an API without KPIs. */
    kpi: (token: string, minutes = 15) => call<KpiReport>(base, `/kpi?minutes=${minutes}`, {}, token),
    kpiAlerts: (token: string, state: "firing" | "all" = "firing") =>
      call<KpiAlertWire[]>(base, `/kpi/alerts?state=${state}`, {}, token),
    /** The ops service's jobs and firing alerts (contracts/LIVE_API.md 4.4, 4.5). 404 on an API without them. */
    jobs: (token: string) => call<JobWire[]>(base, "/jobs", {}, token),
    opsAlerts: (token: string) => call<OpsAlertWire[]>(base, "/ops/alerts?state=firing", {}, token),
    config: (token: string) => call<Record<string, unknown>>(base, "/config", {}, token),
    /** Admin only: 403 for an analyst, 422 for a value the API refuses. */
    putConfig: (token: string, key: string, value: unknown) =>
      call<{ key: string; value: unknown }>(base, `/config/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ value }) }, token),
  };
}

export type Api = ReturnType<typeof createApi>;
