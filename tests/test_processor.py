import json
from processor.processor import EventProcessor
from processor.rule_engine import RuleEngine
from processor.scorer import DummyScorer

def test_enrichment_contract():
    raw={'event_id':'abc','event_ts':'2026-10-01T09:15:02.417Z','source':'web','user':'-','ip':'10.0.0.1','event_type':'http_request','severity':'medium','status':'success','host':'web-01','bytes_out':100,'process':'','method':'GET','path':'/','http_status':200,'user_agent':'test','response_ms':12}
    enriched,hits=EventProcessor(RuleEngine([]),DummyScorer()).process(raw)
    assert hits==[]
    assert 0<=enriched['risk_score']<=1
    assert enriched['rule_hits']==[]
    assert isinstance(json.loads(enriched['features']),dict)
    assert 'processed_ts' in enriched
