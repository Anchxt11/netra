import json, uuid
from datetime import datetime, timezone

def produce_waiting(producer,topic,attempts=30,**kw):
    """produce(), but when the local queue is full, wait for deliveries to drain it and retry,
    instead of raising BufferError and dropping the message."""
    for _ in range(attempts):
        try: return producer.produce(topic,**kw)
        except BufferError: producer.poll(1)
    raise BufferError(f'producer queue still full after {attempts} s; is Redpanda reachable?')

def utc_now_iso(): return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
class AlertEmitter:
    def __init__(self,producer,topic): self.producer=producer; self.topic=topic; self.on_delivery=None  # set by ProcessorConsumer
    def emit(self,rule_id,severity,event,model=None):
        alert={'alert_id':str(uuid.uuid4()),'rule_id':rule_id,'model':model,'severity':severity,'event_ids':[event['event_id']],'created_ts':utc_now_iso(),
               # contracts/LIVE_API.md 5.1: the event's address, account and host on every alert
               'ip':event.get('ip'),'user':event.get('user'),'host':event.get('host')}
        kw={'on_delivery':self.on_delivery} if self.on_delivery else {}
        produce_waiting(self.producer,self.topic,key=str(event.get('ip','')),value=json.dumps(alert,separators=(',',':')),**kw)
        return alert
