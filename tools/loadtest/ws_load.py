"""Load test for the SLA table in docs/SLA.md: N dashboards at once, measured like the real one.

Opens CLIENTS WebSocket connections to the API, exactly as the dashboard does, for SECONDS, and
measures for every event each client receives:
  time to screen = receive time - event_ts        (the SLA: p95 at most 5 s)
  WebSocket lag  = receive time - server_ts       (the API's push to arrival)
plus the `dropped` count the API reports when it caps a push (per client, the most any client saw), and
pipeline freshness from GET /freshness at the end.

Run it ON THE VM, so the receive clock is the clock that stamped event_ts (docs/SLA.md, "Clock offset").
Credentials come from the environment, never the command line:
  LOADTEST_USER, LOADTEST_PASSWORD   (the analyst account in the VM's .env)

  python tools/loadtest/ws_load.py --api http://localhost:8000 --clients 25 --seconds 180
Prints one JSON line; `make loadtest` runs the event generator alongside it.
"""
import argparse
import asyncio
import json
import os
import statistics
import time
import urllib.request
from datetime import datetime

import websockets


def iso_to_epoch(ts: str) -> float | None:
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except (AttributeError, ValueError):
        return None


def pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    return round(s[min(len(s) - 1, int(q * len(s)))], 3)


def http_json(url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


class Stats:
    def __init__(self):
        self.screen: list[float] = []
        self.lag: list[float] = []
        self.events = 0
        self.dropped: list[int] = []  # per client: every client gets the same batches, so don't add them up
        self.errors = 0
        self.connected = 0


async def client(ws_url: str, until: float, stats: Stats, keep_every: int):
    try:
        async with websockets.connect(ws_url, max_size=None, open_timeout=15) as ws:
            stats.connected += 1
            n = dropped = 0
            while time.time() < until:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, until - time.time()))
                except asyncio.TimeoutError:
                    break
                now = time.time()
                msg = json.loads(raw)
                if msg.get("type") != "events":
                    continue
                dropped += int(msg.get("dropped") or 0)
                server = iso_to_epoch(msg.get("server_ts", ""))
                if server is not None:
                    stats.lag.append(now - server)
                for ev in msg.get("data") or []:
                    stats.events += 1
                    n += 1
                    if n % keep_every:  # sample, so memory stays flat with 100 clients
                        continue
                    t = iso_to_epoch(str(ev.get("event_ts", "")))
                    if t is not None:
                        stats.screen.append(now - t)
        stats.dropped.append(dropped)
    except Exception as e:  # a refused or dropped connection counts, it is part of the result
        stats.errors += 1
        if stats.errors <= 3:
            print(f"client error: {type(e).__name__}: {e}", flush=True)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8000", help="the API's base URL (on the VM: http://localhost:8000)")
    ap.add_argument("--clients", type=int, default=1)
    ap.add_argument("--seconds", type=int, default=180)
    ap.add_argument("--keep-every", type=int, default=1, help="keep 1 in N event samples (memory)")
    a = ap.parse_args()

    user, password = os.environ.get("LOADTEST_USER"), os.environ.get("LOADTEST_PASSWORD")
    if not user or not password:
        raise SystemExit("Set LOADTEST_USER and LOADTEST_PASSWORD (the analyst account) in the environment.")
    token = http_json(f"{a.api}/auth/login", {"username": user, "password": password})["access_token"]
    ws_url = a.api.replace("http", "ws", 1) + f"/ws?token={token}"

    stats = Stats()
    start = time.time()
    until = start + a.seconds
    await asyncio.gather(*(client(ws_url, until, stats, a.keep_every) for _ in range(a.clients)))
    elapsed = max(1.0, min(time.time(), until) - start)  # not the close handshakes after the window

    try:
        fresh = http_json(f"{a.api}/freshness")
    except Exception:
        fresh = {}
    print(json.dumps({
        "clients": a.clients,
        "connected": stats.connected,
        "connection_errors": stats.errors,
        "seconds": round(elapsed),
        "events_per_sec_per_client": round(stats.events / elapsed / max(1, stats.connected), 1),
        "time_to_screen_p50_s": pct(stats.screen, 0.50),
        "time_to_screen_p95_s": pct(stats.screen, 0.95),
        "websocket_lag_p95_s": pct(stats.lag, 0.95),
        "pipeline_freshness_p95_s": fresh.get("p95_seconds"),
        "dropped": max(stats.dropped, default=0),
        "pass": (pct(stats.screen, 0.95) or 99) <= 5.0 and stats.errors == 0,
        "median_screen_s": round(statistics.median(stats.screen), 3) if stats.screen else None,
    }))


if __name__ == "__main__":
    asyncio.run(main())
