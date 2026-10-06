from fastapi import APIRouter, Depends, HTTPException, Query

from ..clickhouse import query_dicts
from ..deps import CurrentUser, analyst_or_admin
from ..settings import settings
from ..util import parse_features

router = APIRouter(tags=["events"])


@router.get("/events/recent")
async def recent_events(
    limit: int = Query(100, ge=1, le=1000),
    _: CurrentUser = Depends(analyst_or_admin),
):
    try:
        rows = await query_dicts(
            f"SELECT * FROM {settings.clickhouse_table} ORDER BY stored_ts DESC LIMIT {{limit:UInt32}}",
            {"limit": limit},
        )
    except Exception as e:
        raise HTTPException(503, f"ClickHouse unavailable: {type(e).__name__}")
    return [parse_features(r) for r in rows]
