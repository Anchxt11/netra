# ─── Netra Makefile ────────────────────────────────────────────────────────────
COMPOSE  := docker compose
PROFILE  := --profile sim
VENV     := .venv/bin

.PHONY: help up sim down restart logs logs-processor logs-generator \
        build test lint topics lag status clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ─── Docker Compose ───────────────────────────────────────────────────────────

up: ## Start infra (Redpanda, console, processor) — no generator
	$(COMPOSE) up -d --build

sim: ## Start full stack including the traffic generator
	$(COMPOSE) $(PROFILE) up -d --build

down: ## Stop and remove all containers
	$(COMPOSE) $(PROFILE) down

restart: down sim ## Rebuild and restart everything

build: ## Build processor and generator images
	$(COMPOSE) $(PROFILE) build

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
	$(COMPOSE) $(PROFILE) down -v --remove-orphans
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	rm -rf .pytest_cache htmlcov .coverage

generator-fast: ## Run generator in fast mode (no pacing, 1000 events then exit)
	$(COMPOSE) $(PROFILE) run --rm generator \
		python web_traffic_sim.py --bootstrap redpanda:9092 --fast --max-events 1000 --labels /data/labels.jsonl

generator-no-attacks: ## Run generator with clean traffic only (no attacks)
	$(COMPOSE) $(PROFILE) run --rm generator \
		python web_traffic_sim.py --bootstrap redpanda:9092 --rate 10 --no-attacks --labels /data/labels.jsonl
