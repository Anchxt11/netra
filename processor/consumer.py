import json, logging, os
from confluent_kafka import Consumer, Producer, KafkaError, TopicPartition
from .alerts import produce_waiting
from .config import *

log=logging.getLogger(__name__)

# Concurrency fix plan, step 1 (docs/CONCURRENCY_PLAN.md): no flush() per event.
# Events are consumed in small batches; each is processed in order (one partition = one IP = one
# order, so the rule windows stay correct), its outputs are queued, and once per batch both
# producers are flushed. Offsets are committed only after every output of the batch was delivered,
# so the pipeline stays at-least-once: a crash or a failed delivery replays, never loses.
BATCH_MAX=int(os.getenv('PROCESSOR_BATCH_MAX','500'))
BATCH_MS=int(os.getenv('PROCESSOR_BATCH_MS','100'))
FLUSH_TIMEOUT_S=float(os.getenv('PROCESSOR_FLUSH_TIMEOUT_S','30'))

class DeliveryFailed(RuntimeError):
    """An output was not delivered: stop without committing, so the batch is consumed again on restart."""

class ProcessorConsumer:
    def __init__(self,handler,alert_emitter,consumer=None,producer=None):
        self.consumer=consumer or Consumer({'bootstrap.servers':KAFKA_BOOTSTRAP,'group.id':GROUP_ID,'auto.offset.reset':'earliest','enable.auto.commit':False})
        self.producer=producer or Producer({'bootstrap.servers':KAFKA_BOOTSTRAP})
        self.handler=handler; self.alert_emitter=alert_emitter
        self.alert_emitter.on_delivery=self._delivered
        self.failures=[]

    def _delivered(self,err,msg):
        if err is not None: self.failures.append(err)

    def run(self):
        self.consumer.subscribe([RAW_TOPIC]); log.info('consuming %s (batches of up to %d or %d ms)',RAW_TOPIC,BATCH_MAX,BATCH_MS)
        try:
            while True: self.run_batch()
        finally: self.consumer.close()

    def run_batch(self)->int:
        """One batch: process in order, queue outputs, confirm delivery, then commit. Returns events processed."""
        msgs=self.consumer.consume(num_messages=BATCH_MAX,timeout=BATCH_MS/1000)
        if not msgs: return 0
        last={}  # (topic, partition) -> highest message seen, committed as offset+1
        done=0
        for msg in msgs:
            if msg.error():
                if msg.error().code()==KafkaError._PARTITION_EOF: continue
                raise RuntimeError(msg.error())
            try:
                event=json.loads(msg.value().decode())
                enriched,hits=self.handler(event)
                produce_waiting(self.producer,ENRICHED_TOPIC,key=str(event.get('ip','')),value=json.dumps(enriched,separators=(',',':')),on_delivery=self._delivered)
                for hit in hits: self.alert_emitter.emit(hit.rule_id,hit.severity,event)
                self.producer.poll(0)
                done+=1
            except BufferError: raise  # local queue full: let the restart replay instead of skipping
            except Exception: log.exception('processing failed; event skipped (bad input)')
            last[(msg.topic(),msg.partition())]=msg
        left=self.producer.flush(FLUSH_TIMEOUT_S)+self.alert_emitter.producer.flush(FLUSH_TIMEOUT_S)
        if left or self.failures:
            raise DeliveryFailed(f'{left} outputs not delivered, {len(self.failures)} failed: {self.failures[:3]}; not committing')
        self.consumer.commit(offsets=[TopicPartition(t,p,m.offset()+1) for (t,p),m in last.items()],asynchronous=False)
        return done
