import asyncio
from dataclasses import dataclass, field

from .util import dumps, now_iso


@dataclass(eq=False)
class Client:
    username: str
    role: str
    q: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=500))


class Manager:
    """Fan-out hub. Each client has a bounded queue so one slow browser can't stall the rest."""

    def __init__(self):
        self.clients: set[Client] = set()

    def add(self, username: str, role: str) -> Client:
        c = Client(username, role)
        self.clients.add(c)
        return c

    def remove(self, c: Client):
        self.clients.discard(c)

    def push(self, c: Client, text: str):
        try:
            c.q.put_nowait(text)
        except asyncio.QueueFull:
            try:
                c.q.get_nowait()  # drop oldest
            except asyncio.QueueEmpty:
                pass
            c.q.put_nowait(text)

    def broadcast(self, msg_type: str, data, **extra):
        if not self.clients:
            return
        text = dumps({"type": msg_type, "data": data, "server_ts": now_iso(), **extra})
        for c in list(self.clients):
            self.push(c, text)


manager = Manager()
