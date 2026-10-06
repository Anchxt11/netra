import json
from datetime import datetime, timezone


def _default(o):
    if hasattr(o, "isoformat"):
        return o.isoformat()
    return str(o)


def dumps(obj) -> str:
    return json.dumps(obj, default=_default)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_ts(v) -> datetime:
    """Accepts ISO string, epoch seconds or epoch millis. Falls back to now."""
    try:
        if isinstance(v, (int, float)):
            return datetime.fromtimestamp(v if v < 1e11 else v / 1000, tz=timezone.utc)
        if isinstance(v, str):
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (ValueError, OverflowError, OSError):
        pass
    return datetime.now(timezone.utc)


def parse_features(ev: dict) -> dict:
    """`features` is a JSON string column in the enriched schema; expose it as an object."""
    f = ev.get("features")
    if isinstance(f, str):
        try:
            ev["features"] = json.loads(f)
        except ValueError:
            pass
    return ev
