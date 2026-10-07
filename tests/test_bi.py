"""The Power BI views and the read-only user (ops/bi.py), on a real embedded Postgres.

Needs `pip install pgserver psycopg[binary]`; skipped otherwise. The ClickHouse side of the rollup is faked.
"""
import pytest

pgserver = pytest.importorskip("pgserver")
psycopg = pytest.importorskip("psycopg")

from pathlib import Path  # noqa: E402
from urllib.parse import urlparse, urlunparse  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def db(tmp_path_factory):
    import sys
    sys.path.insert(0, str(ROOT / "api"))
    from app.schema import SCHEMA_SQL
    from ops.store import PgStore
    srv = pgserver.get_server(str(tmp_path_factory.mktemp("pg")), cleanup_mode="stop")
    with psycopg.connect(srv.get_uri(), autocommit=True) as c:
        c.execute((ROOT / "api" / "db" / "init.sql").read_text())
        c.execute(SCHEMA_SQL)
    yield srv.get_uri(), PgStore(srv.get_uri())


def as_bi(url):
    from ops import bi
    p = urlparse(url)
    return urlunparse(p._replace(netloc=f"{bi.BI_USER}:{bi.BI_PASSWORD}@{p.hostname}" + (f":{p.port}" if p.port else "")))


def test_views_return_rows_and_the_bi_user_cannot_write(db):
    from ops import bi
    url, store = db
    bi.setup(store)
    bi.setup(store)  # safe to run at every start
    store.q("INSERT INTO incidents (alert_id, rule_id, severity, status, created_ts, notes) VALUES "
            "('a1', 'brute_force', 'high', 'acknowledged', now(), '2026-10-07T09:00:00Z admin APPROVED enable_mfa')")
    store.q("INSERT INTO kpi_alerts (kpi, level, state, value, threshold, started_at, updated_at) VALUES ('http_5xx_rate', 'warn', 'firing', 0.03, 0.02, now(), now())")
    store.insert_run({"job": "sla_check", "started_at": "2026-10-07T09:00:00Z", "finished_at": "2026-10-07T09:00:01Z",
                      "duration_ms": 9, "status": "ok", "detail": "Within the SLA.", "result": None})
    assert bi.write_rollup(store, [{"minute": "2026-10-07 09:00:00", "events": 600, "flagged_rule": 30, "p50": 0.9, "p95": 6.2}]) == 1
    with psycopg.connect(as_bi(url), autocommit=True) as ro:
        counts = {v: len(ro.execute(f"SELECT * FROM bi.{v}").fetchall()) for v in bi.VIEWS}
        assert all(n >= 1 for n in counts.values()), counts
        assert ro.execute("SELECT decision, action_id FROM bi.bi_decisions").fetchone() == ("approved", "enable_mfa")
        assert ro.execute("SELECT detail FROM bi.bi_job_runs").fetchone() == ("Within the SLA.",)
        assert ro.execute("SELECT target_p95_s, breach FROM bi.bi_freshness").fetchone() == (5.0, True)
        for stmt in ("DELETE FROM bi.bi_incidents", "SELECT * FROM public.incidents", "CREATE TABLE public.x (a int)"):
            with pytest.raises(psycopg.Error):
                ro.execute(stmt)
        ro.execute("SET default_transaction_read_only = off")  # even then, only SELECT is granted
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            ro.execute("DELETE FROM bi.bi_incidents")
