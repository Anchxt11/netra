// REST calls to the backend API (api/app/routes on the backend branch). Spec: contracts/API_SPEC.md there.
import type { AlertRow, EnrichedEvent, FreshnessReport, LoginResponse, ServerHealth } from "./types";

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
  };
}

export type Api = ReturnType<typeof createApi>;
