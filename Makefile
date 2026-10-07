# ─── Netra Makefile ────────────────────────────────────────────────────────────
COMPOSE  := docker compose
PROFILE  := --profile sim
LAB      := --profile lab
VENV     := .venv/bin

.PHONY: help up sim lab down restart logs logs-processor logs-generator \
        build test lint topics lag status clean lab-down lab-logs attack

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ─── Docker Compose ───────────────────────────────────────────────────────────

up: ## Start infra (Redpanda, console, processor) — no generator
	$(COMPOSE) up -d --build

sim: ## Start full stack including the traffic generator
	$(COMPOSE) $(PROFILE) up -d --build

lab: ## Start lab profile (Juice Shop + nginx + attackers + Vector + normalizer)
	$(COMPOSE) $(LAB) up -d --build

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
	docker exec clickhouse clickhouse-client -u netra --password netra -q "SELECT 'events_raw', count() FROM netra.events_raw UNION ALL SELECT 'events', count() FROM netra.events UNION ALL SELECT 'events_errors', count() FROM netra.events_errors;"

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

attack-full: ## Run all core attack scenarios in sequence
	docker compose exec attacker attack-runner full

attack-evasion: ## Run all evasion (ML test) scenarios in sequence
	docker compose exec attacker attack-runner evasion_full

consume-lab: ## Consume live events from events.lab (Ctrl+C to stop)
	docker exec redpanda rpk topic consume events.lab --offset end -f json
