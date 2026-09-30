import json, logging
from confluent_kafka import Consumer, Producer, KafkaError
from .config import *

log=logging.getLogger(__name__)
class ProcessorConsumer:
    def __init__(self,handler,alert_emitter):
        self.consumer=Consumer({'bootstrap.servers':KAFKA_BOOTSTRAP,'group.id':GROUP_ID,'auto.offset.reset':'earliest','enable.auto.commit':False})
        self.producer=Producer({'bootstrap.servers':KAFKA_BOOTSTRAP})
        self.handler=handler; self.alert_emitter=alert_emitter
    def run(self):
        self.consumer.subscribe([RAW_TOPIC]); log.info('consuming %s',RAW_TOPIC)
        try:
            while True:
                msg=self.consumer.poll(1.0)
                if msg is None: continue
                if msg.error():
                    if msg.error().code()==KafkaError._PARTITION_EOF: continue
                    raise RuntimeError(msg.error())
                try:
                    event=json.loads(msg.value().decode())
                    enriched,hits=self.handler(event)
                    self.producer.produce(ENRICHED_TOPIC,key=str(event.get('ip','')),value=json.dumps(enriched,separators=(',',':')))
                    for hit in hits: self.alert_emitter.emit(hit.rule_id,hit.severity,event)
                    self.producer.flush()
                    self.consumer.commit(message=msg,asynchronous=False)
                except Exception: log.exception('processing failed; message will not be committed')
        finally: self.consumer.close()
