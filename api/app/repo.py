import uuid

from .db import get_pool
from .util import parse_ts

COLS = ("id, alert_id, rule_id, model, title, severity, event_ids, status, "
        "assigned_to, notes, created_ts, updated_ts")


async def insert_incident(a: dict) -> dict | None:
    """Insert an alert as an incident. Returns None if alert_id was already stored (duplicate)."""
    eids = a.get("event_ids") or []
    if isinstance(eids, str):
        eids = [eids]
    row = await get_pool().fetchrow(
        f"""INSERT INTO incidents (alert_id, rule_id, model, title, severity, event_ids, payload, created_ts)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (alert_id) DO NOTHING
            RETURNING {COLS}""",
        str(a.get("alert_id") or uuid.uuid4()),
        a.get("rule_id"),
        a.get("model"),
        a.get("title"),
        str(a.get("severity") or "unknown").lower(),
        [str(e) for e in eids],
        a,
        parse_ts(a.get("created_ts")),
    )
    return dict(row) if row else None
