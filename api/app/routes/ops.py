"""The ops service's tables (it creates them: ops/store.py). Before it has run once they do not
exist yet, and these routes answer with empty lists instead of an error."""
from typing import Literal

import asyncpg
from fastapi import APIRouter, Depends, Query

from ..db import get_pool
from ..deps import CurrentUser, analyst_or_admin

router = APIRouter(tags=["ops"])

RUN_COLS = "id, job, started_at, finished_at, duration_ms, status, detail, result"


async def _rows(sql: str, *args) -> list[dict]:
    try:
        return [dict(r) for r in await get_pool().fetch(sql, *args)]
    except asyncpg.UndefinedTableError:
        return []


@router.get("/jobs")
async def jobs(_: CurrentUser = Depends(analyst_or_admin)):
    rows = await _rows(f"""
        SELECT j.job, j.schedule, j.next_run_at,
               (SELECT row_to_json(r) FROM (SELECT {RUN_COLS} FROM job_runs WHERE job = j.job
                                            ORDER BY started_at DESC LIMIT 1) r) AS last_run,
               (SELECT count(*)::int FROM job_runs f WHERE f.job = j.job AND f.status = 'failed'
                  AND f.started_at > COALESCE((SELECT max(started_at) FROM job_runs o
                                               WHERE o.job = j.job AND o.status <> 'failed'), '-infinity')) AS consecutive_failures
        FROM ops_jobs j ORDER BY j.job""")
    return rows


@router.get("/jobs/runs")
async def job_runs(
    job: str | None = None,
    status: Literal["ok", "failed", "skipped"] | None = None,
    limit: int = Query(50, ge=1, le=500),
    _: CurrentUser = Depends(analyst_or_admin),
):
    where, args = [], []
    for col, v in (("job", job), ("status", status)):
        if v:
            args.append(v)
            where.append(f"{col} = ${len(args)}")
    args.append(limit)
    return await _rows(f"SELECT {RUN_COLS} FROM job_runs {'WHERE ' + ' AND '.join(where) if where else ''} "
                       f"ORDER BY started_at DESC LIMIT ${len(args)}", *args)


@router.get("/ops/alerts")
async def ops_alerts(
    state: Literal["firing", "all"] = "firing",
    limit: int = Query(50, ge=1, le=500),
    _: CurrentUser = Depends(analyst_or_admin),
):
    where = "WHERE state = 'firing'" if state == "firing" else ""
    return await _rows(f"SELECT * FROM ops_alerts {where} ORDER BY started_at DESC, id DESC LIMIT $1", limit)
