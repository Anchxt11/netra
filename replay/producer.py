"""flow-replay: replay held-out test flows onto Redpanda's `flows.raw` topic.

Each row from data/replay/flows_test.jsonl is produced in time order, keeping the
original inter-row gaps (real-speed by default, compressed by SPEED=N).  The label
file is never read or sent.  Every produced row keeps the four required fields
(stream_name, timestamp, event_id, message_sanitized) exactly as in the file and
adds two new fields:
  source       = "replay"  (so ml_scorer.core can tag its alerts)
  original_ts  = the row's original timestamp string (honesty log)
The row's `timestamp` is rewritten to wall-clock "now" at the moment of send,
preserving inter-row gaps so the dashboard's freshness clock stays honest.

Environment variables:
  KAFKA_BOOTSTRAP  redpanda:9092 (default)
  FLOWS_TOPIC      flows.raw     (default)
  FLOWS_FILE       /data/replay/flows_test.jsonl  (default)
  SPEED            1  – wall-clock multiplier (10 = 10× faster)
  LOOP             0  – set to 1 to restart from the beginning after the last row
"""
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from confluent_kafka import Producer

BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "redpanda:9092")
FLOWS_TOPIC = os.getenv("FLOWS_TOPIC", "flows.raw")
FLOWS_FILE = Path(os.getenv("FLOWS_FILE", "/data/replay/flows_test.jsonl"))
SPEED = float(os.getenv("SPEED", "1"))
LOOP = os.getenv("LOOP", "0").strip().lower() in ("1", "true", "yes")

REQUIRED_FIELDS = ("stream_name", "timestamp", "event_id", "message_sanitized")

log = logging.getLogger("flow-replay")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def to_epoch(ts_str: str) -> float:
    """Parse an ISO-8601 timestamp string to a float POSIX epoch."""
    dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
    return dt.timestamp()


def load_rows(path: Path) -> list[dict]:
    """Load and validate all rows from the JSONL file.  Skips blank lines."""
    rows = []
    for lineno, line in enumerate(path.read_text().splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            log.warning("line %d: skipping invalid JSON – %s", lineno, exc)
            continue
        missing = [f for f in REQUIRED_FIELDS if f not in row]
        if missing:
            log.warning("line %d: skipping row missing fields %s", lineno, missing)
            continue
        # Safety: never carry labels, even if they slip in from the wrong file.
        for label_key in ("label_binary", "incident_ids", "label", "labels"):
            row.pop(label_key, None)
        rows.append(row)
    return rows


def replay_once(producer: Producer, rows: list[dict]) -> None:
    """Send all rows once, respecting their original inter-row gaps."""
    if not rows:
        log.warning("No rows to replay.")
        return

    # Sort by original timestamp so order is always deterministic.
    sorted_rows = sorted(rows, key=lambda r: r["timestamp"])

    first_orig_epoch = to_epoch(str(sorted_rows[0]["timestamp"]))
    replay_start = time.time()

    for i, row in enumerate(sorted_rows):
        orig_epoch = to_epoch(str(row["timestamp"]))
        orig_offset = orig_epoch - first_orig_epoch          # seconds since first row (original)
        wall_offset = orig_offset / max(SPEED, 1e-9)        # compressed by SPEED

        # Sleep until it is time to send this row.
        target_wall = replay_start + wall_offset
        sleep_for = target_wall - time.time()
        if sleep_for > 0:
            time.sleep(sleep_for)

        # Rewrite timestamp to now; keep original in original_ts.
        send_ts = utc_now_iso()
        outrow = {k: v for k, v in row.items() if k != "timestamp"}
        outrow["stream_name"] = row["stream_name"]
        outrow["event_id"] = row["event_id"]
        outrow["message_sanitized"] = row["message_sanitized"]
        outrow["original_ts"] = str(row["timestamp"])
        outrow["timestamp"] = send_ts
        outrow["source"] = "replay"

        producer.produce(
            FLOWS_TOPIC,
            key=str(row["event_id"]),
            value=json.dumps(outrow, separators=(",", ":")),
        )
        producer.poll(0)

        if (i + 1) % 500 == 0:
            log.info("sent %d / %d rows", i + 1, len(sorted_rows))

    producer.flush(30)
    log.info("replay complete: %d rows sent to %s", len(sorted_rows), FLOWS_TOPIC)


def main():
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    log.info("flow-replay starting  file=%s  topic=%s  speed=%.1f  loop=%s",
             FLOWS_FILE, FLOWS_TOPIC, SPEED, LOOP)

    if not FLOWS_FILE.exists():
        raise FileNotFoundError(
            f"{FLOWS_FILE} not found.  "
            "Put data/replay/flows_test.jsonl in place (from Aliya, ML team)."
        )

    rows = load_rows(FLOWS_FILE)
    log.info("loaded %d valid rows from %s", len(rows), FLOWS_FILE)

    producer = Producer({"bootstrap.servers": BOOTSTRAP})

    pass_num = 0
    while True:
        pass_num += 1
        log.info("pass %d: replaying %d rows …", pass_num, len(rows))
        replay_once(producer, rows)
        if not LOOP:
            break
        log.info("LOOP=1 – restarting from the beginning")

    log.info("flow-replay done.")


if __name__ == "__main__":
    main()
