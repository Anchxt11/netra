import math

from fastapi import APIRouter, HTTPException, Query

from ..clickhouse import query_dicts
from ..db import get_pool
from ..settings import settings
from ..util import now_iso

router = APIRouter(tags=["freshness"])

SQL = f"""
SELECT count()                     AS n,
       quantile(0.5)(lag_ms)       AS p50_ms,
       quantile(0.95)(lag_ms)      AS p95_ms,
       max(lag_ms)                 AS max_ms,
       max(stored_ms)              AS last_stored_ms,
       toUnixTimestamp64Milli(now64(3)) AS now_ms
FROM (
    SELECT toUnixTimestamp64Milli(stored_ts) - toUnixTimestamp64Milli(event_ts) AS lag_ms,
           toUnixTimestamp64Milli(stored_ts) AS stored_ms
    FROM {settings.clickhouse_table}
    WHERE stored_ts >= now64(3) - INTERVAL {{minutes:UInt32}} MINUTE
)
"""


def _clean(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else x


@router.get("/freshness")
async def freshness(minutes: int | None = Query(None, ge=1, le=240)):
    """p50/p95 of (stored_ts - event_ts). Public on purpose so the load test can poll it."""
    cfg = {r["key"]: r["value"] for r in await get_pool().fetch(
        "SELECT key, value FROM config WHERE key IN ('freshness_sla_p95_seconds','freshness_window_minutes')")}
    window = minutes or int(cfg.get("freshness_window_minutes", 5))
    sla_s = float(cfg.get("freshness_sla_p95_seconds", 5))
    try:
        r = (await query_dicts(SQL, {"minutes": window}))[0]
    except Exception as e:
        raise HTTPException(503, f"ClickHouse unavailable: {type(e).__name__}")

    n = int(r["n"])
    p50, p95, mx = (_clean(r[k]) for k in ("p50_ms", "p95_ms", "max_ms"))
    since_last = round((r["now_ms"] - r["last_stored_ms"]) / 1000, 2) if n else None
    if n == 0:
        status = "no_data"
    elif since_last is not None and since_last > max(10, sla_s * 2):
        status = "stalled"            # pipeline stopped delivering; this is the failure signal
    elif p95 / 1000 > sla_s:
        status = "breach"
    else:
        status = "ok"
    return {
        "window_minutes": window,
        "events": n,
        "avg_events_per_sec": round(n / (window * 60), 2),
        "p50_seconds": round(p50 / 1000, 3) if p50 is not None else None,
        "p95_seconds": round(p95 / 1000, 3) if p95 is not None else None,
        "max_seconds": round(mx / 1000, 3) if mx is not None else None,
        "sla_p95_seconds": sla_s,
        "seconds_since_last_event": since_last,
        "status": status,
        "computed_at": now_iso(),
    }
