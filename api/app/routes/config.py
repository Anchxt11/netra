from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..db import get_pool
from ..deps import CurrentUser, admin_only, analyst_or_admin

router = APIRouter(tags=["config"])


class ConfigIn(BaseModel):
    value: Any


@router.get("/config")
async def get_config(_: CurrentUser = Depends(analyst_or_admin)):
    rows = await get_pool().fetch("SELECT key, value FROM config")
    return {r["key"]: r["value"] for r in rows}


@router.put("/config/{key}")
async def put_config(key: str, body: ConfigIn, user: CurrentUser = Depends(admin_only)):
    await get_pool().execute(
        "INSERT INTO config (key, value, updated_by) VALUES ($1,$2,$3) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by",
        key, body.value, user.username,
    )
    return {"key": key, "value": body.value}
