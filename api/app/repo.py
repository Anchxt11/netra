import uuid

from .db import get_pool
from .util import parse_ts

# The alert fields of contracts/LIVE_API.md 5.1 come from the stored alert (payload), so rows stored
# before an alert carried them read as null.
ALERT_FIELDS = ("payload->>'ip' AS ip, payload->>'user' AS \"user\", payload->>'host' AS host, "
                "payload->>'class' AS class, (payload->>'probability')::float AS probability, "
                "(payload->>'anomaly_score')::float AS anomaly_score, (payload->>'risk_score')::float AS risk_score, "
                "payload->'reasons' AS reasons")
COLS = ("id, alert_id, rule_id, model, title, severity, event_ids, status, "
        "assigned_to, notes, created_ts, updated_ts, " + ALERT_FIELDS)


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
