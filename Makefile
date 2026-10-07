# ─── Netra Makefile ────────────────────────────────────────────────────────────
COMPOSE  := docker compose
PROFILE  := --profile sim
LAB      := --profile lab
VENV     := .venv/bin

.PHONY: help up sim lab replay down restart logs logs-processor logs-generator \
        build test lint topics lag status clean lab-down lab-logs attack auto-on auto-off \
        azure-up azure-ps azure-logs azure-down

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ─── Docker Compose ───────────────────────────────────────────────────────────

up: ## Start infra (Redpanda, console, processor) — no generator
	$(COMPOSE) up -d --build

sim: ## Start full stack including the traffic generator
	$(COMPOSE) $(PROFILE) up -d --build

REPLAY   := --profile replay

lab: ## Start lab profile (Juice Shop + nginx + attackers + Vector + normalizer)
	$(COMPOSE) $(LAB) up -d --build

replay: ## Start replay profile (flow-replay: held-out flows → flows.raw)
	$(COMPOSE) $(REPLAY) up -d --build

lab-full: ## Start both sim and lab profiles together
	$(COMPOSE) $(PROFILE) $(LAB) up -d --build

down: ## Stop and remove all containers
	$(COMPOSE) $(PROFILE) $(LAB) down

restart: down sim ## Rebuild and restart everything

build: ## Build processor and generator images
	$(COMPOSE) $(PROFILE) $(LAB) build

# ─── Logs ─────────────────────────────────────────────────────────────────────

logs: ## Tail all container logs
	$(COMPOSE) $(PROFILE) logs -f --tail 50

logs-processor: ## Tail processor logs
	$(COMPOSE) logs -f processor

logs-generator: ## Tail generator logs
	$(COMPOSE) $(PROFILE) logs -f generator

# ─── Monitoring ───────────────────────────────────────────────────────────────

status: ## Show container status
	$(COMPOSE) $(PROFILE) ps

topics: ## List Kafka topics
	docker exec redpanda rpk topic list

lag: ## Show processor consumer lag
	docker exec redpanda rpk group describe netra-processor

clickhouse-counts: ## Show event counts in ClickHouse
	echo "SELECT 'events_raw', count() FROM netra.events_raw UNION ALL SELECT 'events', count() FROM netra.events UNION ALL SELECT 'events_errors', count() FROM netra.events_errors" | docker exec -i clickhouse sh -c 'clickhouse-client -u "$$CLICKHOUSE_USER" --password "$$CLICKHOUSE_PASSWORD"'

api-health: ## Check the FastAPI backend health
	curl -s http://localhost:8000/health

smoke-test: ## Run API smoke test to verify endpoints
	@echo "Testing login..."
	@TOKEN=$$(curl -s http://localhost:8000/auth/login -H 'content-type: application/json' -d '{"username":"analyst","password":"analyst12345"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])'); \
	echo "Token received."; \
	echo "Fetching incidents..."; \
	curl -s http://localhost:8000/incidents -H "authorization: Bearer $$TOKEN"

consume-raw: ## Consume live events from events.raw (Ctrl+C to stop)
	docker exec redpanda rpk topic consume events.raw --offset end -f json

consume-enriched: ## Consume live enriched events (Ctrl+C to stop)
	docker exec redpanda rpk topic consume events.enriched --offset end -f json

consume-alerts: ## Consume live alerts (Ctrl+C to stop)
	docker exec redpanda rpk topic consume alerts --offset end -f json

# ─── Testing ──────────────────────────────────────────────────────────────────

test: ## Run all unit tests
	PYTHONPATH=. $(VENV)/pytest tests/ -v

test-quick: ## Run tests without verbose output
	PYTHONPATH=. $(VENV)/pytest tests/ -q

# ─── Utilities ────────────────────────────────────────────────────────────────

clean: ## Remove volumes, caches, and stopped containers
	$(COMPOSE) $(PROFILE) $(LAB) down -v --remove-orphans
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	rm -rf .pytest_cache htmlcov .coverage

generator-fast: ## Run generator in fast mode (no pacing, 1000 events then exit)
	$(COMPOSE) $(PROFILE) run --rm generator \
		python web_traffic_sim.py --bootstrap redpanda:9092 --fast --max-events 1000 --labels /data/labels.jsonl

generator-no-attacks: ## Run generator with clean traffic only (no attacks)
	$(COMPOSE) $(PROFILE) run --rm generator \
		python web_traffic_sim.py --bootstrap redpanda:9092 --rate 10 --no-attacks --labels /data/labels.jsonl

# ─── Lab Profile ──────────────────────────────────────────────────────────────

lab-down: ## Stop lab profile containers only
	$(COMPOSE) $(LAB) down

lab-logs: ## Tail lab container logs
	$(COMPOSE) $(LAB) logs -f --tail 50

lab-nginx-logs: ## Tail raw nginx JSON log (real data view)
	$(COMPOSE) $(LAB) logs -f nginx

lab-status: ## Show lab container status
	$(COMPOSE) $(LAB) ps

attack: ## Run an attack scenario: make attack SCENARIO=brute_force (or evasion_low_slow_brute, etc.)
	docker compose exec attacker attack-runner $(SCENARIO)

auto-on: ## Background attacks ON (attacker2, 172.30.0.11, one every 1 to 3 min; AUTO_MIN_S, AUTO_MAX_S, AUTO_EXCLUDE)
	$(COMPOSE) $(LAB) up -d attacker2

auto-off: ## Background attacks OFF, e.g. before a judge runs their own attack
	$(COMPOSE) $(LAB) stop -t 1 attacker2

attack-full: ## Run all core attack scenarios in sequence
	docker compose exec attacker attack-runner full

attack-evasion: ## Run all evasion (ML test) scenarios in sequence
	docker compose exec attacker attack-runner evasion_full

consume-lab: ## Consume live events from events.lab (Ctrl+C to stop)
	docker exec redpanda rpk topic consume events.lab --offset end -f json

# ─── Azure VM (docs/DEPLOY.md) ────────────────────────────────────────────────
AZURE := docker compose -f docker-compose.yaml -f docker-compose.azure.yaml --profile lab

azure-up: ## On the VM: build and start the whole stack behind Caddy (HTTPS)
	$(AZURE) up -d --build

azure-ps: ## On the VM: container status
	$(AZURE) ps

azure-logs: ## On the VM: tail all logs
	$(AZURE) logs -f --tail=100

azure-down: ## On the VM: stop everything (keeps data)
	$(AZURE) down
