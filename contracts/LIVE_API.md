# NETRA live API

The contract between the backend (track 1: `api/`, `processor/`, the `ops` service, `ml-scorer`) and the dashboard (track 2: `frontend/`). Both tracks code against this file. To change a shape, change this file first, then the code on both sides.

Written 2026-10-07 on branch `integration`, from `api/app` (routes, `ws.py`, `consumers.py`, `repo.py`), `api/db/init.sql`, `processor/alerts.py`, `frontend/src/data/source.ts`, `frontend/src/data/backend/` and `frontend/docs/BUILD_PLAN.md`. It covers everything in `contracts/API_SPEC.md` (the backend team's spec of what exists) plus what the build plan adds.

**Status words**
- **exists**: in the code today. The example is what the code sends.
- **new**: added by the build plan prompt named next to it. Not built yet.
- **exists, changed**: in the code today, and gains the fields marked new.

Numbers in the examples are made up to show the shape. They are not results.

---

## 1. Everything at a glance

### REST
| method | path | auth | status | built in |
|---|---|---|---|---|
| POST | `/auth/login` | none | exists | |
| GET | `/auth/me` | any user | exists | |
| GET, POST | `/users` | admin | exists | |
| GET | `/events/recent` | any user | exists | |
| GET | `/alerts/recent` | any user | exists, changed (alert fields, section 5) | B2, ask 2 |
| GET | `/incidents` | any user | exists, changed (alert fields) | B2, ask 2 |
| GET | `/incidents/{id}` | any user | exists, changed (alert fields) | B2, ask 2 |
| PATCH | `/incidents/{id}` | any user | exists | |
| GET | `/freshness` | none | exists | |
| GET | `/health` | none | exists | |
| GET | `/config` | any user | exists (new keys `kpi.*`, `traffic.*`) | A1 |
| PUT | `/config/{key}` | admin | exists (new keys `kpi.*`, `traffic.*`) | A1 |
| GET | `/kpi` | any user | **new** | A1 |
| GET | `/kpi/alerts` | any user | **new** | A1 |
| GET | `/traffic/recent` | any user | **new** | A1 (see 4.3) |
| GET | `/models` | any user | **new** | B2 |
| GET | `/jobs` | any user | **new** | A3 |
| GET | `/jobs/runs` | any user | **new** | A3 |
| GET | `/ops/alerts` | any user | **new** | A3 |

"Any user" means a signed-in analyst or admin.

### WebSocket messages (server to browser)
| type | when | status | built in |
|---|---|---|---|
| `hello` | right after connect | exists | |
| `events` | every 250 ms when there are events | exists | |
| `alert` | a new alert was stored | exists, changed (alert fields) | B2, ask 2 |
| `incident_update` | someone changed an incident | exists, changed (alert fields) | B2, ask 2 |
| `pong` | reply to `ping` | exists | |
| `kpi` | every 5 s | **new** | A1 |
| `kpi_alert` | a KPI alert opens, changes level or clears | **new** | A1 |
| `traffic` | every 1 s | **new** | A1 (see 4.3) |
| `ops_alert` | an ops alert opens, changes level or clears | **new** | A3 |
| `job_runs` | a scheduled job finished a run | **new** | A3 |
| `models` | a model's status, version or metrics changed | **new** | B2 |

The browser sends only the text `ping`. Everything else it does (decisions, thresholds) goes through REST.

No prompt in the build plan builds the server's `traffic` message yet. Suggestion: build it in A1 next to the KPI loop, with `ai` at 0 until B2 lands. Until the API sends it, the dashboard keeps building the same `data` from the `events` stream (`TrafficMeter` in `frontend/src/data/backend/traffic.ts`).

---

## 2. Conventions (all routes and messages)

- **Addresses.** REST `http://localhost:8000`, WebSocket `ws://localhost:8000/ws?token=<JWT>`. The dashboard reads `VITE_WS_URL` and `VITE_API_URL`. Interactive docs: `http://localhost:8000/docs`.
- **Auth.** REST: header `Authorization: Bearer <JWT>`. WebSocket: the `token` query parameter. Roles: `analyst`, `admin` (admin = analyst plus users and config). Tokens last 60 minutes. Development accounts are in `api/app/settings.py`; change them and `jwt_secret` before anything public.
- **Field names** are snake_case on the wire. The dashboard converts to its own camelCase types.
- **Times** are ISO 8601 strings in UTC. Two forms appear today: the processor writes `2026-10-07T09:15:02.417Z`, the API writes `2026-10-07T09:15:02.417000+00:00`. Clients accept both (`Date.parse` does). New fields use the API's form.
- **Units.** Rates are ratios from 0 to 1, not percentages. Bytes are bytes. Durations carry their unit in the field name (`_ms`, `_seconds`).
- **`null` means not measured or not known.** The dashboard shows PENDING for it. Never send 0 for unknown.
- **`"-"` as a user** means no account (the simulator's convention). The dashboard treats it as unknown.
- **Errors** are FastAPI's: an HTTP status and `{"detail": "<message>"}`. 401 = not signed in or token expired (sign in again). 403 = wrong role. 404 = not found. 409 = conflict. 422 = bad request body. 503 = ClickHouse unavailable.
- **A new route answering 404** means this API build does not have it yet. The dashboard shows PENDING, not an error. This lets the dashboard ship before the backend.
- **WebSocket envelope.** Every message is `{"type": "<type>", "data": <data>, "server_ts": "<time>"}`, sometimes with extra top-level fields (`dropped` on `events`). `pong` has no `data`. Clients ignore types they do not know, so the backend can add a type before the dashboard reads it.
- **Slow browsers.** Each client has a queue of 500 messages. When it is full the oldest message is dropped (`api/app/ws.py`).
- **The simulated feed** (the dashboard's mock engine) produces the same `data` objects as this file. Inside the frontend its envelope is `{type, payload}` (`frontend/src/data/source.ts`); the shapes inside must match this file.

---

## 3. REST that exists today

### 3.1 `POST /auth/login` (no auth)
Request:
```json
{"username": "analyst", "password": "<password>"}
```
Response 200:
```json
{
  "access_token": "<JWT>",
  "token_type": "bearer",
  "expires_in": 3600,
  "user": {"id": 2, "username": "analyst", "role": "analyst"}
}
```
Wrong name or password, or an inactive account: 401 `{"detail": "Invalid credentials"}`.

### 3.2 `GET /auth/me`
```json
{"id": 2, "username": "analyst", "role": "analyst"}
```

### 3.3 `GET /users`, `POST /users` (admin)
`GET` returns every account:
```json
[
  {"id": 1, "username": "admin", "role": "admin", "is_active": true,
   "created_at": "2026-10-07T08:00:01.120000+00:00", "last_login": "2026-10-07T09:02:44.310000+00:00"}
]
```
`POST` body `{"username": "<3 to 64 chars>", "password": "<8 to 128 chars>", "role": "analyst"}` (role `analyst` or `admin`, default `analyst`). Returns 201 with `id, username, role, is_active, created_at`. Name taken: 409.

### 3.4 `GET /events/recent?limit=100`
`limit` 1 to 1000, default 100. Newest first, by the time ClickHouse stored them. Each item is an enriched event (the raw event's 16 fields plus what the processor adds), with `stored_ts` added by ClickHouse:
```json
[
  {
    "event_id": "7d9a3c2e-1b4f-4e8a-9c61-0f2d5b8e4a17",
    "event_ts": "2026-10-07T09:15:02.417000+00:00",
    "source": "auth",
    "user": "maria.silva",
    "ip": "203.0.113.24",
    "event_type": "login",
    "severity": "low",
    "status": "failure",
    "host": "auth-01",
    "bytes_out": 312,
    "process": "",
    "method": "POST",
    "path": "/login",
    "http_status": 401,
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "response_ms": 161,
    "features": {"is_failure": true, "is_login": true, "bytes_out": 312},
    "risk_score": 0.1,
    "rule_hits": "[\"brute_force\"]",
    "processed_ts": "2026-10-07T09:15:02.431000+00:00",
    "stored_ts": "2026-10-07T09:15:02.962000+00:00"
  }
]
```
- `features` is an object: 24 keys, listed in `processor/features.py` (shortened here).
- `severity` is the generator's raw flag (`low` or `medium`). It is not an incident's severity; never show it as one.
- `risk_score` comes from the processor's `DummyScorer` (hand-written weights). It is not a model; never show it as AI.
- **`rule_hits` is probably a string here** (still to check). ClickHouse stores `rule_hits` as a `String` column, so REST most likely returns the JSON text (`"[\"brute_force\"]"`, or `"[]"`), while the WebSocket `events` message has a real array. Check with one call to a running stack. Proposed fix, in the API: parse `rule_hits` into an array as it already does for `features` (`api/app/util.py`, `parse_features`). Until then, clients must accept both.
- ClickHouse down: 503 `{"detail": "ClickHouse unavailable: <error type>"}`.

### 3.5 `GET /alerts/recent?limit=50`
`limit` 1 to 500, default 50. Newest first. One row per alert, with fewer columns than an incident (no `assigned_to`, `notes` or `updated_ts`):
```json
[
  {"id": 412, "alert_id": "c1f04b9e-3a51-4d6f-8f0e-2b7a9d1c5e33", "rule_id": "brute_force", "model": null,
   "title": null, "severity": "high", "event_ids": ["7d9a3c2e-1b4f-4e8a-9c61-0f2d5b8e4a17"],
   "status": "open", "created_ts": "2026-10-07T09:15:02.433000+00:00"}
]
```
Gains the alert fields in section 5.

### 3.6 `GET /incidents?status=&severity=&limit=50&offset=0`
`status`: `open`, `acknowledged` or `resolved`. `severity`: `low`, `medium`, `high` or `critical`. `limit` 1 to 500. Newest first. Each item is an **incident row**. The backend stores one row per alert, and the dashboard groups them into incidents in the browser (`frontend/src/data/backend/correlate.ts`):
```json
[
  {
    "id": 412,
    "alert_id": "c1f04b9e-3a51-4d6f-8f0e-2b7a9d1c5e33",
    "rule_id": "brute_force",
    "model": null,
    "title": null,
    "severity": "high",
    "event_ids": ["7d9a3c2e-1b4f-4e8a-9c61-0f2d5b8e4a17"],
    "status": "open",
    "assigned_to": null,
    "notes": null,
    "created_ts": "2026-10-07T09:15:02.433000+00:00",
    "updated_ts": "2026-10-07T09:15:02.480000+00:00"
  }
]
```
`title` is always `null` today: the processor does not send the rule's title (each rule's YAML in `rules/sigma/` has one). Gains the alert fields in section 5.

### 3.7 `GET /incidents/{id}`
The incident row plus `payload`: the original alert exactly as it arrived on Kafka. 404 if there is no such incident.

### 3.8 `PATCH /incidents/{id}`
Body: any of `status` (`open`, `acknowledged`, `resolved`; not `null`), `notes` (text), `assigned_to` (a user id). An empty body is a 400. Returns the updated incident row and broadcasts it to every client as `incident_update`, including the client that changed it. The dashboard records an approved fix this way: the decision log goes in `notes`, with status `acknowledged`.

### 3.9 `GET /freshness?minutes=` (no auth, so the load test can poll it)
`minutes` 1 to 240. The default comes from config `freshness_window_minutes` (5). Measures `stored_ts - event_ts` over the window:
```json
{
  "window_minutes": 5,
  "events": 1500,
  "avg_events_per_sec": 5.0,
  "p50_seconds": 0.9,
  "p95_seconds": 1.8,
  "max_seconds": 2.4,
  "sla_p95_seconds": 5.0,
  "seconds_since_last_event": 0.4,
  "status": "ok",
  "computed_at": "2026-10-07T09:15:05.002000+00:00"
}
```
`status`: `ok`; `breach` (p95 above `sla_p95_seconds`, from config `freshness_sla_p95_seconds`); `stalled` (nothing stored for more than 10 s, or twice the SLA if that is longer); `no_data` (no events in the window; the timing fields are then `null`). ClickHouse down: 503. The dashboard polls it every 5 s.

### 3.10 `GET /health` (no auth)
```json
{"status": "ok", "postgres": true, "consumers": {"events": true, "alerts": true}, "ws_clients": 3}
```
`status` is `degraded` when Postgres or either Kafka consumer is down. The dashboard polls it every 10 s.

### 3.11 `GET /config`, `PUT /config/{key}` (PUT: admin)
`GET` returns every key: `{"freshness_sla_p95_seconds": 5, "freshness_window_minutes": 5, "rules_enabled": {}}`. `PUT /config/{key}` with body `{"value": <any JSON>}` creates or replaces one key and returns `{"key": "...", "value": ...}`.

**New keys** (A1), seeded by `api/db/init.sql`:
| key | value | meaning |
|---|---|---|
| `kpi.<name>.warn` | number or `null` | the warning line for that KPI (names in 4.1). `null` = no line |
| `kpi.<name>.crit` | number or `null` | the critical line |
| `traffic.settle_seconds` | number, default 2 | how long the API holds a second of traffic before sending it (4.3) |

Starting values, to replace with numbers from the A4 load test:
| KPI | warn | crit |
|---|---|---|
| `events_per_sec` | 50 | 100 |
| `login_failure_rate` | 0.2 | 0.4 |
| `http_5xx_rate` | 0.02 | 0.05 |
| `bytes_out_per_min` | 200000000 | 1000000000 |
| `rule_hit_rate` | 0.05 | 0.15 |

A threshold change shows up in the next `kpi` message (it carries `warn` and `crit`), so no other message is needed. The admin-only Thresholds page reads `GET /config` and writes `PUT /config/kpi.<name>.warn`.

---

## 4. New routes and messages

### 4.1 `kpi` (WebSocket, every 5 s) and `GET /kpi` (A1)
The API computes five KPIs from ClickHouse every 5 s, over the last 1 minute and the last 5 minutes, by `stored_ts`:

| name | value | unit | `null` when |
|---|---|---|---|
| `events_per_sec` | events in the window ÷ seconds in the window | `events/s` | never (0 is a real reading) |
| `login_failure_rate` | `login` events with status `failure` ÷ all `login` events | `ratio` | no logins in the window |
| `http_5xx_rate` | `http_request` events with `http_status` 500 or above ÷ all `http_request` events | `ratio` | no requests in the window |
| `bytes_out_per_min` | sum of `bytes_out` over all events ÷ minutes in the window | `bytes/min` | never |
| `rule_hit_rate` | events with at least one rule hit ÷ all events | `ratio` | no events in the window |

`value_1m` is compared with the thresholds. `value_5m` is context for the trend.

Message:
```json
{
  "type": "kpi",
  "data": {
    "computed_at": "2026-10-07T09:15:05.002000+00:00",
    "kpis": [
      {"name": "events_per_sec", "unit": "events/s", "value_1m": 11.8, "value_5m": 10.4,
       "warn": 50, "crit": 100, "level": "ok", "alert_id": null},
      {"name": "login_failure_rate", "unit": "ratio", "value_1m": 0.46, "value_5m": 0.21,
       "warn": 0.2, "crit": 0.4, "level": "crit", "alert_id": 7},
      {"name": "http_5xx_rate", "unit": "ratio", "value_1m": 0.004, "value_5m": 0.003,
       "warn": 0.02, "crit": 0.05, "level": "ok", "alert_id": null},
      {"name": "bytes_out_per_min", "unit": "bytes/min", "value_1m": 18350000, "value_5m": 9120000,
       "warn": 200000000, "crit": 1000000000, "level": "ok", "alert_id": null},
      {"name": "rule_hit_rate", "unit": "ratio", "value_1m": 0.031, "value_5m": 0.012,
       "warn": 0.05, "crit": 0.15, "level": "ok", "alert_id": null}
    ]
  },
  "server_ts": "2026-10-07T09:15:05.010000+00:00"
}
```
- All five KPIs are always present, in this order (the strip's order).
- `level` is this reading's own level: `crit` if `crit` is set and `value_1m` ≥ `crit`; otherwise `warn` if `warn` is set and `value_1m` ≥ `warn`; otherwise `ok`; `no_data` when `value_1m` is `null`. All five alert when the value rises. A feed that goes quiet is caught by `/freshness` (`stalled`) and the ops health watch, not by `events_per_sec`.
- `alert_id` is the id of this KPI's firing `kpi_alert`, or `null`. `level` can be `crit` with no alert yet: one breach does not open an alert (4.2).
- If ClickHouse cannot be read, no `kpi` message is sent that tick. A missing tick is the signal; the ops health watch raises it.

`GET /kpi?minutes=15` (`minutes` 1 to 60) fills the strip and its small trend after a reload:
```json
{
  "latest": {"computed_at": "2026-10-07T09:15:05.002000+00:00", "kpis": ["...the same five objects as the message"]},
  "history": [
    {"computed_at": "2026-10-07T09:00:05.001000+00:00",
     "values": {"events_per_sec": 10.9, "login_failure_rate": 0.05, "http_5xx_rate": 0.003,
                "bytes_out_per_min": 8800000, "rule_hit_rate": 0.009}}
  ]
}
```
`history` holds one entry per 5 s tick, oldest first, with each KPI's `value_1m`. `latest` is `null` before the first tick.

### 4.2 `kpi_alert` (WebSocket) and `GET /kpi/alerts` (A1)
One row per alert, in a new Postgres table `kpi_alerts`. The whole row is sent every time it changes.

Firing:
```json
{
  "type": "kpi_alert",
  "data": {
    "id": 7,
    "kind": "threshold",
    "origin": "api",
    "kpi": "login_failure_rate",
    "level": "crit",
    "state": "firing",
    "value": 0.46,
    "threshold": 0.4,
    "window": "1m",
    "started_at": "2026-10-07T09:15:00.004000+00:00",
    "updated_at": "2026-10-07T09:15:05.002000+00:00",
    "cleared_at": null
  },
  "server_ts": "2026-10-07T09:15:05.012000+00:00"
}
```
Cleared (same `id`):
```json
{
  "type": "kpi_alert",
  "data": {
    "id": 7, "kind": "threshold", "origin": "api", "kpi": "login_failure_rate",
    "level": "crit", "state": "cleared", "value": 0.07, "threshold": 0.4, "window": "1m",
    "started_at": "2026-10-07T09:15:00.004000+00:00",
    "updated_at": "2026-10-07T09:19:35.003000+00:00",
    "cleared_at": "2026-10-07T09:19:35.003000+00:00"
  },
  "server_ts": "2026-10-07T09:19:35.011000+00:00"
}
```
Fields: `kind` is `threshold` (from the KPI loop) or `sla` (below). `level` is `warn` or `crit`. `state` is `firing` or `cleared`. `value` is the reading that caused the latest change. `threshold` is the line for `level` at that moment. A cleared alert keeps the last level it fired at.

Rules (A1's unit tests check these):
1. A reading at `warn` or `crit` is a breach. A reading at `ok` is normal. A `no_data` reading counts as neither and does not break a streak.
2. An alert opens after **2 breaches in a row**, at the lower of the two readings' levels (`warn` then `crit` opens at `warn`).
3. While firing, 2 readings in a row at the other level move the alert to that level (`warn` to `crit`, or `crit` to `warn`). Same `id`, one message per change.
4. It clears after **2 normal readings in a row**.
5. At most one firing alert per KPI.
6. A threshold changed through `PUT /config` applies from the next reading. An open alert follows the same rules.

**Kind `sla`** (A2) is raised by the dashboard itself, never by the API: the browser measures time-to-screen p95 per minute, and a minute above the SLA opens a local alert with the same shape: `"id": null`, `"origin": "browser"`, `"kpi": "time_to_screen_p95"`, `value` and `threshold` in seconds. The API never sees it. A pipeline freshness breach on the server comes as an `ops_alert` of kind `sla_breach` (4.4).

`GET /kpi/alerts?state=firing&limit=50`: `state` is `firing` (default) or `all`; `limit` 1 to 500. Newest first, a list of the same rows.

### 4.3 `traffic` (WebSocket, every 1 s) and `GET /traffic/recent`
All the traffic, normal included, for the live monitor: a stacked per-second chart (normal, flagged by a rule, flagged by the AI) and a list of recent events.
```json
{
  "type": "traffic",
  "data": {
    "t": "2026-10-07T09:15:04+00:00",
    "total": 14,
    "normal": 11,
    "rule": 2,
    "ai": 1,
    "ai_late": 0,
    "by_event_type": {
      "http_request": {"normal": 9, "rule": 0, "ai": 0},
      "login": {"normal": 1, "rule": 2, "ai": 0},
      "logout": {"normal": 1, "rule": 0, "ai": 0},
      "data_transfer": {"normal": 0, "rule": 0, "ai": 1},
      "process_start": {"normal": 0, "rule": 0, "ai": 0}
    },
    "sample": [
      {"event_id": "e4b1d0aa-6c2f-4f7e-b8a9-31d5c7e2f019", "event_ts": "2026-10-07T09:15:04.812Z",
       "source": "endpoint", "ip": "10.0.4.17", "user": "dev.ops", "host": "files-01",
       "event_type": "data_transfer", "status": "success", "method": "", "path": "", "http_status": 0,
       "bytes_out": 31457280, "process": "",
       "verdict": "ai", "rule_hits": [],
       "ai": {"model": "atde-1.0.0", "class": "data_exfiltration", "probability": 0.81}},
      {"event_id": "7d9a3c2e-1b4f-4e8a-9c61-0f2d5b8e4a17", "event_ts": "2026-10-07T09:15:04.417Z",
       "source": "auth", "ip": "203.0.113.24", "user": "maria.silva", "host": "auth-01",
       "event_type": "login", "status": "failure", "method": "POST", "path": "/login", "http_status": 401,
       "bytes_out": 312, "process": "",
       "verdict": "rule", "rule_hits": ["brute_force"], "ai": null},
      {"event_id": "0c6e2f91-8d4b-4a1e-9f37-5b2a7c0d8e64", "event_ts": "2026-10-07T09:15:04.120Z",
       "source": "web", "ip": "198.51.100.8", "user": "-", "host": "web-01",
       "event_type": "http_request", "status": "success", "method": "GET", "path": "/products/41", "http_status": 200,
       "bytes_out": 18422, "process": "",
       "verdict": "normal", "rule_hits": [], "ai": null}
    ]
  },
  "server_ts": "2026-10-07T09:15:07.003000+00:00"
}
```
Rules:
- `t` is the start of the second in which **the API received** the events from Kafka (server clock), not `event_ts`.
- The API holds each second for `traffic.settle_seconds` (default 2) after it ends, then sends it. A model's verdict on those events can then still land in the same second (B2 scores in 1 s micro-batches). It sends every second, even when all counts are 0.
- Each event counts once: `rule` if it has any rule hit; otherwise `ai` if a real model's alert named it before the second was sent; otherwise `normal`. So `total` = `normal` + `rule` + `ai`, and the same holds inside each `by_event_type` entry.
- `ai_late` counts model alerts that arrived for events in a second already sent. Those events stay counted as `normal` there; nothing is corrected afterwards.
- `by_event_type` always has the five event types. An `other` entry appears only when an event has some other type.
- `sample`: up to 6 flagged events (rule or AI) and 5 normal events from that second, newest first. The counts cover every event; the sample does not. A sample event carries the raw fields the feed list needs, plus `verdict` (`normal`, `rule` or `ai`), `rule_hits` (always an array) and `ai` (`null` unless `verdict` is `ai`).
- Counts cover every event the API consumed. The 200-per-message cap on `events` does not affect them.
- Only real models count as `ai`. The processor's `DummyScorer` never does.

`GET /traffic/recent?seconds=300` (`seconds` 1 to 600) fills the chart after a reload: `{"seconds": [ ... ]}`, oldest first, each item the same `data` object **without** `sample`. The API keeps these in memory, so after an API restart it returns only what it has seen since. The feed list fills from `GET /events/recent`.

### 4.4 `ops_alert` (WebSocket) and `GET /ops/alerts` (A3)
The `ops` service writes a row to a new Postgres table `ops_alerts` when something in the pipeline fails, and the API broadcasts it. The whole row is sent every time it changes.
```json
{
  "type": "ops_alert",
  "data": {
    "id": 31,
    "kind": "health",
    "source": "clickhouse",
    "level": "crit",
    "state": "firing",
    "message": "ClickHouse has not answered for 30 s.",
    "detail": {"failed_checks": 3, "error": "ConnectionRefusedError"},
    "job_run_id": 90211,
    "started_at": "2026-10-07T09:20:10.004000+00:00",
    "updated_at": "2026-10-07T09:20:10.004000+00:00",
    "cleared_at": null,
    "webhook": {"delivered": true, "status": 204, "at": "2026-10-07T09:20:10.380000+00:00"}
  },
  "server_ts": "2026-10-07T09:20:10.390000+00:00"
}
```
| kind | raised by | `source` | opens | clears |
|---|---|---|---|---|
| `health` | `health_watch` | `api`, `postgres`, `clickhouse`, `kafka_lag`, `processor`, `ml_scorer` | 3 failed checks in a row (30 s) | 3 passed checks in a row |
| `job_failed` | any job | the job's name | a run ends `failed` | the next run of that job ends `ok` |
| `sla_breach` | `sla_check` | `sla_check` | p95 freshness above the SLA in 2 checks in a row (60 s) | 2 checks in a row within the SLA |

- `level`: `crit` when something is down or failed; `warn` when it is degraded (for example, Kafka lag above its warning line).
- `message` is one plain sentence. The same text goes to the webhook, so it must read well on its own.
- `detail` is free-form, for the SYSTEM panel's expanded view.
- `job_run_id` is the run that opened or last changed it, or `null`.
- `webhook` is `null` when `ALERT_WEBHOOK_URL` is not set. Otherwise it records the latest delivery: `delivered` (true or false), the HTTP `status` (`null` if the hook could not be reached) and `at`. The webhook is called when an alert opens and when it clears.

`GET /ops/alerts?state=firing&limit=50`: `state` is `firing` (default) or `all`; `limit` 1 to 500. Newest first.

### 4.5 `job_runs` (WebSocket), `GET /jobs` and `GET /jobs/runs` (A3)
Every run of a scheduled job is a row in a new Postgres table `job_runs`. When a run finishes, the API broadcasts it:
```json
{
  "type": "job_runs",
  "data": [
    {
      "id": 90212,
      "job": "model_retrain",
      "started_at": "2026-10-07T02:00:00.010000+00:00",
      "finished_at": "2026-10-07T02:00:00.052000+00:00",
      "duration_ms": 42,
      "status": "skipped",
      "detail": "ml/train.py does not exist yet.",
      "result": null
    }
  ],
  "server_ts": "2026-10-07T02:00:00.060000+00:00"
}
```
`data` is a list (usually of one run). `status` is `ok`, `failed` or `skipped`; a run is sent only when it has finished. `detail` is a short plain sentence (the error, for a failure). `result` is the job's own output, or `null`.

| job | when | does | `result` when `ok` |
|---|---|---|---|
| `health_watch` | every 10 s | checks the API, Postgres, ClickHouse, Kafka consumer lag, the processor and `ml-scorer`; `failed` if any check fails | `{"checks": {"postgres": true, "clickhouse": true, "kafka_lag": 12, "processor": true, "ml_scorer": true, "api": true}}` |
| `sla_check` | every 30 s | freshness p95 against the SLA. A breach is still an `ok` run: it means the check worked | `{"p95_seconds": 1.8, "sla_p95_seconds": 5, "breach": false}` |
| `daily_report` | daily 06:00 | yesterday's SLA and incident summary into a new table `daily_reports` | `{"report_id": 12, "date": "2026-10-06"}` |
| `model_retrain` | daily 02:00 | runs `ml/train.py`; `skipped` while it does not exist | `{"version": "1.1.0", "promoted": false, "pr_auc": 0.88}` |
| `data_retention` | daily 03:00 | deletes data older than its retention | `{"deleted": {"job_runs": 8640}}` |

`health_watch` finishes every 10 s, so the dashboard keeps only the latest run per job, plus failures. Daily times are in the `ops` service's `TZ` (default UTC). Times on the wire are always UTC.

`GET /jobs` gives one entry per job, for the SYSTEM panel:
```json
[
  {"job": "health_watch", "schedule": "every 10 s", "last_run": {"id": 90230, "job": "health_watch", "started_at": "2026-10-07T09:21:00.002000+00:00", "finished_at": "2026-10-07T09:21:00.140000+00:00", "duration_ms": 138, "status": "ok", "detail": "All checks passed.", "result": {"checks": {"postgres": true, "clickhouse": true, "kafka_lag": 12, "processor": true, "ml_scorer": true, "api": true}}},
   "next_run_at": "2026-10-07T09:21:10+00:00", "consecutive_failures": 0},
  {"job": "model_retrain", "schedule": "daily 02:00", "last_run": {"id": 90212, "job": "model_retrain", "started_at": "2026-10-07T02:00:00.010000+00:00", "finished_at": "2026-10-07T02:00:00.052000+00:00", "duration_ms": 42, "status": "skipped", "detail": "ml/train.py does not exist yet.", "result": null},
   "next_run_at": "2026-10-08T02:00:00+00:00", "consecutive_failures": 0}
]
```
`last_run` is `null` for a job that has never run. The dashboard's retraining line (`PipelineHealth.retraining`) comes from the `model_retrain` entry.

`GET /jobs/runs?job=&status=&limit=50`: `job` and `status` filter; `limit` 1 to 500. Newest first, a list of runs.

### 4.6 `models` (WebSocket) and `GET /models` (B2)
Which models are running, from what `ml-scorer` reports and from each bundle's own files (B0: `ml/models/atde/<version>/`). `data` is always the full list. It replaces what the client had.
```json
{
  "type": "models",
  "data": [
    {
      "name": "ATDE",
      "model_id": "atde-1.0.0",
      "version": "1.0.0",
      "status": "ready",
      "trained_at": "2026-10-06T21:40:00+00:00",
      "loaded_at": "2026-10-07T08:00:12.400000+00:00",
      "last_heartbeat_at": "2026-10-07T09:21:05.010000+00:00",
      "detail": null,
      "metrics": {
        "source": "model-export",
        "split": "time-split test set",
        "rows": 48210,
        "precision": 0.91,
        "recall": 0.84,
        "f1": 0.87,
        "pr_auc": 0.9,
        "per_class": null
      },
      "scored_per_sec": 11.6
    },
    {
      "name": "CRIE", "model_id": null, "version": null, "status": "pending",
      "trained_at": null, "loaded_at": null, "last_heartbeat_at": null,
      "detail": "Not built yet.", "metrics": null, "scored_per_sec": null
    }
  ],
  "server_ts": "2026-10-07T09:21:05.020000+00:00"
}
```
- `name` is `ATDE` or `CRIE`. Both are always listed.
- `model_id` is exactly the `model` value on that model's alerts (`atde-<version>`).
- `status`:
  - `pending`: no bundle loaded. ATDE until B2 runs; CRIE for now.
  - `ready`: loaded, with a heartbeat less than 15 s old.
  - `offline`: was ready, but there has been no heartbeat for 15 s (`ml-scorer` is down).
  - `training`: a retrain is running (B5).
  - `failed`: the last load or retrain failed, and `detail` says why.
  
  The dashboard's `ModelStatus` type needs `offline` added.
- `trained_at` and `metrics` are copied from the bundle (`VERSION`, `metrics.json`, `model_card.md`). The API never computes or rounds them. A figure the bundle lacks is `null`; the dashboard shows PENDING. `source` is always `"model-export"`. `per_class` is the bundle's per-class figures as an object keyed by class (`precision`, `recall`, `f1`, `support`), or `null`.
- `scored_per_sec` comes from the live heartbeat: rows scored per second over the last minute.
- Sent when any field except `last_heartbeat_at` and `scored_per_sec` changes. Those two are refreshed by `GET /models`.
- The processor's `DummyScorer` is never listed as a model.

`GET /models` returns the same list.

---

## 5. Alerts and incidents: the fields ATDE adds

### 5.1 The alert on Kafka topic `alerts` (processor and `ml-scorer` to the API)
| field | type | rule alert | model alert | status |
|---|---|---|---|---|
| `alert_id` | string | uuid | uuid | exists |
| `rule_id` | string or `null` | the rule's id | `null` | exists |
| `model` | string or `null` | `null` | `"atde-<version>"` | exists |
| `title` | string or `null` | `null` today; the processor could send the rule's YAML title | `null` | exists |
| `severity` | `low`, `medium`, `high`, `critical` | the rule's | from the table below | exists |
| `event_ids` | string[] | the event | the scored event(s) | exists |
| `created_ts` | time | | | exists |
| `ip` | string | the event's | the event's | **new** (ask 2, B2) |
| `user` | string | the event's | the event's | **new** (ask 2, B2) |
| `host` | string | the event's | the event's | **new** (ask 2, B2) |
| `class` | string or `null` | `null` | the bundle's class name, or `"anomaly"` | **new** (B2) |
| `probability` | 0 to 1, or `null` | `null` | the classifier's probability for `class` | **new** (B2) |
| `anomaly_score` | 0 to 1, or `null` | `null` | the Isolation Forest score | **new** (B2) |
| `reasons` | list, or `null` | `null` | the top 3 reasons, largest first | **new** (B2) |

- `ip`, `user` and `host` go on **every** alert, rules included (ask 2 in `frontend/docs/BACKEND_INTEGRATION.md`). Then the dashboard can group alerts without looking up their events, including after a reload. When `event_ids` has several events, they come from the first one.
- `class` is a class name from the bundle (the ML team confirms the list, B0). It is `"anomaly"` when the anomaly detector fires but the classifier names no attack class. The dashboard maps classes to its attack types; an AI-only alert with no known class becomes "Unusual activity" (build plan decision 3).
- Each reason is `{"feature", "value", "baseline", "contribution", "sentence"}`:
  - `feature`: the bundle's feature name.
  - `value`: this event's value.
  - `baseline`: the normal value for comparison, or `null`.
  - `contribution`: the SHAP value.
  - `sentence`: plain sentence case, written by `ml-scorer` from the bundle's feature descriptions, such as "3.4× this address's normal bytes out".
- Severity of a model alert (a proposal; the ML team can replace it through `thresholds.json`). Whether to alert at all is decided by the bundle's own cutoff in `thresholds.json`.

  | `probability` | severity |
  |---|---|
  | 0.90 or more | `high` |
  | 0.75 to 0.90 | `medium` |
  | below 0.75 | `low` |
  | class `"anomaly"` | `low` |

  A model alone never raises `critical`. That level stays with the rules, which a person can read.
- `ml-scorer` never sends `DummyScorer` output as a model alert.

A model alert on Kafka (B2):
```json
{
  "alert_id": "5f2c8e1a-0b7d-4c3e-9a64-d81f2e7b0c95",
  "rule_id": null,
  "model": "atde-1.0.0",
  "severity": "medium",
  "event_ids": ["e4b1d0aa-6c2f-4f7e-b8a9-31d5c7e2f019"],
  "created_ts": "2026-10-07T09:15:05.204Z",
  "ip": "10.0.4.17",
  "user": "dev.ops",
  "host": "files-01",
  "class": "data_exfiltration",
  "probability": 0.81,
  "anomaly_score": 0.93,
  "reasons": [
    {"feature": "bytes_out_ip_60s", "value": 31457280, "baseline": 9250000, "contribution": 0.42,
     "sentence": "3.4× this address's normal bytes out"},
    {"feature": "transfers_user_10m", "value": 7, "baseline": 1, "contribution": 0.21,
     "sentence": "7 transfers in 10 minutes from this account; usually 1"},
    {"feature": "hour_of_day", "value": 3, "baseline": null, "contribution": 0.09,
     "sentence": "Outside this account's working hours"}
  ]
}
```
The feature names are examples. The real ones come from the bundle's `features.json`.

A rule alert after ask 2:
```json
{
  "alert_id": "c1f04b9e-3a51-4d6f-8f0e-2b7a9d1c5e33",
  "rule_id": "brute_force",
  "model": null,
  "severity": "high",
  "event_ids": ["7d9a3c2e-1b4f-4e8a-9c61-0f2d5b8e4a17"],
  "created_ts": "2026-10-07T09:15:02.433Z",
  "ip": "203.0.113.24",
  "user": "maria.silva",
  "host": "auth-01",
  "class": null,
  "probability": null,
  "anomaly_score": null,
  "reasons": null
}
```

### 5.2 The incident row on the wire (API to dashboard)
The incident row (3.6) gains the same seven fields: `ip`, `user`, `host`, `class`, `probability`, `anomaly_score`, `reasons`. They appear in the WebSocket `alert` and `incident_update` messages, `GET /incidents`, `GET /incidents/{id}` and `GET /alerts/recent`. Rows stored before the change have them as `null`. (`user` is a reserved word in Postgres: the column can have another name, but the wire field is `user`.)
```json
{
  "type": "alert",
  "data": {
    "id": 418,
    "alert_id": "5f2c8e1a-0b7d-4c3e-9a64-d81f2e7b0c95",
    "rule_id": null,
    "model": "atde-1.0.0",
    "title": null,
    "severity": "medium",
    "event_ids": ["e4b1d0aa-6c2f-4f7e-b8a9-31d5c7e2f019"],
    "status": "open",
    "assigned_to": null,
    "notes": null,
    "created_ts": "2026-10-07T09:15:05.204000+00:00",
    "updated_ts": "2026-10-07T09:15:05.230000+00:00",
    "ip": "10.0.4.17",
    "user": "dev.ops",
    "host": "files-01",
    "class": "data_exfiltration",
    "probability": 0.81,
    "anomaly_score": 0.93,
    "reasons": [
      {"feature": "bytes_out_ip_60s", "value": 31457280, "baseline": 9250000, "contribution": 0.42,
       "sentence": "3.4× this address's normal bytes out"}
    ]
  },
  "server_ts": "2026-10-07T09:15:05.240000+00:00"
}
```
(`reasons` shortened to one here. On the wire it holds up to 3.)

---

## 6. WebSocket messages that exist today

### `hello`: right after connect
```json
{"type": "hello", "data": {"username": "analyst", "role": "analyst"}, "server_ts": "2026-10-07T09:14:58.120000+00:00"}
```
An invalid or expired token: the server accepts, then closes with code **4401** (reason "invalid or expired token"). The dashboard signs out.

### `events`: every 250 ms when there are events
```json
{"type": "events", "data": ["...enriched events, as in 3.4"], "server_ts": "2026-10-07T09:15:02.650113+00:00", "dropped": 0}
```
- At most 200 events per message. `dropped` counts the events skipped under heavy load (the oldest in the batch).
- Here `rule_hits` is an array, `features` is an object, and there is no `stored_ts` (these events come straight from Kafka, before ClickHouse).
- The consumer starts at the latest offset, so events from before the API started are not replayed.

### `alert`: a new alert was stored
`data` is the incident row (3.6; gains section 5's fields). A repeated `alert_id` is stored and sent once.

### `incident_update`: someone changed an incident
`data` is the incident row after a `PATCH /incidents/{id}`.

### `pong`: reply to the text `ping`
```json
{"type": "pong", "server_ts": "2026-10-07T09:15:10.000400+00:00"}
```

---

## 7. Connecting and reconnecting (what the dashboard does)
1. Open the WebSocket and wait for `hello`. Retry a closed socket after 1 s, 2 s, 4 s and so on, up to 10 s. Code 4401 means sign in again.
2. Fill the screen over REST, in parallel:
   - exists: `GET /events/recent?limit=1000`, `GET /alerts/recent?limit=500`
   - new: `GET /traffic/recent?seconds=300`, `GET /kpi?minutes=15`, `GET /kpi/alerts?state=firing`, `GET /models`, `GET /jobs`, `GET /ops/alerts?state=firing`

   A 404 on a new route means that part is PENDING.
3. Apply live messages as they come. A row (alert, KPI alert, ops alert) that arrives both by REST and by WebSocket is the same row: match on `alert_id` or `id`.
4. Keep polling `GET /freshness` every 5 s and `GET /health` every 10 s, as today.

---

## 8. Inside the backend (not part of the API; suggestions for A1, A3 and B2)
These do not change what the dashboard sees. They are a default, so the two halves of track 1 fit together.
- **New Postgres tables:** `kpi_alerts` (A1); `job_runs`, `ops_alerts`, `daily_reports` (A3). New columns on `incidents` for section 5's fields (B2, ask 2).
- **New ClickHouse table:** `ml_scores` (B2). The BI views are A5's.
- **`ops` service to API:** the `ops` service writes its rows to Postgres and publishes each one to a Kafka topic `ops.events` as `{"kind": "job_run" | "ops_alert", "row": {...}}`. The API consumes it and broadcasts `job_runs` or `ops_alert`, the same way it handles `alerts` today.
- **`ml-scorer` to API:** model alerts on `alerts` (as today). A heartbeat every 5 s on a topic `models.heartbeat`, as `{"model_id", "version", "status", "scored_per_sec", "ts"}`. The API reads `trained_at` and `metrics` from the bundle folder of the version in the heartbeat.
- **The KPI loop** and the `traffic` counter run inside the API (A1). The counter needs the `alerts` consumer to mark which events a model flagged.

---

## 9. Open points
1. **`rule_hits` from `GET /events/recent`**: probably JSON text, not an array (3.4). Check on a running stack, then parse it in the API.
2. **Class names and the reason sentences**: from the ML team's bundle (B0). The examples here are placeholders.
3. **Severity of model alerts** (5.1): proposed here; the ML team may replace it.
4. **KPI threshold starting values** (3.11): placeholders until the A4 load test.
5. **`traffic.settle_seconds` = 2**: check against `ml-scorer`'s real scoring delay once B2 runs. If model verdicts often arrive later, raise it, or accept a higher `ai_late`.
6. **Daily job time zone**: `TZ` for the `ops` service (default UTC). Set it to the demo's local time if the 02:00, 03:00 and 06:00 runs should be local.
7. **Ops alert open and clear counts** (4.4): 3 checks for health and 2 for the SLA, matching the KPI rule's spirit. Change them here if A3 needs different ones.
