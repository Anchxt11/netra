"""Publish fake enriched events + alerts to Redpanda to test the WebSocket and alerts consumer
without B's processor. Usage:
  docker compose exec api python tools/mock_publish.py --rate 20 --alert-every 50
  KAFKA_BOOTSTRAP=localhost:19092 python tools/mock_publish.py   (from the host)
"""
import argparse
import asyncio
import json
import os
import random
import uuid
from datetime import datetime, timezone

from aiokafka import AIOKafkaProducer

now = lambda: datetime.now(timezone.utc).isoformat()
TYPES = ["login_failed", "login_success", "port_scan", "sql_injection", "file_download", "privilege_escalation"]
SEV = ["low", "medium", "high", "critical"]


async def main(rate: int, alert_every: int):
    p = AIOKafkaProducer(bootstrap_servers=os.getenv("KAFKA_BOOTSTRAP", "redpanda:9092"))
    await p.start()
    n = 0
    try:
        while True:
            ev_id = str(uuid.uuid4())
            ev = {
                "event_id": ev_id, "event_ts": now(), "source": random.choice(["web01", "db01", "vpn"]),
                "user": random.choice(["alice", "bob", "carol", "svc-backup"]),
                "ip": f"10.0.{random.randint(0, 9)}.{random.randint(1, 254)}",
                "event_type": random.choice(TYPES), "severity": random.choice(SEV),
                "features": json.dumps({"failed_logins_5m": random.randint(0, 30)}),
                "risk_score": round(random.random(), 3), "rule_hits": [], "processed_ts": now(),
            }
            await p.send("events.enriched", json.dumps(ev).encode())
            n += 1
            if alert_every and n % alert_every == 0:
                alert = {"alert_id": str(uuid.uuid4()), "rule_id": "brute_force_ssh", "severity": random.choice(SEV),
                         "title": "Mock alert", "event_ids": [ev_id], "created_ts": now()}
                await p.send("alerts", json.dumps(alert).encode())
                print("alert", alert["alert_id"])
            await asyncio.sleep(1 / rate)
    finally:
        await p.stop()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rate", type=int, default=10, help="events/sec")
    ap.add_argument("--alert-every", type=int, default=50, help="0 disables alerts")
    a = ap.parse_args()
    asyncio.run(main(a.rate, a.alert_every))
