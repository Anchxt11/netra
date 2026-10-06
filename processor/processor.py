import json
from datetime import datetime, timezone
from .features import build_features

def utc_now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')

class EventProcessor:
    def __init__(self,rule_engine,scorer): self.rule_engine=rule_engine; self.scorer=scorer
    def process(self,event):
        features=build_features(event)
        hits=self.rule_engine.evaluate(event)
        enriched=dict(event)
        enriched['features']=json.dumps(features,separators=(',',':'))
        enriched['risk_score']=float(self.scorer.score(features))
        enriched['rule_hits']=[h.rule_id for h in hits]
        enriched['processed_ts']=utc_now_iso()
        return enriched,hits
