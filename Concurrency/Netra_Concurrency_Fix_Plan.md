# Netra --- Concurrency Fix Plan

## Scope

This document addresses **only concurrency correctness** in the current
`feat/event-gen` repository.

Goal:

> Multiple real HTTP requests/events can arrive at the same time without
> the pipeline losing events, creating unsafe duplicate processing, or
> corrupting the state used by detection rules.

The live path is:

``` text
Attacker(s)
   ↓
NGINX
   ↓
Juice Shop
   ↓
NGINX access log
   ↓
Vector
   ↓
events.lab
   ↓
Lab Normalizer
   ↓
events.raw
   ↓
Processor / Rule Engine
   ↓
events.enriched + alerts
   ↓
ClickHouse / PostgreSQL / API
```

## Only make these changes

### 1. Fix the processor's per-event `flush()`

**File:** `../processor/consumer.py`

### Current problem

The processor currently does this for every input event:

``` python
self.producer.produce(...)
...
self.producer.flush()
self.consumer.commit(...)
```

`flush()` waits for the producer to finish sending its queued messages
before the processor consumes the next event.

Under concurrent HTTP traffic, this unnecessarily serializes the
processor:

``` text
event 1 → produce → WAIT → commit
event 2 → produce → WAIT → commit
event 3 → produce → WAIT → commit
```

This defeats much of the benefit of Redpanda batching and makes the
processor much more likely to become the bottleneck during the HTTP
flood test.

### Required change

Remove the per-event:

``` python
self.producer.flush()
```

Use:

``` python
self.producer.poll(0)
```

after producing.

The processor should continuously consume and enqueue output messages,
rather than waiting after every event.

### Important: keep manual input commits

Do **not** change:

``` python
'enable.auto.commit': False
```

and do not move the commit before successful output.

The desired sequence remains:

``` text
consume input
   ↓
process
   ↓
produce enriched event
   ↓
produce alert(s)
   ↓
confirm producer delivery
   ↓
commit input offset
```

The exact implementation must ensure the input is not committed before
the output has successfully been handed off.

### Minimal implementation

Replace:

``` python
self.producer.produce(
    ENRICHED_TOPIC,
    key=str(event.get('ip','')),
    value=json.dumps(enriched,separators=(',',':'))
)

for hit in hits:
    self.alert_emitter.emit(hit.rule_id,hit.severity,event)

self.producer.flush()
self.consumer.commit(message=msg,asynchronous=False)
```

with the equivalent batched approach:

``` python
self.producer.produce(
    ENRICHED_TOPIC,
    key=str(event.get('ip','')),
    value=json.dumps(enriched,separators=(',',':'))
)

for hit in hits:
    self.alert_emitter.emit(hit.rule_id, hit.severity, event)

self.producer.poll(0)

# Commit only after successful processing/output handling.
self.consumer.commit(message=msg, asynchronous=False)
```

If `AlertEmitter.emit()` itself requires delivery confirmation, make
sure that its producer delivery is also checked before committing.

**Do not introduce Python threads here yet.**

------------------------------------------------------------------------

# 2. Preserve partition-based ordering for the stateful Rule Engine

**Files:**

- `../lab/normalizer/normalizer.py`
- `../processor/rule_engine.py`
- `../../../Downloads/Microsoft Innovate/docker-compose.yaml`

### Why this matters

`RuleEngine` is stateful:

``` python
self.windows = defaultdict(deque)
```

Windowed rules remember events by:

``` python
(rule.id, event.ip)
```

For example:

``` text
IP 172.30.0.10
   ↓
failed login #1
failed login #2
failed login #3
failed login #4
failed login #5
   ↓
brute_force
```

If events from the same IP are processed by independent workers without
ordering, the window state can become incorrect.

### Good news

Your normalizer already does:

``` python
key=event["ip"].encode("utf-8")
```

and your topics have 3 partitions.

**Keep this. Do not change the key.**

That gives:

``` text
same IP → same Redpanda partition
```

Therefore events from one attacker remain ordered within that partition,
while different IPs can be processed concurrently.

### Do NOT do this

Do not add:

``` python
ThreadPoolExecutor
```

or:

``` python
asyncio.gather(...)
```

around individual processor events.

That would allow:

``` text
IP A event 1
IP A event 2
IP A event 3
```

to execute concurrently and could corrupt the rule-window semantics.

### If you later run multiple processor containers

All processor replicas must use the same:

``` text
PROCESSOR_GROUP_ID=netra-processor
```

Then Redpanda distributes partitions between them.

With 3 partitions:

``` text
Processor A → partition 0
Processor B → partition 1
Processor C → partition 2
```

Events from one IP remain on one partition.

For the hackathon, **one processor container is acceptable initially**.
Only scale to 2--3 replicas if measurements show the processor cannot
keep up.

------------------------------------------------------------------------

# 3. Make Vector's buffer persistent

**File:** `../lab/vector.yaml`

### Current problem

Vector currently uses:

``` yaml
buffer:
  type: memory
  max_events: 500
```

A memory-only buffer is vulnerable to losing queued telemetry if Vector
restarts while events are waiting to be delivered.

During a concurrent attack:

``` text
NGINX
  ↓
many log lines
  ↓
Vector
  ↓
Redpanda temporarily slower
  ↓
Vector buffer fills
```

The buffer should be disk-backed so temporary downstream pressure does
not turn into immediate event loss.

### Required change

Change the sink buffer from memory to disk.

Use a disk buffer with a reasonable size for the lab.

For example:

``` yaml
buffer:
  type: disk
  max_size: 268435456
```

The exact size is not important for correctness; the important change
is:

``` text
memory → disk
```

### Do not change

Keep:

``` yaml
batch:
  timeout_secs: 0.1
```

The current batching is appropriate for keeping latency low.

------------------------------------------------------------------------

# 4. Make ClickHouse resilient to processor retries

**File:** `../infrastructure/clickhouse/init/03_events_enriched.sql`

### Why this matters

The processor uses manual Kafka commits.

That is correct because you do not want to commit an event before
processing succeeds.

But it creates an unavoidable failure case:

``` text
process event
   ↓
publish events.enriched
   ↓
processor crashes BEFORE Kafka offset commit
   ↓
same input event is delivered again
```

Therefore the system is effectively **at-least-once**.

That means downstream storage must tolerate duplicate delivery.

Your current table is:

``` sql
ENGINE = MergeTree
```

and:

``` sql
INDEX idx_event_id ...
```

The bloom-filter index is only a lookup optimization.

It does NOT make `event_id` unique.

### Required change

Make the final enriched-event table retry-safe by using a
replacing/deduplicating table keyed by `event_id`.

Use a `ReplacingMergeTree` design with `event_id` included in the
sorting key.

For example, change the final table to the equivalent of:

``` sql
ENGINE = ReplacingMergeTree(stored_ts)
PARTITION BY toDate(stored_ts)
ORDER BY (event_id)
```

The important properties are:

``` text
event_id = logical identity
duplicate delivery = same event_id
ClickHouse = eventually keeps one version
```

Keep the Kafka table and materialized view structure unchanged unless
ClickHouse requires a small syntax adjustment.

### Important

This is for **retry safety**, not because concurrent ClickHouse
ingestion itself is unsafe.

ClickHouse is already configured with:

``` sql
kafka_num_consumers = 3
```

and the topic has 3 partitions.

That part is fine.

------------------------------------------------------------------------

# 5. Do not let the dashboard consumer become part of the reliable event path

**File:** `../api/app/consumers.py`

### Current design

The API consumes:

``` text
events.enriched
```

and places events into:

``` python
_event_buf
```

Then the WebSocket flusher sends batches to browsers.

The queue is deliberately bounded and drops old dashboard messages when
overloaded.

This is actually the correct behavior for a live dashboard.

### Do NOT change

Keep the bounded WebSocket queue.

A slow browser must NOT be allowed to block:

``` text
processor
Redpanda
ClickHouse
alert detection
```

The dashboard is a presentation layer, not the durable event store.

### One change

Do not rely on the API WebSocket consumer for event durability.

Your authoritative stores are:

``` text
ClickHouse → events
PostgreSQL → incidents
```

The WebSocket is:

``` text
best-effort live display
```

Therefore a dropped WebSocket message is acceptable and is NOT
considered pipeline event loss.

Do not spend hackathon time trying to make WebSockets lossless.

------------------------------------------------------------------------

# Changes NOT required for the concurrency fix

Do NOT spend time changing these unless performance testing later proves
they are bottlenecks:

### NGINX

Current:

``` nginx
worker_processes 1;
worker_connections 1024;
```

This is not the primary correctness problem.

Leave it alone for now.

### Redpanda CPU

Current:

``` yaml
--smp 1
```

This may limit throughput, but it does not create a correctness race.

Do not spend time changing it unless your measurements show Redpanda is
the bottleneck.

### Juice Shop

Do not modify Juice Shop.

It already handles multiple HTTP requests.

The concurrency problem is primarily the telemetry/detection pipeline,
not the application code.

### FastAPI/Postgres connection pooling

Already uses a PostgreSQL pool.

No concurrency change is required for the hackathon.

### WebSocket queues

The bounded queue/drop-oldest behavior is intentional and correct for a
high-rate live UI.

Do not make it unbounded.

------------------------------------------------------------------------

# Implementation Order

Do the changes in this order.

## Step 1 --- Processor

Edit:

``` text
processor/consumer.py
```

Remove the per-event:

``` python
producer.flush()
```

Keep:

``` python
enable.auto.commit = False
```

Keep manual commit after successful output handling.

Use:

``` python
producer.poll(0)
```

to allow delivery callbacks/progress without blocking on every event.

------------------------------------------------------------------------

## Step 2 --- Keep IP partitioning

Verify the normalizer still has:

``` python
key=event["ip"].encode("utf-8")
```

Do not replace it with random keys.

Do not remove it.

This is what protects the stateful window rules when processing
concurrent traffic.

------------------------------------------------------------------------

## Step 3 --- Vector disk buffer

Edit:

``` text
lab/vector.yaml
```

Change:

``` yaml
buffer:
  type: memory
  max_events: 500
```

to a disk-backed buffer, e.g.:

``` yaml
buffer:
  type: disk
  max_size: 268435456
```

------------------------------------------------------------------------

## Step 4 --- ClickHouse retry safety

Edit:

``` text
infrastructure/clickhouse/init/03_events_enriched.sql
```

Change the final:

``` sql
ENGINE = MergeTree
```

to a retry-safe replacing engine and make `event_id` part of the
ordering key.

Example:

``` sql
ENGINE = ReplacingMergeTree(stored_ts)
PARTITION BY toDate(stored_ts)
ORDER BY (event_id)
```

Because ClickHouse initialization scripts run when the database volume
is first initialized, recreate the ClickHouse volume when testing the
schema change.

For a clean hackathon environment:

``` bash
docker compose down
docker volume rm netra_clickhouse-data
docker compose up
```

Use the actual volume name shown by:

``` bash
docker volume ls
```

if Docker Compose generated a project-prefixed name.

------------------------------------------------------------------------

# Step 5 --- Test concurrency

Use the existing real HTTP attack path.

Do NOT switch to the synthetic generator.

Use the live lab:

``` bash
make lab
```

Then run the existing HTTP flood:

``` bash
make attack SCENARIO=http_flood
```

The important test is not simply whether the attack succeeds.

Measure:

``` text
HTTP requests generated
        ↓
NGINX log lines
        ↓
events.lab
        ↓
events.raw
        ↓
processor processed events
        ↓
events.enriched
        ↓
unique event_ids in ClickHouse
```

For N requests, the target is:

``` text
unique event_ids ≈ N
```

with no unexpected loss.

------------------------------------------------------------------------

# Final Concurrency Architecture

After these changes:

``` text
                 REAL CONCURRENT HTTP
                         │
                         ▼
                      NGINX
                         │
                         ▼
                    access log
                         │
                         ▼
                  Vector (disk buffer)
                         │
                         ▼
                  Redpanda events.lab
                         │
                         ▼
                    Normalizer
                  key = source IP
                         │
                         ▼
                  events.raw
                         │
             ┌───────────┼───────────┐
             ▼           ▼           ▼
          Partition 0  Partition 1  Partition 2
             │           │           │
             └───────────┼───────────┘
                         ▼
                    Processor
                         │
                  state per partition
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
      events.enriched              alerts
             │                       │
             ▼                       ▼
       ClickHouse                 Postgres
       retry-safe                 unique alert_id
             │
             ▼
         Dashboard
       best-effort WS
```

## Definition of "concurrency solved"

For this project, you do **not** need every component to run on multiple
threads.

You need these guarantees:

1.  **Concurrent HTTP requests can reach NGINX and be logged.**
2.  **Vector can buffer bursts without relying only on RAM.**
3.  **Events are partitioned by source IP.**
4.  **Events from the same IP retain ordering.**
5.  **Different IPs can be processed concurrently.**
6.  **The processor does not block on `flush()` after every event.**
7.  **Input offsets are not committed before processing/output
    succeeds.**
8.  **Processor retries do not create permanent duplicate events.**
9.  **A slow dashboard/browser cannot block detection.**

That is the minimum set of changes I would implement for the hackathon.

**Do not add arbitrary threading, Redis, another queue, another
database, or rewrite Juice Shop. Those would add complexity without
solving the core concurrency problem.**
