# NETRA data contract

Status: updated with the backend's decisions (event schema, detection rules, attack list). Items marked (confirm) are still open. The backend's own files are in `docs/backend/`: `raw_event.schema.json`, `cyber_attack_detection_rules.pdf`, `sample_raw_events.jsonl`. If this file and those files disagree, the backend files win: tell me instead of guessing.

The frontend talks to exactly one interface, `DataSource`. Two implementations: `mockEngine` (default) and `wsSource` (real backend). Swapping them must need no UI changes.

## What the backend has decided
- **Raw events**: flat JSON, one per Redpanda message on topic `events.raw`, produced by `web_traffic_sim.py`. 16 fields. No labels.
- **Detection pipeline**: feature extraction over short rolling windows, then deterministic rules that emit small **signals** (rule IDs like `BF-4`), then a correlation engine that outputs an **attack type** and an **Attention Score**.
- **7 attack scenarios** and **2 benign anomalies** (a flash crowd and a nightly backup) that must not raise attack alerts.

## Still open (confirm)
1. How the browser receives data: WebSocket URL and message types. A browser cannot read Redpanda directly, so the backend needs a small WebSocket endpoint (FastAPI) that forwards incidents.
2. Attention Score points for every rule. The rules document only gives 5 example values. Also: is the score capped at 100?
3. Who computes the time-aware ranking (stale-by deadline, rank climbing while an incident waits). The mock computes it in the frontend for now.
4. Stale-by window per attack type.
5. Where ground-truth labels live (raw events carry none). The detection engine page needs them for its "answer key" check.
6. ATT&CK IDs and impact ratings per scenario (security lead).
7. What features ATDE reads (see "ATDE input" below).

## Three separate numbers, three separate questions
Every incident answers three questions with three different readouts. Never merge them.
| readout | question it answers | source | shown as |
|---|---|---|---|
| severity (1 to 5) | how bad is this if it is real? | static impact rating per attack type (security lead) | SevBars, no colour |
| attention score (0 to 100) | how sure are we? | sum of signal points from the correlation engine | number |
| time left to act | how long do we have? | stale-by deadline per attack type | countdown + heat colour |

The queue is grouped into three **tiers** and sorted by a **risk** value that combines all three readouts (see "Ranking" below). Rows show the attention score; the detail view shows how risk was calculated.

## Types (`src/data/types.ts`)

```ts
// Exactly the backend schema (docs/backend/raw_event.schema.json).
export interface RawEvent {
  event_id: string;        // UUID4
  event_ts: string;        // UTC ISO-8601 with ms, ends in Z
  source: "web" | "auth" | "endpoint" | "network";
  user: string;            // "-" means anonymous
  ip: string;              // client IPv4
  event_type: "http_request" | "login" | "logout" | "data_transfer" | "process_start";
  severity: "low" | "medium";  // the generator's raw flag (medium = HTTP 5xx). NOT incident severity: never display it as severity.
  status: "success" | "failure";
  host: string;            // web-01, web-02, auth-01, db-01
  bytes_out: number;
  process: string;         // command line for process_start, else ""
  method: string;          // GET, POST... or ""
  path: string;            // URL path + query, or ""
  http_status: number;     // 0 when not an HTTP event
  user_agent: string;
  response_ms: number;
}

export type AttackType =
  | "brute_force" | "credential_stuffing" | "account_takeover" | "web_scan"
  | "data_exfiltration" | "admin_abuse" | "http_flood";
export type BenignKind = "flash_crowd" | "nightly_backup";

export type HeatState = "hot" | "warm" | "cool" | "stale";
export type DetectedBy = "rule" | "ai" | "both";
export type SignalLevel = "normal" | "suspicious" | "critical";
export type IncidentStatus = "open" | "approved" | "rejected" | "expired";

export interface Signal {
  id: string;
  ts: string;
  ruleId: string;          // "BF-4", or "ATDE" when the AI engine raised it
  sentence: string;        // plain language, from the sentence templates below
  points: number;          // contribution to the attention score
  level: SignalLevel;      // from the running score: < 30 normal, 30 to 59 suspicious, >= 60 critical (confirm)
  eventIds: string[];
}

export interface Reason {           // one SHAP contribution (CRIE)
  feature: string;
  sentence: string;
  value: string | number;
  contribution: number;
}

export interface Fix {
  actionId: string;
  name: string;
  d3fend: { id: string | null; name: string };  // id filled by our security lead
  confidence: number;               // 0..1
  rank: 1 | 2 | 3;
  reasons: Reason[];
}

export interface Incident {
  id: string;
  attackType: AttackType;
  name: string;                     // "Credential stuffing"
  mitre: { id: string; name: string; tactic: string };
  severity: 1 | 2 | 3 | 4 | 5;
  attentionScore: number;           // 0..100 (confirm cap)
  detectedBy: DetectedBy;
  createdAt: string;
  staleBy: string;                  // ISO deadline
  status: IncidentStatus;
  entities: { users: string[]; ips: string[]; hosts: string[] };
  signals: Signal[];                // in time order; this IS the "how it escalated" story
  fixes: Fix[];                     // empty while CRIE is pending
  fallback?: { technique: string; mitigations: { id: string; name: string }[] };
}

// A spike the system noticed and judged NOT to be an attack. Showing these is
// how we prove NETRA does not cry wolf.
export interface BenignAnomaly {
  id: string;
  kind: BenignKind;
  name: string;                     // "Flash crowd"
  ts: string;
  sentence: string;                 // "Traffic up 4x, but users, paths and success rate look normal."
  checks: { label: string; passed: boolean }[];  // the conditions from the rules document
}

export interface ModelStatus {
  name: "ATDE" | "CRIE";
  version: string;
  trainedAt: string | null;
  status: "ready" | "training" | "failed" | "pending";
}

export interface PipelineHealth {
  feed: "live" | "stalled" | "down";
  lastEventAt: string;
  eventsPerSec: number;
  eventsToday: number;
  freshnessMs: { p50: number; p95: number };
  slaMs: 5000;
  freshnessHistory: { t: string; p95: number }[];
  detections: { rule: number; ai: number };
  detectionsPerMin: { t: string; rule: number; ai: number }[];  // last 30 minutes, for the DETECTIONS / MIN chart (confirm with backend)
  expiredToday: number;
  judgedNormalToday: number;
  models: ModelStatus[];
  retraining: { lastRun: string | null; nextRun: string | null; status: "ok" | "failed" | "scheduled" };
  alerts: { id: string; ts: string; sentence: string }[];
  decisions: { approved: number; rejected: number };
}
```

## WebSocket envelope (confirm)
`{ "type": ..., "payload": ... }`
| type | payload | frontend action |
|---|---|---|
| `incident.upsert` | `Incident` | insert or replace by id, re-rank |
| `incident.expire` | `{ id }` | move to "expired today" |
| `benign.upsert` | `BenignAnomaly` | add to "judged normal" |
| `health` | `PipelineHealth` | replace |
| `hello` | `{ serverTime }` | correct clock skew for countdowns |
Frontend to backend: `{ "type": "decision", "payload": { incidentId, actionId, decision: "approve" | "reject" } }`

## Heat (`src/lib/heat.ts`)
```ts
remaining = clamp((staleBy - now) / (staleBy - createdAt), 0, 1)
heat = remaining <= 0 ? "stale" : remaining > 0.66 ? "hot" : remaining > 0.33 ? "warm" : "cool"
goingCold = remaining > 0 && remaining < 0.15
```

## Ranking (`src/lib/rank.ts`)
One sentence for the pitch: **risk = how bad × how sure × how soon, and analysts only need to read the top tier.**

```ts
bad    = severity / 5                       // 0.2 .. 1
sure   = attentionScore / 100               // 0 .. 1
soon   = 0.5 + 0.5 * (1 - remaining)        // 0.5 when fresh, 1.0 at the deadline
risk   = bad * sure * soon                  // 0 .. 1, climbs while the incident waits

tier =
  attentionScore < 30              ? "WATCH"      // weak evidence never jumps the queue
: risk >= 0.45 && attentionScore >= 50 ? "ACT NOW"
: risk >= 0.20                     ? "ACT SOON"
:                                    "WATCH"

sort: tier (ACT NOW, ACT SOON, WATCH), then risk descending, then time left ascending
```

Why this shape:
- **Multiplying** means an incident must be serious, well-evidenced and time-bound to reach the top. A severe but barely evidenced alert can't outrank a well-evidenced one.
- **The urgency floor of 0.5** means fresh incidents still count; urgency doubles as the deadline approaches, so a waiting incident climbs tiers on its own. That is the time-aware ranking, and the demo shows it happening.
- **Tiers** exist because a list sorted by one number still forces the analyst to decide where to stop reading. Tiers decide for them.
- **Transparency**: the detail view prints the calculation, e.g. `RISK 0.50 = SEV 5/5 × ATTENTION 100 × URGENCY 0.50`.

Worked examples (use these to test `rank.ts`):
| incident | sev | attention | remaining | risk | tier |
|---|---|---|---|---|---|
| credential stuffing, account taken over | 5 | 100 | 1.0 | 0.50 | ACT NOW |
| HTTP flood, just started | 4 | 70 | 0.9 | 0.31 | ACT SOON |
| same flood, 80% of its window gone | 4 | 70 | 0.2 | 0.50 | ACT NOW |
| data exfiltration, thin evidence | 5 | 45 | 0.5 | 0.34 | ACT SOON (attention under 50) |
| brute force | 3 | 60 | 0.3 | 0.31 | ACT SOON |
| web scan | 2 | 40 | 0.5 | 0.12 | WATCH |

Where it runs: the frontend computes it for now. If the backend adopts it (confirm), the frontend just displays the backend's values with the same formula shown.

## Attack scenarios (from the rules document)
ATT&CK IDs, impact and windows are PROVISIONAL until the security lead confirms.

| attackType | UI name | rules | ATT&CK (confirm) | severity (confirm) | stale-by (confirm) |
|---|---|---|---|---|---|
| brute_force | Brute force | BF-1 to BF-4 | T1110.001 Password Guessing | 3 (5 once BF-4 fires) | 10 min |
| credential_stuffing | Credential stuffing | CS-1 to CS-3 | T1110.004 Credential Stuffing | 4 | 10 min |
| account_takeover | Account takeover | ATO-1 to ATO-3 | T1078 Valid Accounts | 5 | 5 min |
| web_scan | Web scan and probing | WS-1 to WS-4 | T1595.003 Wordlist Scanning; T1190 when WS-4 fires | 2 (3 with WS-4) | 15 min |
| data_exfiltration | Data exfiltration | EX-1 to EX-5 | T1567 Exfiltration Over Web Service | 5 | 10 min |
| admin_abuse | Admin abuse | AA-1 to AA-3 | T1078.003 Local Accounts; per command T1003.008, T1136, T1053.003 | 5 | 5 min |
| http_flood | HTTP flood | HF-1 to HF-4 | T1499.002 Service Exhaustion Flood | 4 | 3 min |

Benign anomalies (never enter the incident queue):
| kind | UI name | judged normal because (checks) |
|---|---|---|
| flash_crowd | Flash crowd | traffic spike, but normal user distribution, normal paths, normal success rate |
| nightly_backup | Nightly backup | user is svc_backup, process is `pg_dump --format=custom appdb`, known DB host, expected backup time |

## Attack families (`src/lib/family.ts`)
The THREAT SCOPE groups incidents into six sectors, 60° apart; blips spread ±26° within their sector by a stable hash of the incident id, so they don't jump between renders.
| family | attack types | sector centre (degrees, 0 = right, clockwise) |
|---|---|---|
| IDENTITY | brute_force, credential_stuffing, account_takeover | -90 |
| WEB | web_scan | -30 |
| FLOOD | http_flood | 30 |
| DATA | data_exfiltration | 90 |
| ADMIN | admin_abuse | 150 |
| UNKNOWN | unusual_activity (the AI engine alone, naming no attack; live backend only) | 210 |
Blip distance from centre = `min(timeLeftMinutes / 10, 1) × radius`; size = `2.5 + attention / 100 × 4.5` px; colour = heat state.

## Signal sentence templates (plain language for every rule)
Use these exact sentences in the UI; the rule ID sits beside them in mono.
| rule | sentence template |
|---|---|
| BF-1 | {n} failed logins for {user} in 5 minutes |
| BF-2 | {n} failed logins from {ip} in 5 minutes |
| BF-3 | {pct}% of {user}'s logins failed in 5 minutes |
| BF-4 | {user} logged in successfully after {n} failures |
| CS-1 | {ip} tried {n} different accounts in 5 minutes |
| CS-2 | {n} failed logins across {m} accounts from {ip} |
| CS-3 | {k} addresses are targeting the same group of accounts |
| ATO-1 | {user} logged in from an address never seen for them |
| ATO-2 | New address, then a sensitive action within 10 minutes |
| ATO-3 | New address and new browser, with unusually high activity |
| WS-1 | Requested a sensitive path: {path} |
| WS-2 | {n} errors in 1 minute ({pct}% of requests) |
| WS-3 | {n} different paths requested in 1 minute |
| WS-4 | Injection pattern in the request ({kind}) |
| EX-1 | {size} transferred in a single transfer |
| EX-2 | {user} moved {size} in 10 minutes, far above their normal |
| EX-3 | {n} API requests in 5 minutes |
| EX-4 | {n} pages fetched in sequence |
| EX-5 | Unusual login followed by a large transfer |
| AA-1 | Admin login at {time}, outside working hours (or: from an unusual address) |
| AA-2 | Suspicious command: {process} |
| AA-3 | Admin login, suspicious command and large transfer in one window |
| HF-1 | Requests per second at {x}x normal |
| HF-2 | {n} different addresses per minute, far above normal |
| HF-3 | Responses slowing and server errors rising |
| HF-4 | Rate spike, source spike and server errors together |

Points: the rules document gives examples only (new IP +20, new user agent +15, unusual login context +20, sensitive action +25, high API activity +30). The mock uses these, and +20 for any rule without a value, until the backend publishes the full table (confirm).

## Remediation action list (security lead owns; names only until D3FEND IDs are filled)
Block source IPs, Rate-limit login endpoint, Enable MFA, Reset credentials, Lock account, Revoke active sessions, Alert account owner, Add WAF rule for injection patterns, Block sensitive paths, Throttle API access for user, Suspend data export, Disable admin account, Kill suspicious process, Challenge traffic at the edge.

## ATDE input (confirm with the ML pair: this is a team risk, not just a frontend detail)
The live events use the 16-field schema above, while ATDE's base model was trained on WitFoo Precinct6, which has 38 different columns. A model can only score the fields it was trained on. The ML pair must say which one is true:
- (a) ATDE is trained or fine-tuned on features computed from the generator's events (rolling-window features like failed logins per user in 5 minutes), or
- (b) there is a mapping layer from the 16 fields into WitFoo's features.
The detection engine page shows whatever features ATDE actually reads, listed under `features` in the fixture.

## Fixtures from the ML team (`src/data/fixtures/`)
Top-level `"source"`: `"model-export"` for real output, `"example"` for placeholders. While it is `"example"`, the engine pages show an "example data" chip, never a model version.

`atde_samples.json`
```json
{
  "source": "example",
  "model": { "name": "ATDE", "version": "0.1.0", "trainedAt": "2026-09-29", "trainingData": "confirm with ML pair" },
  "metrics": { "precisionMalicious": null, "recallMalicious": null, "scoringLatencyMsP95": null },
  "rulesChecked": 26,
  "anomalyHistogram": { "binEdges": [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], "counts": [5, 40, 210, 480, 390, 160, 50, 12, 4, 2], "threshold": 0.62 },
  "classes": ["benign", "brute_force", "credential_stuffing", "account_takeover", "web_scan", "data_exfiltration", "admin_abuse", "http_flood"],
  "samples": [
    {
      "event": { "event_id": "0b1c5e0e-8a35-4f0e-9d0b-3c1f5a7f0a01", "event_ts": "2026-10-01T09:15:02.417Z", "source": "auth", "user": "maria.silva", "ip": "84.12.33.201", "event_type": "login", "severity": "low", "status": "failure", "host": "auth-01", "bytes_out": 312, "process": "", "method": "POST", "path": "/login", "http_status": 401, "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", "response_ms": 161 },
      "features": { "failed_logins_user_5m": 6, "failed_logins_ip_5m": 31, "unique_users_ip_5m": 24, "failure_rate_user_5m": 0.86 },
      "rules": { "fired": ["CS-1", "CS-2"] },
      "anomalyScore": 0.81,
      "classProbs": { "benign": 0.03, "brute_force": 0.07, "credential_stuffing": 0.84, "account_takeover": 0.03, "web_scan": 0.01, "data_exfiltration": 0.01, "admin_abuse": 0.0, "http_flood": 0.01 },
      "predicted": "credential_stuffing",
      "mitre": { "id": "T1110.004", "name": "Credential Stuffing" },
      "severity": 4,
      "groundTruth": null,
      "latencyMs": 3.2
    }
  ]
}
```

`crie_samples.json`: unchanged in shape; the example incident is credential stuffing with key features `failed_logins_ip_5m`, `unique_users_ip_5m`, `distinct_ips_campaign`, and the fallback example is T1110 with MITRE mitigations M1032 Multi-factor Authentication, M1036 Account Use Policies, M1027 Password Policies (security lead to double-check on attack.mitre.org).

## Mock engine (`src/data/mockEngine.ts`)
- Emits the same envelope messages as the real socket, on timers, with a deterministic seed.
- Generates events and incidents in the real schema: hosts `web-01`, `web-02`, `auth-01`, `db-01`; users like `maria.silva`, `j.okafor`, `admin`, `svc_backup`; paths from the rules document's sensitive-path list; user agents including `sqlmap/1.7.2#stable` for scans; IPs from documentation ranges 203.0.113.x, 198.51.100.x, 192.0.2.x.
- Background: a new incident every 6 to 15 s from the 7 scenarios, 6 to 10 open at once, risk and tiers recomputed every second, spread so each tier has entries. One benign anomaly every few minutes.
- Health: 180 to 260 events/s, freshness p95 between 900 and 2400 ms, rule/AI split around 70/30. `detectionsPerMin` holds 30 entries (1 to 4 rule and 0 to 2 AI detections per minute), shifted once a minute.

## Scripted demo scenarios (`?demo=1`)
**Shift+A: credential stuffing that turns into an account takeover**
- 0 to 8 s: events/s climbs; nothing crosses a threshold yet.
- 8 s: incident "Credential stuffing", T1110.004, detected by rule. From here, the current minute of `detectionsPerMin` jumps (about 8 rule and 3 AI), so the chart shows the spike and its "ATTACK STARTS" marker. Signal CS-1: "203.0.113.24 tried 34 different accounts in 5 minutes" (+20). Attention 20.
- 11 s: CS-2 "212 failed logins across 34 accounts from 203.0.113.24" (+20), then CS-3 "6 addresses are targeting the same group of accounts" (+20). Attention 60, level critical.
- 15 s: an AI engine signal (ruleId "ATDE", cyan): "AI engine: this login pattern is unusual (score 0.81)" (+20), then ATO-1 "maria.silva logged in from an address never seen for them" (+20). Name becomes "Credential stuffing, account taken over", severity 5, attention 100, risk 0.52. detectedBy becomes "both". The row jumps from ACT SOON into ACT NOW and is auto-selected. The escalation panel now reads "5 SIGNALS, 2 ENGINES".
- 17 s: fixes arrive: 1 Enable MFA (0.88), 2 Revoke active sessions (0.83), 3 Reset credentials (0.79). "Block source IPs" ranks lower because the attack is spread over many addresses: point this out when presenting.
- Presenter clicks "Approve fix". Toast. Decisions counter increments.

**Shift+B: flash crowd (the "not an attack" moment)**
- events/s jumps about 4x for 20 s. After 6 s a "judged normal" entry appears: "Flash crowd. Traffic up 4x, but users, paths and success rate look normal." with all four checks shown. No incident is created. `judgedNormalToday` increments.

**Shift+F: feed failure**
- OSD shows a pink pulsing "● FEED STALLED" for 5 s, then "● FEED DOWN", with the alert "Live feed stopped 12 s ago. Showing the last known state." Recovers after 15 s.

**Shift+R** resets everything.
