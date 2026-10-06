from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from .security import decode_token

_bearer = HTTPBearer(auto_error=False)


class CurrentUser(BaseModel):
    id: int
    username: str
    role: str


async def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> CurrentUser:
    if creds is None:
        raise HTTPException(401, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    try:
        c = decode_token(creds.credentials)
        return CurrentUser(id=int(c["sub"]), username=c["username"], role=c["role"])
    except Exception:
        raise HTTPException(401, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})


def require_role(*roles: str):
    async def dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(403, "Insufficient role")
        return user
    return dep


analyst_or_admin = require_role("analyst", "admin")
admin_only = require_role("admin")
