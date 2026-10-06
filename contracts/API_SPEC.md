# SOC Dashboard API: spec for the frontend

Base URL: `http://localhost:8000` · WebSocket: `ws://localhost:8000/ws?token=<JWT>` · Interactive docs: `/docs`

## Auth
`POST /auth/login` with `{"username": "...", "password": "..."}` returns
```json
{"access_token": "<JWT>", "token_type": "bearer", "expires_in": 3600,
 "user": {"id": 1, "username": "analyst", "role": "analyst"}}
```
Send `Authorization: Bearer <JWT>` on every REST call. Roles: `analyst`, `admin` (admin = analyst + manage users/config).
Dev accounts: `analyst / analyst12345`, `admin / admin12345`. On `401`, go back to login. Tokens expire after 60 min.

## REST
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/login` | none | see above |
| GET | `/auth/me` | any | current user |
| GET | `/events/recent?limit=100` | any | newest first; `features` is an object |
| GET | `/alerts/recent?limit=50` | any | newest first |
| GET | `/incidents?status=&severity=&limit=50&offset=0` | any | `status`: open / acknowledged / resolved |
| GET | `/incidents/{id}` | any | adds full original alert in `payload` |
| PATCH | `/incidents/{id}` | any | body: any of `status`, `notes`, `assigned_to` |
| GET | `/freshness?minutes=` | none | the freshness tile (below) |
| GET | `/config` | any | `{key: value}` |
| PUT | `/config/{key}` | admin | body `{"value": ...}` |
| GET/POST | `/users` | admin | POST `{username, password (8+), role}` |
| GET | `/health` | none | `status` is `ok` or `degraded` (consumer or DB down) |

### `/freshness`
```json
{"window_minutes": 5, "events": 1500, "avg_events_per_sec": 5.0,
 "p50_seconds": 0.9, "p95_seconds": 1.8, "max_seconds": 2.4,
 "sla_p95_seconds": 5.0, "seconds_since_last_event": 0.4,
 "status": "ok", "computed_at": "..."}
```
`status`: `ok` | `breach` (p95 above SLA) | `stalled` (no recent events, pipeline failure) | `no_data`.
Poll every 5 s. Colour the tile by `status`.

## WebSocket
Connect with `?token=<JWT>`. Invalid or expired token: server closes with code **4401** (re-login).
Every message is `{"type": ..., "data": ..., "server_ts": "..."}`:

| type | data | when |
|---|---|---|
| `hello` | `{username, role}` | right after connect |
| `events` | array of enriched events (+ top-level `dropped`: int) | batched every ~250 ms; max 200 per message, `dropped` = events skipped under heavy load |
| `alert` | incident object (same shape as `/incidents` items) | new alert stored |
| `incident_update` | incident object | someone PATCHed an incident |
| `pong` | none | reply to sending the text `ping` |

Reconnect with backoff on close; after reconnecting, re-fetch `/events/recent` and `/alerts/recent` to fill the gap.

### Enriched event (fields as in `contracts/`)
`event_id, event_ts, source, user, ip, event_type, severity, features (object), risk_score, rule_hits, processed_ts` (REST also has `stored_ts`).

### Incident
`id, alert_id, rule_id, model, title, severity, event_ids[], status, assigned_to, notes, created_ts, updated_ts`
