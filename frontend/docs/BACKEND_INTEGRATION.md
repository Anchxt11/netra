# Connecting the backend to the dashboard

Updated 2026-10-06 from the team repo (github.com/Anchxt11/netra), branch `feat/person-a-infrastructure` at 2b127ea.
The frontend side is done: the dashboard runs on the real backend as it is today.

## Where things are
| part | state |
|---|---|
| Simulator, Redpanda, processor (10 rules, 31 tests), ClickHouse, Postgres, FastAPI (login, REST, WebSocket, `/freshness`) | done, one command (`make sim`), on `feat/person-a-infrastructure`, **not on `main` yet** |
| ATDE (Isolation Forest + XGBoost) | in progress; the processor still runs `DummyScorer` (hand-written weights, never shown as AI) |
| CRIE | not started: the dashboard shows MITRE's mitigations with CRIE PENDING |
| Dashboard on the real backend | **done** (this document) |
| Dashboard in the team repo | not yet: the frontend commits are only on this machine's `main` |

## How the dashboard reads the backend
Set `VITE_DATA_SOURCE=ws` (or use the `:live` scripts below). Code: `src/data/backend/`.
- **Sign in** (`/login`, `POST /auth/login`): analyst or admin. The token lives in the tab only (sessionStorage) and signs out when it expires (60 min). Every page needs a session in this mode; the simulated site needs none.
- **WebSocket** `ws://…/ws?token=…`: `hello`, `events` (enriched events, batched every 250 ms), `alert` (one row per alert). A closed socket retries (1 s, 2 s, 4 s … 10 s) and shows RECONNECTING; code 4401 signs out with "Your session ended. Sign in again."
- **On (re)connect** it reads `GET /events/recent` (1000) and `GET /alerts/recent` (500), so a reload is not empty. Repeated alerts are counted once.
- **Grouping happens in the browser** (`correlate.ts`, tested in `tests/correlate.test.ts`), because the API stores one incident per alert:
  - same attack + same source = one incident (address for logins and scans, account for admin and data, the whole site for floods);
  - one rule = one signal; repeats add points, up to double the rule's base;
  - an address failing on 3 or more accounts is credential stuffing, and stuffing addresses join one campaign (signal SPRAY);
  - a successful login from an attacking address marks the account taken over (signal IN, severity 5);
  - a failed admin login during a password attack, or a data transfer by an admin already under suspicion, joins that incident;
  - `suspicious_ip` only adds to an open incident of that address;
  - the deadline is the attack type's window from the first alert; an approved incident is closed.
- **Health** (top bar, SYSTEM): events per second as they arrive; freshness p50/p95 from `GET /freshness` every 5 s; server problems from `GET /health` every 10 s; feed STALLED after 5 s without events, DOWN after 15 s. Anything the backend does not measure shows PENDING (EVENTS TODAY, models, retraining).
- **Decisions:** approving writes the decision log into the incident's first backend row (`PATCH /incidents/{id}`, notes, status `acknowledged`). A failed save shows in pink in SYSTEM.

### Rule mapping (in `rules.ts`; severity is the backend's own: low 2, medium 3, high 4, critical 5)
| backend rule | shows as | attack type | points | grouped by |
|---|---|---|---|---|
| `brute_force` | BF | brute force, or stuffing (3+ accounts) | 20 | address |
| `credential_stuffing` | CS | the same login incident | 20 | address |
| `suspicious_login` | ADM | admin abuse (or the login attack it is part of) | 15 | account |
| `privilege_escalation` | SUDO | admin abuse | 20 | account |
| `malicious_process` | PROC | admin abuse | 30 | account |
| `data_exfiltration` | EXF | data exfiltration (admin abuse if that admin is already open) | 30 | account |
| `web_scan` | SCAN | web scan | 20 | address |
| `excessive_requests` | RATE | HTTP flood | 15 | site |
| `http_flood` | FLOOD | HTTP flood | 25 | site |
| `suspicious_ip` | IOC | adds to that address's incident | 15 | address |
| a model's alert (`rule_id` null) | ATDE | adds to that address's or account's incident | 20 | only if the model is not the dummy |

## Run it
**With the real stack (needs Docker Desktop):** in the backend checkout `make sim`, then in `frontend/`:
```
npm run dev:live            # development, http://localhost:5174
npm run build:live          # the demo build (dist-live/), then:
npm run preview:live        # http://localhost:4174
```
Sign in with the backend's development accounts (`api/app/settings.py`). Change them, and `jwt_secret`, before anything public.

**Without Docker (frontend testing):** a stand-in for the API that runs the backend team's real simulator and rule engine in Python (no Redpanda, no databases):
```
npm run live-backend -- --backend <path to a checkout of the backend branch> --rate 12 --warmup 15 --attack-every 45
npm run dev:live
```
Test switches: `POST http://localhost:8000/_dev/stall?seconds=20` (feed stalls), `/_dev/drop` (connection drops), `/_dev/expire` (session ends), `/_dev/refuse-writes?seconds=30` (decisions fail to save).

The public Vercel site stays on the simulated feed: it cannot reach a backend on a laptop.

## Asks for the backend team (small, in order of value)
1. **Merge `feat/person-a-infrastructure` into `main`**, and the frontend with it (a pull request from this machine).
2. **Put the event's `ip`, `user` and `host` in each alert** (`processor/alerts.py`). The dashboard then needs no event lookups, and history after a reload is complete (today alerts older than the last 1000 events are counted but cannot be grouped).
3. **A cooldown on windowed rules.** They fire on every event past the threshold (549 alerts in 30 minutes in our test run). The dashboard copes; the alerts table and the DETECTIONS chart would read better.
4. **`credential_stuffing` should count distinct accounts per address.** Today it counts failed logins, so a fast password guess trips it (the dashboard decides stuffing by accounts instead).
5. **Floods per site, not per address.** The simulator's flood comes from 30 to 120 addresses, so the per-address `http_flood` threshold rarely fires.
6. **ATDE:** emit a model alert (`rule_id: null`, `model: "<name and version>"`, the event's `risk_score`) above a threshold. The dashboard shows it as the AI engine automatically. Note the training data (cloud flow logs) and the simulator's events (web, login, process) have different fields: decide the feature mapping, or replay held-out flow logs as their own stream.
7. **Production settings:** `cors_origins` to the dashboard's address (today `*`), a real `jwt_secret`, non-default passwords.
8. Later: a `decisions` table (approve, reject, who, when) instead of incident notes; it becomes CRIE's training data.
