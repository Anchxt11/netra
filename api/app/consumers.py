"""Background Kafka consumers.

events.enriched -> batched and broadcast to WebSocket clients (ClickHouse is filled by A's Kafka engine, not us)
alerts          -> written to Postgres as incidents, then broadcast
"""
import asyncio
import json
import logging

from aiokafka import AIOKafkaConsumer

from . import repo
from .settings import settings
from .util import parse_features
from .ws import manager

log = logging.getLogger("consumers")
state = {"events": False, "alerts": False}  # exposed on /health
_event_buf: list[dict] = []


async def _consume(name: str, topic: str, offset: str, handler):
    while True:
        consumer = AIOKafkaConsumer(
            topic,
            bootstrap_servers=settings.kafka_bootstrap,
            group_id=f"{settings.kafka_group_prefix}-{name}",
            auto_offset_reset=offset,
            enable_auto_commit=True,
        )
        try:
            await consumer.start()
            state[name] = True
            log.info("consuming %s", topic)
            async for msg in consumer:
                try:
                    data = json.loads(msg.value)
                except ValueError:
                    log.warning("bad json on %s", topic)
                    continue
                try:
                    await handler(data)
                except Exception:
                    log.exception("handler failed for %s", topic)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("%s consumer error: %s (retrying in 3s)", name, e)
        finally:
            state[name] = False
            try:
                await consumer.stop()
            except Exception:
                pass
        await asyncio.sleep(3)


async def _on_event(ev: dict):
    _event_buf.append(parse_features(ev))


async def _on_alert(alert: dict):
    incident = await repo.insert_incident(alert)
    if incident:  # None means duplicate alert_id, already stored and pushed
        manager.broadcast("alert", incident)


async def _flusher():
    """Every ws_flush_ms, push buffered events as one message. Caps the batch so 10x load can't flood browsers."""
    interval = settings.ws_flush_ms / 1000
    cap = settings.ws_max_events_per_push
    while True:
        await asyncio.sleep(interval)
        if not _event_buf:
            continue
        batch = _event_buf[:]
        _event_buf.clear()
        dropped = max(0, len(batch) - cap)
        manager.broadcast("events", batch[-cap:], dropped=dropped)


def start_all() -> list[asyncio.Task]:
    return [
        asyncio.create_task(_consume("events", settings.topic_enriched, "latest", _on_event)),
        asyncio.create_task(_consume("alerts", settings.topic_alerts, "earliest", _on_alert)),
        asyncio.create_task(_flusher()),
    ]
