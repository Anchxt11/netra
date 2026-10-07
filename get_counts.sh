#!/bin/bash
cd /home/anchit/Documents/Programs/netra

echo "---- Counts ----"
echo -n "NGINX log lines: "
docker compose --profile lab exec nginx sh -c 'wc -l < /var/log/nginx/netra.json' || echo "failed"

echo -n "events.lab high watermark sum: "
docker compose exec redpanda rpk topic describe events.lab -p | awk 'NR>1 {sum+=$6} END {print sum}' || echo "failed"

echo -n "events.raw high watermark sum: "
docker compose exec redpanda rpk topic describe events.raw -p | awk 'NR>1 {sum+=$6} END {print sum}' || echo "failed"

echo -n "events.enriched high watermark sum: "
docker compose exec redpanda rpk topic describe events.enriched -p | awk 'NR>1 {sum+=$6} END {print sum}' || echo "failed"

echo "ClickHouse rows and unique event_ids (juice-shop only):"
docker compose exec clickhouse clickhouse-client -u netra --password netra -q "SELECT count(), uniqExact(event_id) FROM netra.events WHERE source = 'juice-shop'" || echo "failed"
echo "----------------"
