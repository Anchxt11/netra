import asyncio
import json
import logging

import asyncpg

from .security import hash_password
from .settings import settings

log = logging.getLogger("db")
_pool: asyncpg.Pool | None = None


async def _init_conn(conn):
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


def get_pool() -> asyncpg.Pool:
    assert _pool is not None, "pool not initialised"
    return _pool


async def init_pool():
    global _pool
    for _ in range(30):
        try:
            _pool = await asyncpg.create_pool(
                settings.database_url, min_size=1, max_size=10, init=_init_conn
            )
            break
        except Exception as e:  # postgres still booting
            log.warning("postgres not ready (%s), retrying", e)
            await asyncio.sleep(2)
    else:
        raise RuntimeError("postgres unreachable")
    await seed_users()


async def close_pool():
    if _pool:
        await _pool.close()


async def seed_users():
    """Create a default admin + analyst on first boot (hashing can't be done in init.sql)."""
    async with get_pool().acquire() as c:
        if await c.fetchval("SELECT count(*) FROM users") == 0:
            for name, pw, role in (
                (settings.admin_username, settings.admin_password, "admin"),
                (settings.analyst_username, settings.analyst_password, "analyst"),
            ):
                h = await asyncio.to_thread(hash_password, pw)
                await c.execute(
                    "INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3)",
                    name, h, role,
                )
            log.info("seeded default users")
