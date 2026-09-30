import logging, os
from confluent_kafka import Producer
from .alerts import AlertEmitter
from .config import ALERT_TOPIC, LOG_LEVEL, RULES_DIR, SCORER_NAME
from .consumer import ProcessorConsumer
from .processor import EventProcessor
from .rule_engine import RuleEngine
from .scorer import build_scorer

def main():
    logging.basicConfig(level=getattr(logging,LOG_LEVEL.upper(),logging.INFO),format='%(asctime)s %(levelname)s %(name)s: %(message)s')
    engine=RuleEngine.from_directory(RULES_DIR)
    processor=EventProcessor(engine,build_scorer(SCORER_NAME))
    producer=Producer({'bootstrap.servers':os.getenv('KAFKA_BOOTSTRAP','redpanda:9092')})
    ProcessorConsumer(processor.process,AlertEmitter(producer,ALERT_TOPIC)).run()

if __name__=='__main__': main()
