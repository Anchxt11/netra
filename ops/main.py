"""NETRA ops: runs the scheduled jobs, records every run, raises ops alerts (build plan A3).

    python -m ops.main

Plain Python on purpose: five fixed jobs need a clock and a thread pool, not a scheduler framework.
"""
import logging
import os
import time as systime
from concurrent.futures import ThreadPoolExecutor
from datetime import time
from pathlib import Path

from . import jobs
from .core import Daily, Every, Runner, utcnow
from .store import PgStore

HEARTBEAT = Path(os.getenv("OPS_HEARTBEAT_FILE", "/tmp/ops.alive"))  # the compose healthcheck reads its age


def schedule():
    tz = jobs.TZ
    return {
        "health_watch": (Every(10), jobs.health_watch),
        "sla_check": (Every(30), jobs.sla_check),
        "bi_rollup": (Every(60), jobs.bi_rollup),
        "daily_report": (Daily(time(6, 0), tz), jobs.daily_report),
        "model_retrain": (Daily(time(2, 0), tz), jobs.model_retrain),
        "data_retention": (Daily(time(3, 0), tz), jobs.data_retention),
    }


def connect(url: str) -> PgStore:
    for _ in range(60):
        try:
            return PgStore(url)
        except Exception as e:
            logging.warning("postgres not ready (%s), retrying", e)
            systime.sleep(2)
    raise RuntimeError("postgres unreachable")


def main():
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    store = connect(os.getenv("DATABASE_URL", "postgresql://soc:soc@postgres:5432/soc"))
    runner = Runner(store, store.notify, os.getenv("ALERT_WEBHOOK_URL") or None)
    plan = schedule()
    now = utcnow()
    # Interval jobs start at once; daily jobs wait for their time.
    due = {name: now if isinstance(s, Every) else s.next_after(now) for name, (s, _) in plan.items()}
    for name, (s, _) in plan.items():
        store.upsert_job(name, s.label(), due[name])
    running: dict[str, object] = {}
    pool = ThreadPoolExecutor(max_workers=4)  # a long retrain never holds up the health watch
    logging.info("ops scheduler started: %s", ", ".join(f"{n} {s.label()}" for n, (s, _) in plan.items()))
    while True:
        HEARTBEAT.touch()
        now = utcnow()
        for name, (sched, fn) in plan.items():
            if due[name] > now or (name in running and not running[name].done()):
                continue
            due[name] = sched.next_after(now)
            store.upsert_job(name, sched.label(), due[name])
            running[name] = pool.submit(runner.run, name, lambda fn=fn: fn(store))
        systime.sleep(1)


if __name__ == "__main__":
    main()
