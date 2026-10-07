"""The processor's batch loop (docs/CONCURRENCY_PLAN.md, step 1): no flush per event,
offsets committed only after every output of the batch was delivered."""
import json

import pytest

confluent_kafka = pytest.importorskip("confluent_kafka")

from processor.alerts import AlertEmitter  # noqa: E402
from processor.consumer import DeliveryFailed, ProcessorConsumer  # noqa: E402


class Msg:
    def __init__(self, partition, offset, event):
        self._p, self._o, self._v = partition, offset, json.dumps(event).encode()

    def error(self): return None
    def topic(self): return "events.raw"
    def partition(self): return self._p
    def offset(self): return self._o
    def value(self): return self._v


class FakeConsumer:
    def __init__(self, batches): self.batches, self.commits, self.log = list(batches), [], None
    def consume(self, num_messages, timeout): return self.batches.pop(0) if self.batches else []
    def commit(self, offsets, asynchronous):
        self.log.append("commit")
        self.commits.append(sorted((o.partition, o.offset) for o in offsets))


class FakeProducer:
    def __init__(self, log, fail=False): self.log, self.fail, self.queued, self.sent = log, fail, [], []
    def produce(self, topic, key=None, value=None, on_delivery=None):
        self.log.append(f"produce {topic}")
        self.queued.append((topic, key, value, on_delivery))
    def poll(self, t): pass
    def flush(self, timeout):
        self.log.append("flush")
        for topic, key, value, cb in self.queued:
            self.sent.append((topic, key))
            if cb: cb("broker down" if self.fail else None, None)
        self.queued = []
        return 0


def ev(i, ip): return {"event_id": f"e{i}", "ip": ip}


def make(batches, fail_alerts=False, hits_for=()):
    log = []
    consumer = FakeConsumer(batches)
    consumer.log = log
    out, alerts = FakeProducer(log), FakeProducer(log, fail=fail_alerts)
    hit = type("Hit", (), {"rule_id": "brute_force", "severity": "high"})
    seen = []

    def handler(event):
        seen.append(event["event_id"])
        return {**event, "rule_hits": []}, [hit] if event["event_id"] in hits_for else []

    pc = ProcessorConsumer(handler, AlertEmitter(alerts, "alerts"), consumer=consumer, producer=out)
    return pc, consumer, out, alerts, log, seen


def test_one_flush_per_batch_then_commit_each_partition_after_its_last_offset():
    batch = [Msg(0, 10, ev(1, "a")), Msg(1, 4, ev(2, "b")), Msg(0, 11, ev(3, "a"))]
    pc, consumer, out, alerts, log, seen = make([batch], hits_for={"e3"})
    assert pc.run_batch() == 3
    assert seen == ["e1", "e2", "e3"]  # in order: one IP's events never run out of order
    assert log.count("flush") == 2  # once per producer per batch, not once per event
    assert log.index("commit") > max(i for i, x in enumerate(log) if x == "flush")  # commit after delivery
    assert consumer.commits == [[(0, 12), (1, 5)]]
    assert [t for t, _ in out.sent] == ["events.enriched"] * 3 and alerts.sent == [("alerts", "a")]


def test_a_failed_delivery_stops_without_committing():
    pc, consumer, *_ = make([[Msg(0, 1, ev(1, "a"))]], fail_alerts=True, hits_for={"e1"})
    with pytest.raises(DeliveryFailed):
        pc.run_batch()
    assert consumer.commits == []  # replayed on restart, never lost


def test_bad_input_is_skipped_but_its_offset_moves_on():
    bad = Msg(0, 7, {})
    bad._v = b"not json"
    pc, consumer, out, *_ = make([[bad, Msg(0, 8, ev(2, "a"))]])
    assert pc.run_batch() == 1
    assert consumer.commits == [[(0, 9)]]


def test_an_empty_poll_commits_nothing():
    pc, consumer, *_ = make([[]])
    assert pc.run_batch() == 0 and consumer.commits == []


def test_a_full_producer_queue_waits_and_retries_instead_of_dropping():
    from processor.alerts import produce_waiting
    calls = {"produce": 0, "poll": 0}

    class Full:
        def produce(self, topic, **kw):
            calls["produce"] += 1
            if calls["produce"] < 3:
                raise BufferError("Local: Queue full")

        def poll(self, t):
            calls["poll"] += 1

    produce_waiting(Full(), "alerts", key="a", value="{}")
    assert calls == {"produce": 3, "poll": 2}
