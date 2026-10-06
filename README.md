# Netra — Near Real-Time SOC Dashboard

A streaming security operations center (SOC) dashboard built for the Microsoft Hackathon (Student Edition, Challenge 34). Events are generated, enriched with detection rules and risk scoring, and served to a live dashboard via WebSocket.

## Architecture

```
Generator ─► Redpanda [events.raw] ─► Processor ─► Redpanda [events.enriched] ─► ClickHouse
                                          │
                                    Rules + Scorer ─► Redpanda [alerts] ─► Postgres ─► FastAPI ─► Frontend
```

| Component          | Technology                                        |
|--------------------|---------------------------------------------------|
| Data Generator     | Python simulator (configurable rate, 7 attack types) |
| Event Stream       | Redpanda (Kafka-compatible)                       |
| Event Processing   | Python rule engine + scorer                       |
| Eventhouse         | ClickHouse (Kafka engine + MV + MergeTree)        |
| Detection / Activator | Sigma-style YAML rules + IsolationForest/XGBoost |
| Application DB     | PostgreSQL                                        |
| Live API           | FastAPI                                           |
| Live Transport     | WebSockets                                        |
| Live UI            | React + TypeScript, ECharts + Cytoscape.js        |
| Deployment         | Docker Compose                                    |

## Quick Start

```bash
# Start everything (Redpanda, processor, console)
make up

# Start with the traffic generator (includes simulated attacks)
make sim

# View logs
make logs

# Run unit tests
make test

# Stop everything
make down
```

After starting, open:
- **Redpanda Console** — [http://localhost:8080](http://localhost:8080) — inspect topics and messages live
- **FastAPI Backend** — runs on `http://localhost:8000`. Test via `curl http://localhost:8000/health`.

Check pipeline health and data flow:
```bash
# View Kafka consumer lag (should be 0)
make lag

# View event ingestion counts in ClickHouse
make clickhouse-counts
```

### API Smoke Test
To test the API manually via terminal:
```bash
# Login and get token
TOKEN=$(curl -s http://localhost:8000/auth/login -H 'content-type: application/json' -d '{"username":"analyst","password":"analyst12345"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# Fetch recent incidents
curl -s http://localhost:8000/incidents -H "authorization: Bearer $TOKEN"
```

## Project Structure

```text
netra/
├── api/                       # Team C — FastAPI backend & WebSocket
│   ├── app/                   # FastAPI routes, models, and consumers
│   ├── db/                    # Postgres migrations and init
│   ├── tools/                 # Mock publish and ClickHouse seeding tools
│   └── Dockerfile
├── contracts/                 # Frozen schemas (JSON Schema, YAML)
│   ├── raw_event.schema.json  # 16-field raw event schema
│   ├── enriched_event.json    # Raw + features, risk_score, rule_hits, processed_ts
│   ├── alert.json             # Alert schema for the alerts topic
│   ├── rule_schema.yaml       # Sigma-style rule specification
│   ├── API_SPEC.md            # Backend REST & WS API specification
│   ├── scorer.md              # Scorer interface contract
│   └── sample_raw_events.jsonl
├── infrastructure/            # Infrastructure config & scripts
│   └── clickhouse/init/       # ClickHouse MergeTree & MV definitions
├── simulator/                 # Team A — event generator
│   ├── web_traffic_sim.py     # Discrete event simulator with 7 attack scenarios
│   └── Dockerfile
├── processor/                 # Team B — stream processor + rule engine
│   ├── main.py                # Entry point
│   ├── processor.py           # Enrichment orchestrator
│   ├── rule_engine.py         # Sigma-style YAML rule engine
│   └── Dockerfile
├── rules/sigma/               # 10 Detection rules (YAML)
├── tests/                     # Unit tests (31 tests)
├── docker-compose.yaml        # Full stack definition (Redpanda, API, Processor, ClickHouse)
├── Makefile                   # Developer commands
└── pyproject.toml
```

## Data Flow

### Raw Event → Enriched Event

The processor consumes from `events.raw` and produces to `events.enriched`, adding 4 fields:

| Field          | Type            | Description                              |
|----------------|-----------------|------------------------------------------|
| `features`     | `string` (JSON) | 23 extracted features as a JSON string   |
| `risk_score`   | `float [0, 1]`  | Weighted risk score from the Scorer      |
| `rule_hits`    | `array[string]` | List of triggered rule IDs               |
| `processed_ts` | `string`        | ISO-8601 UTC timestamp of processing     |

### Alert Schema

When rules trigger, alerts are published to the `alerts` topic:

| Field        | Type              | Description                             |
|--------------|-------------------|-----------------------------------------|
| `alert_id`   | `string`          | UUID                                    |
| `rule_id`    | `string \| null`  | Matching rule ID (null if ML-generated) |
| `model`      | `string \| null`  | ML model name (null if rule-based)      |
| `severity`   | `string`          | `low`, `medium`, `high`, `critical`     |
| `event_ids`  | `array[string]`   | Contributing event IDs                  |
| `created_ts` | `string`          | ISO-8601 UTC timestamp                  |

## Detection Rules

10 Sigma-style YAML rules covering all 7 generator attack scenarios:

| Rule                   | Severity | Type     | Detects                                |
|------------------------|----------|----------|----------------------------------------|
| `brute_force`          | high     | Windowed | 5 failed logins / 60s per IP           |
| `credential_stuffing`  | high     | Windowed | 20 failed logins / 30s per IP          |
| `excessive_requests`   | medium   | Windowed | 100 HTTP requests / 60s per IP         |
| `http_flood`           | critical | Windowed | 200 HTTP requests / 30s per IP (DDoS)  |
| `web_scan`             | high     | Windowed | 10 probe-path hits / 60s (SQLi, etc.)  |
| `data_exfiltration`    | critical | Instant  | data_transfer with bytes > 50 MB       |
| `privilege_escalation` | high     | Instant  | sudo command execution                 |
| `malicious_process`    | critical | Instant  | Reverse shells, shadow reads, curl\|sh |
| `suspicious_ip`        | high     | Instant  | Known IoC IP addresses                 |
| `suspicious_login`     | medium   | Instant  | Failed login with admin username       |

### Rule Engine & Processing Logic

The Python processor continuously reads raw web traffic from `events.raw` and extracts 23 specific security features (e.g., `ua_is_scanner`, `bytes_out`). It then evaluates these features against a custom **YAML Rule Engine** inspired by Sigma.

#### How the Rule Engine Works
- **Dot-Notation**: Rules can target nested JSON keys in the enriched event, such as `features.process_has_shadow: true`.
- **Modifiers (`|` syntax)**: By default, the engine checks for exact matches. Modifiers alter this logic:
  - **Strings**: `|contains`, `|startswith`, `|endswith`, `|regex` (e.g., `process|regex: "(nc -e|curl.*\\|.*sh)"`).
  - **Numbers**: `|gt` (>), `|gte` (>=), `|lt` (<), `|lte` (<=) (e.g., `bytes_out|gt: 50000000`).
  - **Lists**: `|in` checks if a value exists within a provided list.
- **Conditions**: 
  - `condition: all` evaluates as **AND** (every criteria must match).
  - `condition: any` evaluates as **OR** (if at least one criteria matches, the rule triggers).
- **Sliding Windows**: Rate-based attacks (like DDoS or brute force) use in-memory state tracking to count events per IP address over a defined timeframe (e.g., 20 requests in 30 seconds).

If any rules trigger, the processor computes a risk score, emits an alert payload to the `alerts` Kafka topic, and forwards the fully enriched event (with features and rule hits) to the `events.enriched` topic for ClickHouse ingestion.

## Scorer Interface

```python
class Scorer(ABC):
    @abstractmethod
    def score(self, features: dict[str, Any]) -> float:
        """Return a risk score in [0.0, 1.0]."""
```

Current implementation: `DummyScorer` (heuristic weights). Drop-in replacement with `IsolationForest`/`XGBoost` model by implementing the `Scorer` interface.

## Generator Attack Scenarios

The simulator generates realistic web/auth/endpoint telemetry and injects 7 attack types after a configurable warmup period:

| Scenario              | Description                                        |
|-----------------------|----------------------------------------------------|
| `brute_force`         | Fast or low-and-slow password guessing              |
| `credential_stuffing` | Distributed login spray across many accounts        |
| `account_takeover`    | Attacker uses valid creds from a different network   |
| `web_scan`            | SQLi probes, path traversal, admin panel scanning   |
| `data_exfiltration`   | Large file exports or rapid API scraping            |
| `admin_abuse`         | Malicious commands (reverse shells, shadow reads)   |
| `http_flood`          | Distributed L7 DDoS with server degradation         |

## Freshness SLA

Each pipeline stage stamps a timestamp:

```
event_ts (generator) → processed_ts (processor) → stored_ts (ClickHouse MV)
```

The `/freshness` endpoint (Team C) returns p50/p95 of `stored_ts − event_ts` over a sliding window.

> **SLA target**: p95 end-to-end latency to be measured and documented at 1×, 5×, and 10× event rates.

## Testing

```bash
make test
```

31 tests covering:
- All 10 detection rules (windowed and instant)
- All 10 field modifiers
- `condition: all` and `condition: any`
- Enrichment contract compliance
- Raw field preservation
- Feature extraction for attack patterns

## Environment Variables

| Variable             | Default            | Description                    |
|----------------------|--------------------|--------------------------------|
| `KAFKA_BOOTSTRAP`   | `redpanda:9092`    | Kafka broker address           |
| `RAW_TOPIC`         | `events.raw`       | Input topic                    |
| `ENRICHED_TOPIC`    | `events.enriched`  | Output topic for enriched events |
| `ALERT_TOPIC`       | `alerts`           | Output topic for alerts        |
| `PROCESSOR_GROUP_ID`| `netra-processor`  | Kafka consumer group ID        |
| `RULES_DIR`         | `/app/rules/sigma` | Path to YAML rules directory   |
| `SCORER`            | `dummy`            | Scorer implementation name     |
| `LOG_LEVEL`         | `INFO`             | Python logging level           |

## Team Ownership

| Person | Owns                        | Status  |
|--------|-----------------------------|---------|
| A      | Generator, Redpanda, Docker Compose, ClickHouse DDL, Load Test | ✅ Generator & ClickHouse done |
| B      | Processor, YAML rules, Scorer interface, Alert emitter | ✅ Done (10 rules, 31 tests) |
| C      | PostgreSQL, FastAPI, WebSocket, Auth | ✅ Done (REST + WS endpoints active) |
| Frontend | React dashboard            | Pending |
| ML     | IsolationForest / XGBoost model | Pending |

## License

Hackathon project — Microsoft Student Edition Challenge 34.
