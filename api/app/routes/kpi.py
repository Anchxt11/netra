from typing import Literal

from fastapi import APIRouter, Depends, Query

from .. import kpi
from ..db import get_pool
from ..deps import CurrentUser, analyst_or_admin

router = APIRouter(tags=["kpi"])


@router.get("/kpi")
async def get_kpi(minutes: int = Query(15, ge=1, le=60), _: CurrentUser = Depends(analyst_or_admin)):
    """The latest KPI reading and the last `minutes` of value_1m, so a reload has its trend."""
    return {"latest": kpi.latest, "history": kpi.history_since(minutes)}


@router.get("/kpi/alerts")
async def kpi_alerts(
    state: Literal["firing", "all"] = "firing",
    limit: int = Query(50, ge=1, le=500),
    _: CurrentUser = Depends(analyst_or_admin),
):
    where = "WHERE state = 'firing'" if state == "firing" else ""
    rows = await get_pool().fetch(
        f"SELECT {kpi.ALERT_COLS} FROM kpi_alerts {where} ORDER BY started_at DESC, id DESC LIMIT $1", limit
    )
    return [kpi.alert_row(r) for r in rows]
