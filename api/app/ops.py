"""Listens for the ops service's NOTIFY (channel ops_events, ops/store.py) and broadcasts
`job_runs` and `ops_alert` (contracts/LIVE_API.md 4.4, 4.5)."""
import asyncio
import json
import logging

import asyncpg

from .settings import settings
from .ws import manager

log = logging.getLogger("ops")
CHANNEL = "ops_events"


def _on_notify(_conn, _pid, _channel, payload: str):
    try:
        msg = json.loads(payload)
    except ValueError:
        return
    if msg.get("kind") == "job_run":
        manager.broadcast("job_runs", [msg["row"]])
    elif msg.get("kind") == "ops_alert":
        manager.broadcast("ops_alert", msg["row"])


async def run():
    while True:
        conn = None
        try:
            conn = await asyncpg.connect(settings.database_url)
            await conn.add_listener(CHANNEL, _on_notify)
            log.info("listening for ops events")
            while not conn.is_closed():
                await asyncio.sleep(5)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("ops listener error: %s (retrying in 3s)", e)
        finally:
            if conn is not None and not conn.is_closed():
                await conn.close()
        await asyncio.sleep(3)


def start() -> asyncio.Task:
    return asyncio.create_task(run())
