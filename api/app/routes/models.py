from fastapi import APIRouter, Depends

from .. import models
from ..deps import CurrentUser, analyst_or_admin

router = APIRouter(tags=["models"])


@router.get("/models")
async def get_models(_: CurrentUser = Depends(analyst_or_admin)):
    return await models.current()
