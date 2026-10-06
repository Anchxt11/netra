"""The KPI loop: every few seconds, five KPIs from ClickHouse, threshold alerts, and the `kpi` and
`kpi_alert` WebSocket messages (contracts/LIVE_API.md, 4.1 and 4.2).

Runs in the API process. One API instance is assumed: the alert state lives in memory and is
restored from `kpi_alerts` at startup.
"""
import asyncio
import copy
import logging
from collections import deque
from datetime import datetime, timedelta, timezone

from .clickhouse import query_dicts
from .db import get_pool
from .kpi_rules import KPIS, NAMES, KpiAlerter, level_of, thresholds_from_config, values_from_row
from .settings import settings
from .ws import manager

log = logging.getLogger("kpi")

# rule_hits is a String column in ClickHouse holding the processor's JSON array ("[]" when nothing fired).
SQL = f"""
WITH now64(3) - INTERVAL 1 MINUTE AS since_1m
SELECT
    countIf(stored_ts >= since_1m)                                                     AS events_1m,
    count()                                                                            AS events_5m,
    countIf(event_type = 'login' AND stored_ts >= since_1m)                            AS logins_1m,
    countIf(event_type = 'login')                                                      AS logins_5m,
    countIf(event_type = 'login' AND status = 'failure' AND stored_ts >= since_1m)     AS login_failures_1m,
    countIf(event_type = 'login' AND status = 'failure')                               AS login_failures_5m,
    countIf(event_type = 'http_request' AND stored_ts >= since_1m)                     AS requests_1m,
    countIf(event_type = 'http_request')                                               AS requests_5m,
    countIf(event_type = 'http_request' AND http_status >= 500 AND stored_ts >= since_1m) AS errors_5xx_1m,
    countIf(event_type = 'http_request' AND http_status >= 500)                        AS errors_5xx_5m,
    sumIf(bytes_out, stored_ts >= since_1m)                                            AS bytes_1m,
    sum(bytes_out)                                                                     AS bytes_5m,
    countIf(rule_hits NOT IN ('', '[]') AND stored_ts >= since_1m)                     AS rule_hits_1m,
    countIf(rule_hits NOT IN ('', '[]'))                                               AS rule_hits_5m
FROM {settings.clickhouse_table}
WHERE stored_ts >= now64(3) - INTERVAL 5 MINUTE
"""

ALERT_COLS = ("id, kind, kpi, level, state, value, threshold, time_window, "
              "started_at, updated_at, cleared_at")
HISTORY_MINUTES = 60

alerter = KpiAlerter()
alert_ids: dict[str, int] = {}  # KPI name -> id of its firing alert
latest: dict | None = None
history: deque = deque(maxlen=HISTORY_MINUTES * 60 // max(1, settings.kpi_interval_seconds))
_thresholds = thresholds_from_config({})


def alert_row(r) -> dict:
    """A kpi_alerts row as the wire shape."""
    d = dict(r)
    d["window"] = d.pop("time_window")
    d["origin"] = "api"
    return d


async def restore():
    """Alerts still firing from before a restart: carry on with them instead of opening new ones."""
    rows = await get_pool().fetch(f"SELECT {ALERT_COLS} FROM kpi_alerts WHERE state = 'firing'")
    for r in rows:
        if r["kpi"] in NAMES:
            alerter.restore(r["kpi"], r["level"])
            alert_ids[r["kpi"]] = r["id"]


async def _load_thresholds():
    global _thresholds
    try:
        rows = await get_pool().fetch("SELECT key, value FROM config WHERE key LIKE 'kpi.%'")
        _thresholds = thresholds_from_config({r["key"]: r["value"] for r in rows})
    except Exception as e:  # keep the last lines we read
        log.warning("could not read KPI thresholds (%s); using the last ones", e)
    return _thresholds


async def _persist(name: str, action: str, level: str, value, threshold, at: datetime) -> dict:
    pool = get_pool()
    value = None if value is None else float(value)
    threshold = None if threshold is None else float(threshold)
    if action == "open":
        row = await pool.fetchrow(
            f"INSERT INTO kpi_alerts (kind, kpi, level, state, value, threshold, started_at, updated_at) "
            f"VALUES ('threshold', $1, $2, 'firing', $3, $4, $5, $5) RETURNING {ALERT_COLS}",
            name, level, value, threshold, at,
        )
    elif action == "level":
        row = await pool.fetchrow(
            f"UPDATE kpi_alerts SET level = $2, value = $3, threshold = $4, updated_at = $5 "
            f"WHERE id = $1 RETURNING {ALERT_COLS}",
            alert_ids[name], level, value, threshold, at,
        )
    else:
        row = await pool.fetchrow(
            f"UPDATE kpi_alerts SET state = 'cleared', value = $2, threshold = COALESCE($3, threshold), "
            f"updated_at = $4, cleared_at = $4 WHERE id = $1 RETURNING {ALERT_COLS}",
            alert_ids[name], value, threshold, at,
        )
    if row is None:
        raise RuntimeError(f"kpi_alerts row for {name} is missing")
    return alert_row(row)


async def tick():
    global latest
    at = datetime.now(timezone.utc)
    try:
        rows = await query_dicts(SQL)
    except Exception as e:
        log.warning("KPI query failed (%s); no kpi message this tick", type(e).__name__)
        return
    values = values_from_row(rows[0])
    lines = await _load_thresholds()
    levels = {n: level_of(values[n][0], lines[n]["warn"], lines[n]["crit"]) for n in NAMES}

    before = copy.deepcopy(alerter.tracks)
    for name, t in alerter.observe(levels).items():
        threshold = lines[name][t.level]
        try:
            row = await _persist(name, t.action, t.level, values[name][0], threshold, at)
        except Exception:
            # Not stored, so not sent: roll this KPI back and try again on the next reading.
            log.exception("could not store the %s alert for %s", t.action, name)
            alerter.tracks[name] = before[name]
            continue
        if t.action == "clear":
            alert_ids.pop(name, None)
        else:
            alert_ids[name] = row["id"]
        manager.broadcast("kpi_alert", row)

    snapshot = {
        "computed_at": at,
        "kpis": [
            {
                "name": name, "unit": unit,
                "value_1m": values[name][0], "value_5m": values[name][1],
                "warn": lines[name]["warn"], "crit": lines[name]["crit"],
                "level": levels[name], "alert_id": alert_ids.get(name),
            }
            for name, unit in KPIS
        ],
    }
    latest = snapshot
    history.append({"computed_at": at, "values": {n: values[n][0] for n in NAMES}})
    manager.broadcast("kpi", snapshot)


def history_since(minutes: int) -> list[dict]:
    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    return [h for h in history if h["computed_at"] >= since]


async def run():
    loop = asyncio.get_running_loop()
    interval = settings.kpi_interval_seconds
    try:
        await restore()
    except Exception:
        log.exception("could not restore firing KPI alerts")
    while True:
        started = loop.time()
        try:
            await tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("KPI tick failed")
        await asyncio.sleep(max(0.5, interval - (loop.time() - started)))


def start() -> asyncio.Task:
    return asyncio.create_task(run())
