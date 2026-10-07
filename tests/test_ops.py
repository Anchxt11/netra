"""The ops service's core (ops/core.py): every run is recorded, failures raise ops alerts, the webhook is called."""
from datetime import datetime, time, timedelta, timezone

from ops.core import Check, Daily, Every, Outcome, Runner, Skip, webhook_payload


class MemoryStore:
    def __init__(self, firing=()):
        self.runs, self.alerts = [], list(firing)

    def insert_run(self, run):
        row = {**run, "id": len(self.runs) + 1}
        self.runs.append(row)
        return row

    def firing_alerts(self):
        return [a for a in self.alerts if a["state"] == "firing"]

    def open_alert(self, alert):
        row = {**alert, "id": len(self.alerts) + 1}
        self.alerts.append(row)
        return row

    def update_alert(self, alert_id, fields):
        row = next(a for a in self.alerts if a["id"] == alert_id)
        row.update(fields)
        return dict(row)


class Clock:
    def __init__(self):
        self.t = datetime(2026, 10, 7, 9, 0, tzinfo=timezone.utc)

    def __call__(self):
        self.t += timedelta(milliseconds=5)
        return self.t


def setup(webhook="https://hooks.example.test/x", status=204):
    store, sent, posts = MemoryStore(), [], []

    def post(url, payload):
        posts.append((url, payload))
        if isinstance(status, Exception):
            raise status
        return status

    runner = Runner(store, lambda kind, row: sent.append((kind, row)), webhook, post, Clock())
    return runner, store, sent, posts


def boom():
    raise ConnectionError("clickhouse:8123 refused")


def test_a_failing_job_is_recorded_and_the_webhook_is_called():
    runner, store, sent, posts = setup()
    run = runner.run("daily_report", boom)
    assert run["status"] == "failed" and "ConnectionError" in run["detail"] and run["duration_ms"] >= 0
    assert store.runs[0]["job"] == "daily_report"
    alert = store.alerts[0]
    assert (alert["kind"], alert["source"], alert["state"], alert["job_run_id"]) == ("job_failed", "daily_report", "firing", run["id"])
    assert len(posts) == 1 and posts[0][0] == "https://hooks.example.test/x"
    assert "daily report job failed" in posts[0][1]["text"] and posts[0][1]["content"] == posts[0][1]["text"]
    assert alert["webhook"]["delivered"] is True and alert["webhook"]["status"] == 204
    kinds = [k for k, _ in sent]
    assert kinds == ["job_run", "ops_alert"]  # the API broadcasts both


def test_the_next_ok_run_clears_it_and_calls_the_webhook_again():
    runner, store, sent, posts = setup()
    runner.run("daily_report", boom)
    runner.run("daily_report", lambda: Outcome("ok", "done"))
    assert store.alerts[0]["state"] == "cleared" and store.alerts[0]["cleared_at"] is not None
    assert len(posts) == 2 and posts[1][1]["text"].startswith("NETRA: Recovered:")


def test_skipped_is_not_a_failure():
    runner, store, _, posts = setup()

    def nothing():
        raise Skip("ml/train.py does not exist yet.")

    run = runner.run("model_retrain", nothing)
    assert (run["status"], run["detail"]) == ("skipped", "ml/train.py does not exist yet.")
    assert store.alerts == [] and posts == []


def test_health_checks_open_after_3_failures_and_clear_after_3_passes():
    runner, store, _, posts = setup()
    down = lambda: Outcome("failed", "Failed: clickhouse.", None, [Check("clickhouse", False, "ClickHouse is not answering.")])
    up = lambda: Outcome("ok", "All checks passed.", None, [Check("clickhouse", True, "")])
    runner.run("health_watch", down)
    runner.run("health_watch", down)
    assert store.alerts == []
    runner.run("health_watch", down)
    assert [(a["kind"], a["source"], a["state"]) for a in store.alerts] == [("health", "clickhouse", "firing")]
    runner.run("health_watch", up)
    runner.run("health_watch", down)  # a failure in between resets the passes
    for _ in range(2):
        runner.run("health_watch", up)
    assert store.alerts[0]["state"] == "firing"
    runner.run("health_watch", up)
    assert store.alerts[0]["state"] == "cleared"
    assert len(store.alerts) == 1 and len(posts) == 2  # the health watch's own run never adds a job_failed alert


def test_a_webhook_that_fails_is_recorded_not_fatal():
    runner, store, sent, _ = setup(status=OSError("no route"))
    runner.run("data_retention", boom)
    assert store.alerts[0]["webhook"]["delivered"] is False
    assert sent[-1][0] == "ops_alert"


def test_no_webhook_set():
    runner, store, _, posts = setup(webhook=None)
    runner.run("data_retention", boom)
    assert posts == [] and store.alerts[0]["webhook"] is None


def test_restart_carries_on_firing_alerts():
    store = MemoryStore([{"id": 1, "kind": "job_failed", "source": "sla_check", "level": "crit", "state": "firing", "message": "x"}])
    runner = Runner(store, lambda *a: None, None, lambda *a: 200, Clock())
    runner.run("sla_check", boom)
    assert len(store.alerts) == 1  # not opened twice
    runner.run("sla_check", lambda: Outcome("ok", "Within the SLA."))
    assert store.alerts[0]["state"] == "cleared"


def test_schedules():
    t = datetime(2026, 10, 7, 9, 0, tzinfo=timezone.utc)
    assert Every(10).next_after(t) == t + timedelta(seconds=10)
    assert Daily(time(6, 0)).next_after(t) == datetime(2026, 10, 8, 6, 0, tzinfo=timezone.utc)
    assert Daily(time(10, 0)).next_after(t) == datetime(2026, 10, 7, 10, 0, tzinfo=timezone.utc)
    assert Daily(time(9, 0)).next_after(t) == datetime(2026, 10, 8, 9, 0, tzinfo=timezone.utc)
    assert webhook_payload("hi") == {"text": "hi", "content": "hi"}
