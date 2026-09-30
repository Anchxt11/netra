import os
from pathlib import Path

KAFKA_BOOTSTRAP=os.getenv('KAFKA_BOOTSTRAP','redpanda:9092')
RAW_TOPIC=os.getenv('RAW_TOPIC','events.raw')
ENRICHED_TOPIC=os.getenv('ENRICHED_TOPIC','events.enriched')
ALERT_TOPIC=os.getenv('ALERT_TOPIC','alerts')
GROUP_ID=os.getenv('PROCESSOR_GROUP_ID','netra-processor')
RULES_DIR=Path(os.getenv('RULES_DIR','/app/rules/sigma'))
SCORER_NAME=os.getenv('SCORER','dummy')
LOG_LEVEL=os.getenv('LOG_LEVEL','INFO')
