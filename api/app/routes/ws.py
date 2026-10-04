import asyncio

from fastapi import APIRouter, Query, WebSocket

from ..security import decode_token
from ..util import dumps, now_iso
from ..ws import manager

router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: str | None = Query(default=None)):
    await ws.accept()
    try:
        claims = decode_token(token or "")
    except Exception:
        await ws.close(code=4401, reason="invalid or expired token")
        return

    client = manager.add(claims["username"], claims["role"])
    manager.push(client, dumps({
        "type": "hello",
        "data": {"username": claims["username"], "role": claims["role"]},
        "server_ts": now_iso(),
    }))

    async def sender():
        while True:
            await ws.send_text(await client.q.get())

    async def receiver():
        while True:
            msg = await ws.receive_text()
            if msg.strip().lower() == "ping":
                manager.push(client, dumps({"type": "pong", "server_ts": now_iso()}))

    tasks = [asyncio.create_task(sender()), asyncio.create_task(receiver())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        manager.remove(client)
