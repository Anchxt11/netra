# NETRA freshness SLA

Written 2026-10-07 (build plan A2). The numbers in "Results" come only from the load test, which the backend team owns (their concurrency docs, build plan A4); until they fill it the table is empty.

## Definition
**Time to screen**: from the moment an event happens (`event_ts`, set where the event is created: the simulator or the Juice Shop capture) to the moment the analyst's browser receives it over the WebSocket. Rendering adds under one frame on top.

**Pipeline freshness** (what `GET /freshness` reports) is a different, shorter measure: `event_ts` to `stored_ts` in ClickHouse. It tells us the data is fresh where Power BI and the history read it. The screen path does not go through ClickHouse.

## Target
**p95 time to screen at most 5 s, at up to 10× normal load** (normal = 10 events/s, so up to 100 events/s), with up to 100 dashboards open. Measured per minute. The same 5 s is the config key `freshness_sla_p95_seconds` that `/freshness` uses.

## Budget per hop (p95)
The screen path, in order. The budget adds up to 5 s with room left over; a hop that uses more than its share is where to look first.

| hop | from → to | budget | measured by |
|---|---|---|---|
| 1. Source | event happens → on Redpanda `events.raw` | 0.3 s | (in hop 2: `event_ts` is set at the source) |
| 2. Redpanda + processor | `events.raw` → enriched on `events.enriched` | 0.7 s | `processed_ts - event_ts` |
| 3. API | `events.enriched` → pushed on the WebSocket (batched every 250 ms) | 1.0 s | `server_ts - processed_ts` |
| 4. Network + browser | pushed → received by the browser | 0.5 s | browser receive time (corrected) `- server_ts` |
| **Time to screen** | | **2.5 s, target 5 s** | browser receive time (corrected) `- event_ts` |
| ClickHouse (side path) | `events.enriched` → stored | 1.5 s | `stored_ts - processed_ts` (ClickHouse's Kafka engine, reading Redpanda, flushes every 500 ms) |

## How each time is taken
| time | set by | where |
|---|---|---|
| `event_ts` | the source, when the event happens | in the event (raw schema) |
| `processed_ts` | the processor, after rules and scoring | in the enriched event |
| `stored_ts` | ClickHouse, when the materialized view writes the row | `netra.events` |
| `server_ts` | the API, when it puts a message on the WebSocket | every WebSocket message |
| browser receive | the dashboard, `Date.now()` when the `events` message arrives, plus the clock offset | `frontend/src/data/backend/screenTime.ts` |

**Clock offset.** The browser's clock and the server's are not the same. On connect the API sends `hello` with its `server_ts`; the dashboard keeps `offset = server_ts - Date.now()` and adds it to every receive time, so time to screen is on the server's clock. The offset includes hello's one-way network delay, so it errs high by that much (milliseconds on a LAN). The source machine's clock must be in sync with the server's (NTP): with Docker on one laptop it is the same clock.

**Per minute.** The dashboard keeps every event's time to screen for the current minute, and when the minute ends it takes the p95 (at most 20,000 samples per minute, kept evenly). SYSTEM shows the last finished minute next to pipeline freshness, with the last 30 minutes as a small line.

## On a breach
- **On screen (A2, built):** a minute with time to screen p95 over 5 s turns the SYSTEM row red with OVER and raises a `kpi_alert` of kind `sla` (origin `browser`, see `contracts/LIVE_API.md` 4.2): a toast says so. The next minute within 5 s clears it. This is per browser: a slow laptop shows its own breach.
- **On the server (A3, to build):** the `ops` service's `sla_check` every 30 s compares `/freshness` p95 with the SLA; 2 checks in a row over it raise an `ops_alert` of kind `sla_breach`, posted to `ALERT_WEBHOOK_URL`.
- **What an operator does:** look at the per-hop table above for the hop over its budget (processor lag, events the API drops (the `dropped` count on `events` messages), ClickHouse inserts, Redpanda consumer lag), fix or scale that hop, and record the breach in the results below if it happened during a test.

## Results 
Each step runs 3 minutes. Pass = time to screen p95 at most 5 s.

Measured on the Azure VM (`netra-vm`, 4 vCPU, 16 GB) on 2026-10-08 with `make loadtest`. The generator adds the stated rate on top of the live stack (the lab's benign user, background attacks and the flow replay), so each client receives a little more than the stated rate: 13.1 events/s in the 1× row.

| load | events/s | dashboards | time to screen p50 | p95 | pipeline freshness p95 | WebSocket lag p95 | dropped | pass |
|---|---|---|---|---|---|---|---|---|
| 1× | 10 | 1 | 0.22 s | 0.56 s | 0.98 s | 0.001 s | 0 | yes |
| 1× | 10 | 25 | | | | | | |
| 1× | 10 | 100 | | | | | | |
| 5× | 50 | 1 | | | | | | |
| 5× | 50 | 25 | | | | | | |
| 5× | 50 | 100 | | | | | | |
| 10× | 100 | 1 | | | | | | |
| 10× | 100 | 25 | | | | | | |
| 10× | 100 | 100 | | | | | | |

## Concurrency check (docs/CONCURRENCY_PLAN.md, step 5)
Real HTTP traffic only: `make lab`, wait for the lab to settle, note the counts below, run `make attack SCENARIO=http_flood`, wait 30 s after it ends, and note them again. The difference at each hop should be the same N, give or take the benign user's background requests, which you can see by taking the counts twice without an attack.

| hop | command (repo root, with the stack running) |
|---|---|
| nginx log lines | `docker compose --profile lab exec nginx sh -c 'wc -l < /var/log/nginx/netra.json'` |
| `events.lab`, `events.raw`, `events.enriched` | `docker compose exec redpanda rpk topic describe events.lab -p` (and the same for `events.raw`, `events.enriched`): add up the high watermarks of the 3 partitions |
| rows and unique events in ClickHouse | `docker compose exec clickhouse clickhouse-client -u netra --password netra -q "SELECT count(), uniqExact(event_id) FROM netra.events WHERE source = 'juice-shop'"` |

Pass: unique event_ids in ClickHouse ≈ N, with no unexpected loss between hops. `count()` can briefly exceed `uniqExact(event_id)` after a processor restart: that is a replayed event, which `ReplacingMergeTree` merges away later.

| run | requests N (nginx lines added) | events.lab | events.raw | events.enriched | ClickHouse unique event_ids | ClickHouse rows | lost | pass |
|---|---|---|---|---|---|---|---|---|
| http_flood, 1 processor | 6961 | 6961 | 6960 | 6962 | 6959 | 6959 | 0 | yes |
