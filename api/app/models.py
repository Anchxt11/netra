"""`models` (contracts/LIVE_API.md 4.6): ATDE from ml-scorer's heartbeat row (Postgres ml_models),
CRIE pending. Broadcast whenever anything but the heartbeat time and the rate changes."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

import asyncpg

from .db import get_pool
from .ws import manager

log = logging.getLogger("models")
STALE_AFTER = timedelta(seconds=15)
_last_sent = None

CRIE = {"name": "CRIE", "model_id": None, "version": None, "status": "pending", "trained_at": None, "loaded_at": None,
        "last_heartbeat_at": None, "detail": "Not in the live pipeline yet.", "metrics": None, "scored_per_sec": None}


async def current() -> list[dict]:
    try:
        row = await get_pool().fetchrow("SELECT * FROM ml_models WHERE name = 'ATDE'")
    except asyncpg.UndefinedTableError:
        row = None
    if row is None:
        atde = {**CRIE, "name": "ATDE", "detail": "ml-scorer has not started yet."}
    else:
        r = dict(row)
        fresh = r["last_heartbeat_at"] and datetime.now(timezone.utc) - r["last_heartbeat_at"] < STALE_AFTER
        atde = {"name": "ATDE", "model_id": r["model_id"], "version": r["version"],
                "status": "ready" if fresh else "offline", "trained_at": r["trained_at"], "loaded_at": r["loaded_at"],
                "last_heartbeat_at": r["last_heartbeat_at"], "detail": r["detail"], "metrics": r["metrics"],
                "scored_per_sec": r["scored_per_sec"]}
    return [atde, CRIE]


def _comparable(models):
    return [{k: v for k, v in m.items() if k not in ("last_heartbeat_at", "scored_per_sec")} for m in models]


async def run():
    global _last_sent
    while True:
        try:
            models = await current()
            if _comparable(models) != _last_sent:
                _last_sent = _comparable(models)
                manager.broadcast("models", models)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("models check failed: %s", e)
        await asyncio.sleep(5)


def start() -> asyncio.Task:
    return asyncio.create_task(run())
