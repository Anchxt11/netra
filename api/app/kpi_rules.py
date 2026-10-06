"""KPI values, levels and the alert crossing rules (contracts/LIVE_API.md, 4.1 and 4.2).

Pure Python on purpose: no database, no Kafka, so tests/test_kpi.py runs anywhere.
"""
import re
from dataclasses import dataclass, field

# The strip's order. (name, unit)
KPIS: tuple[tuple[str, str], ...] = (
    ("events_per_sec", "events/s"),
    ("login_failure_rate", "ratio"),
    ("http_5xx_rate", "ratio"),
    ("bytes_out_per_min", "bytes/min"),
    ("rule_hit_rate", "ratio"),
)
NAMES = tuple(name for name, _ in KPIS)

OK, WARN, CRIT, NO_DATA = "ok", "warn", "crit", "no_data"
BREACH = (WARN, CRIT)
IN_A_ROW = 2  # breaches to open, readings to change level, normal readings to clear

# Starting lines, seeded into `config` once. Placeholders until the A4 load test gives real numbers.
DEFAULT_THRESHOLDS: dict[str, tuple[float, float]] = {
    "events_per_sec": (50, 100),
    "login_failure_rate": (0.2, 0.4),
    "http_5xx_rate": (0.02, 0.05),
    "bytes_out_per_min": (200_000_000, 1_000_000_000),
    "rule_hit_rate": (0.05, 0.15),
}

_KEY = re.compile(r"^kpi\.([a-z0-9_]+)\.(warn|crit)$")


def _ratio(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def values_from_row(r: dict) -> dict[str, tuple[float | None, float | None]]:
    """The ClickHouse aggregate row (kpi.SQL) as {name: (value_1m, value_5m)}."""
    n = {k: int(v or 0) for k, v in r.items()}
    return {
        "events_per_sec": (round(n["events_1m"] / 60, 2), round(n["events_5m"] / 300, 2)),
        "login_failure_rate": (_ratio(n["login_failures_1m"], n["logins_1m"]), _ratio(n["login_failures_5m"], n["logins_5m"])),
        "http_5xx_rate": (_ratio(n["errors_5xx_1m"], n["requests_1m"]), _ratio(n["errors_5xx_5m"], n["requests_5m"])),
        "bytes_out_per_min": (n["bytes_1m"], round(n["bytes_5m"] / 5)),
        "rule_hit_rate": (_ratio(n["rule_hits_1m"], n["events_1m"]), _ratio(n["rule_hits_5m"], n["events_5m"])),
    }


def _number(v) -> float | None:
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def thresholds_from_config(cfg: dict) -> dict[str, dict[str, float | None]]:
    """`config` rows ({key: value}) as {name: {"warn": x, "crit": y}}. Anything not a number means no line."""
    return {name: {lv: _number(cfg.get(f"kpi.{name}.{lv}")) for lv in BREACH} for name in NAMES}


def check_config_value(key: str, value) -> str | None:
    """Why PUT /config may not store this value, or None if it may. Only `kpi.*` keys are checked."""
    if not key.startswith("kpi."):
        return None
    m = _KEY.match(key)
    if not m or m.group(1) not in NAMES:
        return f"Unknown KPI threshold '{key}'. Use kpi.<name>.warn or kpi.<name>.crit with a name from {', '.join(NAMES)}."
    if value is not None and (_number(value) is None or value < 0):
        return "A threshold is a number of 0 or more, or null for no line."
    return None


def level_of(value: float | None, warn: float | None, crit: float | None) -> str:
    """This one reading's level. All five KPIs alert when the value rises."""
    if value is None:
        return NO_DATA
    if crit is not None and value >= crit:
        return CRIT
    if warn is not None and value >= warn:
        return WARN
    return OK


@dataclass
class Transition:
    action: str  # "open", "level" (moved between warn and crit) or "clear"
    level: str   # the alert's level after the change (a cleared alert keeps the level it fired at)


@dataclass
class Track:
    """One KPI's alert state between readings."""
    firing: str | None = None        # the open alert's level, or None
    pending: list[str] = field(default_factory=list)  # breaches in a row while not firing
    other: int = 0                   # firing: readings in a row at the other breach level
    normal: int = 0                  # firing: normal readings in a row

    def step(self, level: str) -> Transition | None:
        if level == NO_DATA:
            return None  # counts as neither and does not break a streak
        breach = level in BREACH
        if self.firing is None:
            if not breach:
                self.pending = []
                return None
            self.pending.append(level)
            if len(self.pending) < IN_A_ROW:
                return None
            opened = WARN if WARN in self.pending else CRIT  # the lower of the levels in the streak
            self.firing, self.pending, self.other, self.normal = opened, [], 0, 0
            return Transition("open", opened)
        if not breach:
            self.other = 0
            self.normal += 1
            if self.normal < IN_A_ROW:
                return None
            last, self.firing, self.normal = self.firing, None, 0
            return Transition("clear", last)
        self.normal = 0
        if level == self.firing:
            self.other = 0
            return None
        self.other += 1
        if self.other < IN_A_ROW:
            return None
        self.firing, self.other = level, 0
        return Transition("level", level)


class KpiAlerter:
    """The crossing rules for every KPI: feed it each reading's levels, get back what changed."""

    def __init__(self):
        self.tracks = {name: Track() for name in NAMES}

    def restore(self, name: str, level: str):
        """An alert still firing in the database (for example after an API restart)."""
        self.tracks[name] = Track(firing=level)

    def observe(self, levels: dict[str, str]) -> dict[str, Transition]:
        out = {}
        for name, level in levels.items():
            t = self.tracks[name].step(level)
            if t:
                out[name] = t
        return out
