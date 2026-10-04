"""STANDALONE TESTING ONLY. Creates a stand-in events_enriched table and fills it with fake rows so
/events/recent and /freshness work before A's DDL exists. A's real DDL is the source of truth;
don't run this against the integrated stack.
  CLICKHOUSE_HOST=localhost python tools/seed_clickhouse.py 5000
"""
import json
import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone

import clickhouse_connect

n = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
c = clickhouse_connect.get_client(host=os.getenv("CLICKHOUSE_HOST", "localhost"),
                                  port=int(os.getenv("CLICKHOUSE_PORT", "8123")),
                                  username=os.getenv("CLICKHOUSE_USER", "default"),
                                  password=os.getenv("CLICKHOUSE_PASSWORD", ""))
c.command("""CREATE TABLE IF NOT EXISTS events_enriched (
    event_id String, event_ts DateTime64(3), source String, user String, ip String,
    event_type String, severity String, features String, risk_score Float32,
    rule_hits Array(String), processed_ts DateTime64(3), stored_ts DateTime64(3)
) ENGINE = MergeTree ORDER BY stored_ts""")
now = datetime.now(timezone.utc)
rows = []
for i in range(n):
    ev = now - timedelta(seconds=random.uniform(0, 240))
    lag = timedelta(milliseconds=random.randint(300, 2500))
    rows.append([str(uuid.uuid4()), ev, "web01", "alice", "10.0.0.5", "login_failed", "low",
                 json.dumps({"x": 1}), random.random(), [], ev + lag / 2, ev + lag])
c.insert("events_enriched", rows)
print(f"inserted {n} rows")
