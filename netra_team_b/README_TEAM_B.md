# Team B — Processing + Detection

Owns `events.raw -> events.enriched`, feature extraction, Sigma-style YAML rules, sliding-window detection, the `Scorer` interface/dummy scorer, and publishing `alerts`.

## Local tests

```bash
pip install -r processor/requirements.txt
pytest -q tests/test_rules.py tests/test_processor.py
```

## Compose

The supplied `processor/docker-compose.override.yml` adds the processor to the existing shared Compose stack:

```bash
docker compose -f docker-compose.yml -f processor/docker-compose.override.yml up -d
```

## Contract

Enriched events preserve all raw fields and add `features` (one JSON string), `risk_score`, `rule_hits`, and `processed_ts`.

Alerts contain `alert_id`, `rule_id`, optional `model`, `severity`, `event_ids`, and `created_ts`.
