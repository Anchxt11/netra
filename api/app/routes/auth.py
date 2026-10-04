import asyncio
from typing import Literal

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..db import get_pool
from ..deps import CurrentUser, admin_only, get_current_user
from ..security import create_token, hash_password, verify_password

router = APIRouter(tags=["auth"])


class LoginIn(BaseModel):
    username: str
    password: str


class UserIn(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    role: Literal["analyst", "admin"] = "analyst"


@router.post("/auth/login")
async def login(body: LoginIn):
    pool = get_pool()
    u = await pool.fetchrow(
        "SELECT id, username, password_hash, role, is_active FROM users WHERE username = $1",
        body.username,
    )
    # argon2 is CPU-heavy: run off the event loop so logins don't stall the WebSocket feed
    ok = bool(u and u["is_active"]) and await asyncio.to_thread(
        verify_password, u["password_hash"], body.password
    )
    if not ok:
        raise HTTPException(401, "Invalid credentials")
    await pool.execute("UPDATE users SET last_login = now() WHERE id = $1", u["id"])
    token, expires_in = create_token(u["id"], u["username"], u["role"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
        "user": {"id": u["id"], "username": u["username"], "role": u["role"]},
    }


@router.get("/auth/me")
async def me(user: CurrentUser = Depends(get_current_user)):
    return user


@router.get("/users")
async def list_users(_: CurrentUser = Depends(admin_only)):
    rows = await get_pool().fetch(
        "SELECT id, username, role, is_active, created_at, last_login FROM users ORDER BY id"
    )
    return [dict(r) for r in rows]


@router.post("/users", status_code=201)
async def create_user(body: UserIn, _: CurrentUser = Depends(admin_only)):
    h = await asyncio.to_thread(hash_password, body.password)
    try:
        row = await get_pool().fetchrow(
            "INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3) "
            "RETURNING id, username, role, is_active, created_at",
            body.username, h, body.role,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "Username already exists")
    return dict(row)
