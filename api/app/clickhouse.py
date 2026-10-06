import logging

import clickhouse_connect

from .settings import settings

log = logging.getLogger("clickhouse")
_client = None


async def _get():
    global _client
    if _client is None:
        _client = await clickhouse_connect.get_async_client(
            host=settings.clickhouse_host,
            port=settings.clickhouse_port,
            username=settings.clickhouse_user,
            password=settings.clickhouse_password,
            database=settings.clickhouse_db,
            autogenerate_session_id=False,  # allow concurrent queries on one client
        )
    return _client


async def query_dicts(sql: str, params: dict | None = None) -> list[dict]:
    global _client
    try:
        c = await _get()
        res = await c.query(sql, parameters=params or {})
        return [dict(zip(res.column_names, row)) for row in res.result_rows]
    except Exception:
        _client = None  # force reconnect next time
        raise
