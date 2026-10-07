"""The ops service's core: schedules, run records, ops alerts and the webhook (contracts/LIVE_API.md 4.4, 4.5).

No database, network or Kafka code here: those come in through `Store`, `notify` and `post`,
so tests/test_ops.py can run it with fakes.
"""
import json
import logging
import threading
import traceback
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone
from typing import Callable, Protocol
from zoneinfo import ZoneInfo

log = logging.getLogger("ops")

# kind -> (failed checks in a row to open, passed checks in a row to clear)
STREAKS = {"health": (3, 3), "sla_breach": (2, 2), "job_failed": (1, 1)}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------ schedules

@dataclass
class Every:
    seconds: int

    def label(self) -> str:
        return f"every {self.seconds} s"

    def next_after(self, t: datetime) -> datetime:
        return t + timedelta(seconds=self.seconds)


@dataclass
class Daily:
    at: time
    tz: str = "UTC"

    def label(self) -> str:
        return f"daily {self.at.strftime('%H:%M')}"

    def next_after(self, t: datetime) -> datetime:
        local = t.astimezone(timezone.utc if self.tz == "UTC" else ZoneInfo(self.tz))
        run = datetime.combine(local.date(), self.at, tzinfo=local.tzinfo)
        if run <= local:
            run = datetime.combine(local.date() + timedelta(days=1), self.at, tzinfo=local.tzinfo)
        return run.astimezone(timezone.utc)


# ------------------------------------------------------------------ what a job returns

@dataclass
class Check:
    """One thing a job looked at. `ok` False opens (after a streak) an alert of `kind` for `source`."""
    source: str
    ok: bool
    message: str  # the plain sentence for the alert and the webhook
    kind: str = "health"
    level: str = "crit"
    detail: dict = field(default_factory=dict)


@dataclass
class Outcome:
    status: str  # ok, failed or skipped
    detail: str
    result: dict | None = None
    checks: list[Check] = field(default_factory=list)


class Skip(Exception):
    """Raised by a job that had nothing to do (for example ml/train.py does not exist yet)."""


class Store(Protocol):
    def insert_run(self, run: dict) -> dict: ...
    def firing_alerts(self) -> list[dict]: ...
    def open_alert(self, alert: dict) -> dict: ...
    def update_alert(self, alert_id: int, fields: dict) -> dict: ...


def post_json(url: str, payload: dict, timeout: float = 5) -> int:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status


def webhook_payload(message: str) -> dict:
    """One body all three accept: Slack and Teams read `text`, Discord reads `content`."""
    return {"text": message, "content": message}


# ------------------------------------------------------------------ the runner

class Runner:
    def __init__(self, store: Store, notify: Callable[[str, dict], None], webhook_url: str | None = None,
                 post: Callable[[str, dict], int] = post_json, clock: Callable[[], datetime] = utcnow):
        self.store, self.notify, self.webhook_url, self.post, self.clock = store, notify, webhook_url, post, clock
        self.firing: dict[tuple[str, str], dict] = {}
        self.streaks: dict[tuple[str, str], int] = {}  # + failures in a row, - passes in a row
        self.lock = threading.Lock()  # jobs run in threads; recording and judging happen one at a time
        for a in store.firing_alerts():
            self.firing[(a["kind"], a["source"])] = a

    def run(self, job: str, fn: Callable[[], Outcome]) -> dict:
        started = self.clock()
        try:
            out = fn()
        except Skip as e:
            out = Outcome("skipped", str(e))
        except Exception as e:
            log.warning("job %s failed: %s", job, e)
            out = Outcome("failed", f"{type(e).__name__}: {e}"[:500], {"trace": traceback.format_exc(limit=3)[-1500:]})
        with self.lock:
            return self._record(job, started, out)

    def _record(self, job: str, started: datetime, out: Outcome) -> dict:
        finished = self.clock()
        run = self.store.insert_run({
            "job": job, "started_at": started, "finished_at": finished,
            "duration_ms": int((finished - started).total_seconds() * 1000),
            "status": out.status, "detail": out.detail, "result": out.result,
        })
        self.notify("job_run", run)

        checks = list(out.checks)
        # A scheduled job's own failure; the health watch reports its failures as health checks instead.
        if job != "health_watch":
            checks.append(Check(job, out.status != "failed", f"The {job.replace('_', ' ')} job failed: {out.detail}",
                                kind="job_failed"))
        for c in checks:
            self._judge(c, run["id"])
        return run

    def _judge(self, c: Check, run_id: int):
        key = (c.kind, c.source)
        need_open, need_clear = STREAKS.get(c.kind, (1, 1))
        s = self.streaks.get(key, 0)
        s = (s + 1 if s > 0 else 1) if not c.ok else (s - 1 if s < 0 else -1)
        self.streaks[key] = s
        now = self.clock()
        alert = self.firing.get(key)
        if not c.ok and alert is None and s >= need_open:
            alert = self.store.open_alert({
                "kind": c.kind, "source": c.source, "level": c.level, "state": "firing", "message": c.message,
                "detail": {**c.detail, "failed_checks": s}, "job_run_id": run_id,
                "started_at": now, "updated_at": now, "cleared_at": None, "webhook": None,
            })
            self.firing[key] = alert
            self._announce(alert)
        elif not c.ok and alert is not None and alert["level"] != c.level:
            alert = self.store.update_alert(alert["id"], {"level": c.level, "message": c.message, "job_run_id": run_id, "updated_at": now})
            self.firing[key] = alert
            self.notify("ops_alert", alert)
        elif c.ok and alert is not None and -s >= need_clear:
            alert = self.store.update_alert(alert["id"], {
                "state": "cleared", "message": f"Recovered: {alert['message']}", "job_run_id": run_id,
                "updated_at": now, "cleared_at": now,
            })
            del self.firing[key]
            self._announce(alert)

    def _announce(self, alert: dict):
        """Broadcast, and post to the webhook when it opens and when it clears."""
        if self.webhook_url:
            try:
                status = self.post(self.webhook_url, webhook_payload(f"NETRA: {alert['message']}"))
                hook = {"delivered": 200 <= status < 300, "status": status, "at": self.clock()}
            except Exception as e:
                log.warning("webhook failed: %s", e)
                hook = {"delivered": False, "status": getattr(e, "code", None), "at": self.clock()}
            alert = self.store.update_alert(alert["id"], {"webhook": hook})
            if alert["state"] == "firing":
                self.firing[(alert["kind"], alert["source"])] = alert
        self.notify("ops_alert", alert)
