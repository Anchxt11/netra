from pathlib import Path
from processor.rule_engine import RuleEngine
RULES=Path(__file__).resolve().parents[1]/'rules'/'sigma'

def test_brute_force_window():
    e=RuleEngine.from_directory(RULES); x={'event_type':'login','status':'failure','ip':'10.0.0.1','user':'alice'}
    for i in range(4): assert not e.evaluate(x,now=float(i))
    assert any(h.rule_id=='brute_force' for h in e.evaluate(x,now=4))

def test_suspicious_login():
    e=RuleEngine.from_directory(RULES); x={'event_type':'login','status':'failure','ip':'10.0.0.2','user':'admin-user'}
    assert any(h.rule_id=='suspicious_login' for h in e.evaluate(x,now=0))

def test_privilege_escalation():
    e=RuleEngine.from_directory(RULES); x={'event_type':'process_start','status':'success','ip':'10.0.0.3','user':'alice','process':'sudo systemctl restart nginx'}
    assert any(h.rule_id=='privilege_escalation' for h in e.evaluate(x,now=0))
