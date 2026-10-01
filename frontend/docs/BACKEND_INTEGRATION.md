# Connecting the backend to the dashboard

Written 2026-10-01 from the team repo (github.com/Anchxt11/netra). Read with `DATA_CONTRACT.md`.

## Where the backend is today
| part | branch | state |
|---|---|---|
| Traffic simulator (`generator/web_traffic_sim.py`) | `feat/person-a-infrastructure` | done. 7 attacks, 2 benign anomalies, `--scenario` to trigger one, ground-truth `labels.jsonl` |
| Kafka (Redpanda) + topics `events.raw`, `events.enriched`, `alerts` | `feat/person-a-infrastructure` | done (`docker-compose.yml`) |
| Processor: features, 10 Sigma-style rules, `DummyScorer`, alerts | `feat/person-a-infrastructure` | done, with tests |
| ClickHouse tables (`events_raw`, `events_enriched`) | `feat/person-a-clickhouse` | schema only |
| API (`api/*.py`) | both | **empty files**: nothing for the dashboard to connect to yet |
| `main` | | only the starting folders, plus our frontend |

## The gap
The dashboard shows **incidents**. The backend emits **alerts**:
`{ alert_id, rule_id, model, severity, event_ids, created_ts }`, one per rule hit per event.

| the dashboard needs | the backend has | so |
|---|---|---|
| incidents (grouped signals) | one alert per event, and a windowed rule fires again on every event past its threshold | group and de-duplicate alerts into incidents |
| attention score (0 to 100) | nothing | points per rule, summed per incident |
| severity 1 to 5 | low / medium / high / critical per rule | severity per attack type (table below) |
| time left (`staleBy`) | nothing | window per attack type (DATA_CONTRACT.md) |
| entities (addresses, users, hosts) | only `event_ids` | look the events up in `events.enriched` |
| plain sentences | rule titles | a sentence per rule (table below) |
| "detected by AI" | `risk_score` from `DummyScorer`, which is hand-written rules, not a model | **never show it as the AI engine**: ATDE shows PENDING until the real model replaces `DummyScorer` |
| health (events/s, freshness, feed status) | `processed_ts` on enriched events | compute from the enriched stream |
| fixes (CRIE) | nothing | empty, so the dashboard shows MITRE's mitigations (already built) |
| judged normal (flash crowd, backup) | nothing yet | none until the backend adds benign checks |

## The plan: one small bridge service in `api/`
A FastAPI service (the empty `api/` folder) that:
1. Reads `alerts` and `events.enriched` from Redpanda.
2. **Correlates** alerts into incidents: key = attack family + source address (user for admin rules); one signal per rule per incident, its count updated on repeats; attention = sum of rule points, capped at 100.
3. Computes **health** every second: events/s, freshness p95 (time from `event_ts` to now), detections per minute, feed live / stalled (5 s silent) / down (15 s).
4. Serves the WebSocket the frontend already speaks, at `ws://localhost:8000/ws`: `hello`, `incident.upsert`, `incident.expire`, `health` (see DATA_CONTRACT.md "WebSocket envelope").
5. Accepts `decision` messages (approve / reject) and stores them (a ClickHouse table later: CRIE's training data).

The frontend needs almost no change: `src/data/wsSource.ts` already speaks this envelope. Run it with `VITE_DATA_SOURCE=ws`.

### Proposed rule mapping (to confirm with the backend team)
| backend rule | becomes | severity | points | sentence on the dashboard |
|---|---|---|---|---|
| `brute_force` | brute_force | 3 | 20 | {n} failed logins from {ip} in a minute |
| `credential_stuffing` | credential_stuffing | 4 | 20 | {ip} is failing logins across many accounts |
| `suspicious_login` | admin_abuse | 5 | 15 | Failed login on an admin account ({user}) |
| `privilege_escalation` | admin_abuse | 5 | 20 | {user} ran a command with sudo |
| `malicious_process` | admin_abuse | 5 | 30 | Suspicious command: {process} |
| `data_exfiltration` | data_exfiltration | 5 | 30 | {size} sent out in a single transfer |
| `web_scan` | web_scan | 2 | 20 | {ip} requested sensitive or injection paths |
| `excessive_requests` | http_flood | 4 | 15 | {ip} sent over 100 requests in a minute |
| `http_flood` | http_flood | 4 | 25 | {ip} sent over 200 requests in 30 seconds |
| `suspicious_ip` | adds to that address's open incident | n/a | 15 | Traffic from a watch-listed address ({ip}) |

Notes for the backend team:
- `credential_stuffing` and `brute_force` currently match the same thing (failed logins per IP); stuffing should count **distinct users** per IP.
- Windowed rules fire on every event past the threshold, so expect alert floods. The bridge de-duplicates, but a cooldown in the processor would help.
- `account_takeover` has no rule yet (new IP then success then sensitive action).

## Build order
| phase | what | time | who |
|---|---|---|---|
| 0 | Backend merges into `main` (or names one branch); Docker Desktop on the demo laptop; stack runs locally | 30 min | backend + you |
| 1 | Agree the mapping above; update DATA_CONTRACT.md to match the real backend | 45 min | you + Claude Code |
| 2 | The bridge in `api/`: correlator (with tests on recorded alerts), health, WebSocket, decisions | 2 to 3 h | you + Claude Code, or backend |
| 3 | Frontend on the live feed: connection states, nothing branching on the source | 1 h | you + Claude Code |
| 4 | End to end with `--scenario credential_stuffing` and friends; tune points and windows | 1 h | everyone |
| 5 | Later: the real ML scorer (ATDE live), CRIE, decisions to ClickHouse, hosting the backend | later | ML + backend |

The public Vercel site stays on the simulated feed: it cannot reach a backend on someone's laptop. A live-backend demo runs locally (`npm run dev` with `VITE_DATA_SOURCE=ws`) unless the backend is hosted (for example on Azure).

## Prompts for Claude Code (paste one at a time; wait, check, commit)
Backend phases run outside `frontend/`, so open Claude Code at the repo root (or the worktree in prompt 1) for prompts 1 to 3.

**1. Get the backend running**
> Create a git worktree of origin/feat/person-a-infrastructure at ../netra-backend (don't touch my main branch). Then walk me through starting the stack with Docker step by step, and prove events are flowing on events.raw, events.enriched and alerts. Stop if Docker isn't installed and tell me what to install.

**2. Agree the contract**
> Read ../netra-backend (contracts/, processor/, rules/sigma/) and frontend/docs/BACKEND_INTEGRATION.md. Update frontend/docs/DATA_CONTRACT.md so it describes the real backend: alert shape, rule ids, severities, and the mapping table. Mark anything unconfirmed as (confirm). No code yet.

**3. Build the bridge**
> In ../netra-backend/api, build the FastAPI bridge described in frontend/docs/BACKEND_INTEGRATION.md: read alerts and events.enriched from Redpanda, correlate alerts into Incident objects exactly as in DATA_CONTRACT.md, compute PipelineHealth every second, serve the WebSocket envelope at ws://localhost:8000/ws, and accept decision messages. Never label DummyScorer output as AI: report ATDE as pending. Add unit tests for the correlator using recorded alerts, add the service to docker-compose, and give me the commands to run it.

**4. Point the dashboard at it**
> Run the frontend with VITE_DATA_SOURCE=ws against the bridge. Make the connecting and offline states clear (boot screen, header, an honest empty dashboard), check that the SIMULATED FEED chip disappears, and that nothing else in the UI depends on which source is active. Run npm run build.

**5. End to end**
> Start the simulator with --scenario credential_stuffing, then the other scenarios. Check the dashboard tells the same story as demo mode. List every difference from the mock and propose fixes (points, windows, sentences). Don't change the backend's code without asking me.
