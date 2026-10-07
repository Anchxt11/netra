#!/usr/bin/env python3
"""
lab-normalizer — Consumes events.lab, maps nginx JSON logs to the frozen
raw event schema, and produces to events.raw.

Reads {"kind": "web", "raw": "<nginx JSON line>"} envelopes.
Routes on `kind`: only "web" is implemented for now; "auth" and "cmd" are
reserved for the host-level lab addendum (Section 16).

Mapping (nginx → raw schema):
  event_id    : generated UUID4
  event_ts    : nginx $msec → UTC ISO-8601 with ms
  source      : "lab"   (to be overwritten to match existing schema enum — see note)
  ip          : $remote_addr
  user        : parsed from req_body on login endpoint, else "-"
  event_type  : derived from method + path + status
  severity    : derived from event_type
  status      : "success" | "failure" from HTTP status code
  host        : constant "juice-shop" (the lab victim)
  bytes_out   : $body_bytes_sent
  process     : ""
  method      : $request_method
  path        : $request_uri
  http_status : nginx $status
  user_agent  : $http_user_agent
  response_ms : $request_time × 1000

NOTE on `source`: The frozen raw_event.schema.json defines source as
  enum: ["web","auth","endpoint","network"].
  Lab events use source="web" to stay schema-compliant. The processor can
  distinguish lab vs synthetic traffic by checking the `host` field
  ("juice-shop" vs "web-01"/"web-02") or by adding a downstream feature.
"""
import json
import logging
import os
import signal
import sys
import uuid
from datetime import datetime, timezone
from urllib.parse import unquote_plus

from confluent_kafka import Consumer, Producer, KafkaError, KafkaException

# ── Config ──────────────────────────────────────────────────────────────────────
KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "redpanda:9092")
LAB_TOPIC       = os.getenv("LAB_TOPIC", "events.lab")
RAW_TOPIC       = os.getenv("RAW_TOPIC", "events.raw")
GROUP_ID        = os.getenv("NORMALIZER_GROUP_ID", "netra-lab-normalizer")
LOG_LEVEL       = os.getenv("LOG_LEVEL", "INFO")

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("lab-normalizer")

# ── Known attacker IPs → fake geo (supports account_takeover geo-faking) ──────
GEO_LOOKUP = {
    "172.30.0.10": "RU",   # attacker container 1
    "172.30.0.11": "CN",   # attacker container 2
}

# ── Helpers ─────────────────────────────────────────────────────────────────────

def msec_to_iso(msec_str: str) -> str:
    """Convert nginx $msec (epoch seconds with ms, e.g. '1696153200.123') to
    UTC ISO-8601 with millisecond precision."""
    ts = float(msec_str)
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def extract_user_from_body(body: str | None) -> str:
    """Parse the login request body and extract email/username.
    Handles both JSON and form-encoded bodies.
    ALWAYS discards the password."""
    if not body:
        return "-"
    body = body.strip()
    if not body:
        return "-"

    # Try JSON first (Juice Shop expects JSON)
    try:
        data = json.loads(body)
        return data.get("email", data.get("user", data.get("username", "-"))) or "-"
    except (json.JSONDecodeError, TypeError):
        pass

    # Try form-encoded (hydra default for http-post-form)
    try:
        pairs = {}
        for part in body.split("&"):
            if "=" in part:
                k, v = part.split("=", 1)
                pairs[unquote_plus(k)] = unquote_plus(v)
        return pairs.get("email", pairs.get("user", pairs.get("username", "-"))) or "-"
    except Exception:
        pass

    return "-"


def derive_event_type(method: str, uri: str, status: int, bytes_out: int) -> tuple[str, str]:
    """Derive (event_type, severity) from the HTTP request attributes.

    Returns values matching the frozen raw_event.schema.json enum.
    The schema allows: http_request, login, logout, data_transfer, process_start.
    """
    path_lower = uri.lower().split("?")[0] if uri else ""

    # Login endpoint
    if path_lower == "/rest/user/login" and method.upper() == "POST":
        if status == 200 or status == 302:
            return "login", "low"       # login_success
        else:
            return "login", "low"       # login_failed — severity stays low; rules decide

    # Data Exfiltration (downloads > 50 MB)
    if bytes_out > 50_000_000:
        return "data_transfer", "low"

    # Everything else is a generic HTTP request
    severity = "medium" if status >= 500 else "low"
    return "http_request", severity


def normalize_web(raw_line: str) -> dict | None:
    """Convert one nginx JSON log line to the frozen raw event schema."""
    try:
        ng = json.loads(raw_line)
    except json.JSONDecodeError:
        log.warning("Skipping unparseable nginx line: %s", raw_line[:200])
        return None

    method = ng.get("method", "GET")
    uri    = ng.get("uri", "/")
    status = int(ng.get("status", 0))
    ip     = ng.get("ip", "0.0.0.0")
    bytes_out = int(ng.get("bytes", 0))

    event_type, severity = derive_event_type(method, uri, status, bytes_out)

    # Extract user from login body if applicable
    user = "-"
    if event_type == "login":
        user = extract_user_from_body(ng.get("req_body"))

    # Convert request_time (seconds as float) to integer ms
    try:
        response_ms = int(float(ng.get("rt", 0)) * 1000)
    except (ValueError, TypeError):
        response_ms = 0

    raw_event = {
        "event_id":    str(uuid.uuid4()),
        "event_ts":    msec_to_iso(ng.get("ts", "0")),
        "source":      "web",           # schema enum: web/auth/endpoint/network
        "user":        user,
        "ip":          ip,
        "event_type":  event_type,
        "severity":    severity,
        "status":      "success" if status < 400 else "failure",
        "host":        "juice-shop",
        "bytes_out":   bytes_out,
        "process":     "",
        "method":      method,
        "path":        uri,
        "http_status": status,
        "user_agent":  ng.get("ua", ""),
        "response_ms": response_ms,
    }

    return raw_event


# ── Main loop ───────────────────────────────────────────────────────────────────

def main():
    consumer = Consumer({
        "bootstrap.servers":  KAFKA_BOOTSTRAP,
        "group.id":           GROUP_ID,
        "auto.offset.reset":  "latest",
        "enable.auto.commit": True,
    })
    producer = Producer({
        "bootstrap.servers": KAFKA_BOOTSTRAP,
        "linger.ms":         20,
    })

    consumer.subscribe([LAB_TOPIC])
    log.info("Normalizer started: %s → %s (group: %s)", LAB_TOPIC, RAW_TOPIC, GROUP_ID)

    running = True

    def stop(sig, frame):
        nonlocal running
        log.info("Shutting down (signal %s)...", sig)
        running = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    processed = 0
    errors = 0

    try:
        while running:
            msg = consumer.poll(timeout=1.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                log.error("Consumer error: %s", msg.error())
                continue

            try:
                envelope = json.loads(msg.value().decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                log.warning("Skipping bad envelope: %s", e)
                errors += 1
                continue

            kind = envelope.get("kind")
            raw_line = envelope.get("raw", "")

            if kind == "web":
                event = normalize_web(raw_line)
            elif kind == "auth":
                # Reserved for Section 16 (host-level lab)
                log.debug("Skipping auth event (not yet implemented)")
                continue
            elif kind == "cmd":
                # Reserved for Section 16 (host-level lab)
                log.debug("Skipping cmd event (not yet implemented)")
                continue
            else:
                log.warning("Unknown kind=%s, skipping", kind)
                errors += 1
                continue

            if event is None:
                errors += 1
                continue

            # Produce to events.raw, keyed by IP (same as the synthetic generator)
            value = json.dumps(event, separators=(",", ":"))
            try:
                producer.produce(
                    RAW_TOPIC,
                    key=event["ip"].encode("utf-8"),
                    value=value.encode("utf-8"),
                )
            except BufferError:
                producer.poll(1)
                producer.produce(
                    RAW_TOPIC,
                    key=event["ip"].encode("utf-8"),
                    value=value.encode("utf-8"),
                )
            producer.poll(0)

            processed += 1
            if processed % 500 == 0:
                log.info("Normalized %d events (%d errors)", processed, errors)

    except KeyboardInterrupt:
        pass
    finally:
        producer.flush(5)
        consumer.close()
        log.info("Shutdown complete. Processed %d events, %d errors.", processed, errors)


if __name__ == "__main__":
    main()
