"""POST /crie/recommend (build plan R2, contracts/LIVE_API.md 4.7): CRIE's top 3 fixes for one incident.
CRIE only recommends: this endpoint returns a list for an analyst and carries nothing out."""
import asyncio
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import crie
from ..deps import CurrentUser, analyst_or_admin

router = APIRouter(tags=["crie"])


class Context(BaseModel):
    src_ips: list[str] = []
    usernames: list[str] = []
    hosts: list[str] = []
    dst_ip: str | None = None
    domain: str | None = None


class Incident(BaseModel):
    """The R0 input shape (frontend/docs/BUILD_PLAN.md, R0)."""
    incident_id: str
    attack_type: str
    mitre_technique: str | None = None
    severity: int = Field(ge=1, le=5)
    detected_by: Literal["rule", "ai", "both"]
    rules: list[str] = []
    model: dict[str, Any] | None = None  # model 1's attack_family, confidence, is_unknown, if_score, top3
    context: Context = Context()


@router.post("/crie/recommend")
async def recommend(incident: Incident, _: CurrentUser = Depends(analyst_or_admin)):
    if crie.state["status"] != "ready":
        raise HTTPException(503, crie.state["detail"] or "CRIE is not ready.")
    return await asyncio.to_thread(crie.recommend_cached, incident.model_dump())
