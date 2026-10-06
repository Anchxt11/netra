"""The KPI crossing rules (contracts/LIVE_API.md, 4.2) and the KPI values (4.1)."""
from api.app.kpi_rules import (
    CRIT, NAMES, NO_DATA, OK, WARN,
    KpiAlerter, Track, check_config_value, level_of, thresholds_from_config, values_from_row,
)


def run(levels):
    """Feed one KPI's readings in order; return [(reading index, action, level)] for each change."""
    t = Track()
    out = []
    for i, lv in enumerate(levels):
        step = t.step(lv)
        if step:
            out.append((i, step.action, step.level))
    return out


# --------------------------------------------------------------------------- levels

def test_level_of():
    assert level_of(None, 1, 2) == NO_DATA
    assert level_of(0.5, 1, 2) == OK
    assert level_of(1, 1, 2) == WARN      # at the line counts as over it
    assert level_of(2, 1, 2) == CRIT
    assert level_of(5, None, None) == OK  # no lines: never a breach
    assert level_of(5, None, 3) == CRIT
    assert level_of(5, 3, None) == WARN


# --------------------------------------------------------------------------- opening

def test_one_breach_does_not_open():
    assert run([CRIT, OK, CRIT, OK]) == []


def test_two_breaches_in_a_row_open():
    assert run([OK, WARN, WARN]) == [(2, "open", WARN)]
    assert run([CRIT, CRIT]) == [(1, "open", CRIT)]


def test_opens_at_the_lower_level():
    assert run([WARN, CRIT]) == [(1, "open", WARN)]
    assert run([CRIT, WARN]) == [(1, "open", WARN)]


def test_no_data_does_not_break_or_count():
    assert run([WARN, NO_DATA, WARN]) == [(2, "open", WARN)]
    assert run([NO_DATA, NO_DATA, CRIT]) == []


# --------------------------------------------------------------------------- clearing

def test_clears_after_two_normal_readings():
    assert run([WARN, WARN, OK, OK]) == [(1, "open", WARN), (3, "clear", WARN)]


def test_one_normal_reading_does_not_clear():
    assert run([CRIT, CRIT, OK, CRIT, OK, CRIT]) == [(1, "open", CRIT)]


def test_cleared_alert_keeps_its_level_and_can_open_again():
    assert run([CRIT, CRIT, OK, OK, WARN, WARN]) == [(1, "open", CRIT), (3, "clear", CRIT), (5, "open", WARN)]


def test_no_data_while_firing_neither_clears_nor_resets():
    assert run([WARN, WARN, OK, NO_DATA, OK]) == [(1, "open", WARN), (4, "clear", WARN)]


# --------------------------------------------------------------------------- changing level

def test_two_readings_at_the_other_level_change_it():
    assert run([WARN, WARN, CRIT, CRIT]) == [(1, "open", WARN), (3, "level", CRIT)]
    assert run([CRIT, CRIT, WARN, WARN]) == [(1, "open", CRIT), (3, "level", WARN)]


def test_one_reading_at_the_other_level_does_not():
    assert run([WARN, WARN, CRIT, WARN, CRIT, WARN]) == [(1, "open", WARN)]


def test_a_normal_reading_resets_the_level_streak():
    assert run([WARN, WARN, CRIT, OK, CRIT]) == [(1, "open", WARN)]


# --------------------------------------------------------------------------- every KPI at once

def test_alerter_tracks_each_kpi_separately():
    a = KpiAlerter()
    base = {n: OK for n in NAMES}
    assert a.observe({**base, "http_5xx_rate": CRIT}) == {}
    changes = a.observe({**base, "http_5xx_rate": CRIT, "login_failure_rate": WARN})
    assert list(changes) == ["http_5xx_rate"] and changes["http_5xx_rate"].action == "open"


def test_restore_carries_on_a_firing_alert():
    a = KpiAlerter()
    a.restore("rule_hit_rate", CRIT)
    base = {n: OK for n in NAMES}
    assert a.observe({**base, "rule_hit_rate": CRIT}) == {}  # still firing: nothing new opens
    a.observe(base)
    changes = a.observe(base)
    assert changes["rule_hit_rate"].action == "clear" and changes["rule_hit_rate"].level == CRIT


# --------------------------------------------------------------------------- values and config

def row(**kw):
    keys = ["events_1m", "events_5m", "logins_1m", "logins_5m", "login_failures_1m", "login_failures_5m",
            "requests_1m", "requests_5m", "errors_5xx_1m", "errors_5xx_5m", "bytes_1m", "bytes_5m",
            "rule_hits_1m", "rule_hits_5m"]
    return {k: kw.get(k, 0) for k in keys}


def test_values_from_row():
    v = values_from_row(row(events_1m=600, events_5m=2400, logins_1m=50, login_failures_1m=20,
                            logins_5m=100, login_failures_5m=25, requests_1m=500, errors_5xx_1m=5,
                            bytes_1m=12_000_000, bytes_5m=30_000_000, rule_hits_1m=6, rule_hits_5m=12))
    assert v["events_per_sec"] == (10.0, 8.0)
    assert v["login_failure_rate"] == (0.4, 0.25)
    assert v["http_5xx_rate"] == (0.01, None)  # no requests in the 5 minute column of this row
    assert v["bytes_out_per_min"] == (12_000_000, 6_000_000)
    assert v["rule_hit_rate"] == (0.01, 0.005)


def test_no_events_means_no_data_not_zero():
    v = values_from_row(row())
    assert v["events_per_sec"] == (0.0, 0.0)          # 0 events per second is a real reading
    assert v["login_failure_rate"] == (None, None)    # but a rate of nothing is unknown
    assert v["rule_hit_rate"] == (None, None)


def test_thresholds_from_config():
    t = thresholds_from_config({"kpi.http_5xx_rate.warn": 0.02, "kpi.http_5xx_rate.crit": None,
                                "kpi.events_per_sec.warn": "fast", "kpi.events_per_sec.crit": True})
    assert t["http_5xx_rate"] == {"warn": 0.02, "crit": None}
    assert t["events_per_sec"] == {"warn": None, "crit": None}  # not numbers: no line
    assert t["rule_hit_rate"] == {"warn": None, "crit": None}


def test_check_config_value():
    assert check_config_value("freshness_sla_p95_seconds", "anything") is None  # other keys are not checked
    assert check_config_value("kpi.http_5xx_rate.warn", 0.02) is None
    assert check_config_value("kpi.http_5xx_rate.crit", None) is None
    assert check_config_value("kpi.http_5xx_rate.crit", -1)
    assert check_config_value("kpi.http_5xx_rate.crit", "0.05")
    assert check_config_value("kpi.http_5xx_rate.crit", True)
    assert check_config_value("kpi.cpu.warn", 1)
    assert check_config_value("kpi.http_5xx_rate.high", 1)
