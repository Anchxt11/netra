from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from .. import repo
from ..db import get_pool
from ..deps import CurrentUser, analyst_or_admin
from ..ws import manager

router = APIRouter(tags=["incidents"])


class IncidentPatch(BaseModel):
    status: Literal["open", "acknowledged", "resolved"] | None = None
    notes: str | None = None
    assigned_to: int | None = None


@router.get("/alerts/recent")
async def recent_alerts(limit: int = Query(50, ge=1, le=500), _: CurrentUser = Depends(analyst_or_admin)):
    rows = await get_pool().fetch(
        f"SELECT id, alert_id, rule_id, model, title, severity, event_ids, status, created_ts, {repo.ALERT_FIELDS} "
        "FROM incidents ORDER BY created_ts DESC LIMIT $1",
        limit,
    )
    return [dict(r) for r in rows]


@router.get("/incidents")
async def list_incidents(
    status: Literal["open", "acknowledged", "resolved"] | None = None,
    severity: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _: CurrentUser = Depends(analyst_or_admin),
):
    where, args = [], []
    if status:
        args.append(status)
        where.append(f"status = ${len(args)}")
    if severity:
        args.append(severity.lower())
        where.append(f"severity = ${len(args)}")
    args += [limit, offset]
    sql = (f"SELECT {repo.COLS} FROM incidents "
           f"{'WHERE ' + ' AND '.join(where) if where else ''} "
           f"ORDER BY created_ts DESC LIMIT ${len(args) - 1} OFFSET ${len(args)}")
    return [dict(r) for r in await get_pool().fetch(sql, *args)]


@router.get("/incidents/{incident_id}")
async def get_incident(incident_id: int, _: CurrentUser = Depends(analyst_or_admin)):
    row = await get_pool().fetchrow(
        f"SELECT {repo.COLS}, payload FROM incidents WHERE id = $1", incident_id
    )
    if not row:
        raise HTTPException(404, "Incident not found")
    return dict(row)


@router.patch("/incidents/{incident_id}")
async def update_incident(incident_id: int, body: IncidentPatch, _: CurrentUser = Depends(analyst_or_admin)):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(400, "Nothing to update")
    if "status" in fields and fields["status"] is None:
        raise HTTPException(422, "status cannot be null")
    sets = [f"{k} = ${i}" for i, k in enumerate(fields, start=2)]  # keys come from the model, not the client
    row = await get_pool().fetchrow(
        f"UPDATE incidents SET {', '.join(sets)}, updated_ts = now() WHERE id = $1 RETURNING {repo.COLS}",
        incident_id, *fields.values(),
    )
    if not row:
        raise HTTPException(404, "Incident not found")
    incident = dict(row)
    manager.broadcast("incident_update", incident)
    return incident
