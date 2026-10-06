import json, uuid
from datetime import datetime, timezone

def utc_now_iso(): return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
class AlertEmitter:
    def __init__(self,producer,topic): self.producer=producer; self.topic=topic
    def emit(self,rule_id,severity,event,model=None):
        alert={'alert_id':str(uuid.uuid4()),'rule_id':rule_id,'model':model,'severity':severity,'event_ids':[event['event_id']],'created_ts':utc_now_iso()}
        self.producer.produce(self.topic,key=str(event.get('ip','')),value=json.dumps(alert,separators=(',',':')))
        return alert
