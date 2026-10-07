-- Pipeline 2: events.enriched  ->  netra.events   (what the API / dashboard read)
-- Contract (README): raw fields + features (JSON string), risk_score, rule_hits (JSON array string),
-- processed_ts. ClickHouse adds stored_ts.

CREATE TABLE IF NOT EXISTS netra.events_kafka
(
    event_id      String,
    event_ts      String,
    source        String,
    user          String,
    ip            String,
    event_type    String,
    severity      String,
    status        String,
    host          String,
    bytes_out     UInt64,
    process       String,
    method        String,
    path          String,
    http_status   UInt16,
    user_agent    String,
    response_ms   UInt32,
    features      String,
    risk_score    Float32,
    rule_hits     String,
    processed_ts  String
)
ENGINE = Kafka
SETTINGS
    kafka_broker_list = 'redpanda:9092',
    kafka_topic_list = 'events.enriched',
    kafka_group_name = 'clickhouse_enriched',
    kafka_format = 'JSONEachRow',
    kafka_num_consumers = 3,
    kafka_thread_per_consumer = 1,
    kafka_flush_interval_ms = 500,
    kafka_handle_error_mode = 'stream',
    input_format_skip_unknown_fields = 1;

CREATE TABLE IF NOT EXISTS netra.events
(
    event_id      String,
    event_ts      DateTime64(3, 'UTC'),
    source        LowCardinality(String),
    user          String,
    ip            String,
    event_type    LowCardinality(String),
    severity      LowCardinality(String),
    status        LowCardinality(String),
    host          LowCardinality(String),
    bytes_out     UInt64,
    process       String,
    method        LowCardinality(String),
    path          String,
    http_status   UInt16,
    user_agent    String,
    response_ms   UInt32,
    features      String,
    risk_score    Float32,
    rule_hits     String,
    processed_ts  DateTime64(3, 'UTC'),
    stored_ts     DateTime64(3, 'UTC'),
    INDEX idx_event_id event_id TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_user     user     TYPE bloom_filter(0.01) GRANULARITY 4
)
-- Retry-safe (docs/CONCURRENCY_PLAN.md, step 4): the processor is at-least-once,
-- so a replayed event arrives again with the same event_id. ReplacingMergeTree keeps one row per
-- event_id (the latest stored_ts) once parts merge; until then, exact counts need
-- count(DISTINCT event_id) or FINAL. Duplicates are only merged within one day's partition.
ENGINE = ReplacingMergeTree(stored_ts)
PARTITION BY toDate(stored_ts)
ORDER BY (event_id)
TTL toDateTime(stored_ts) + INTERVAL 2 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS netra.events_mv TO netra.events AS
SELECT
    event_id, ts_parsed AS event_ts, source, user, ip, event_type, severity, status, host,
    bytes_out, process, method, path, http_status, user_agent, response_ms,
    features, risk_score, rule_hits, processed_parsed AS processed_ts,
    now64(3, 'UTC') AS stored_ts
FROM
(
    SELECT *,
           parseDateTime64BestEffortOrNull(event_ts, 3, 'UTC')     AS ts_parsed,
           parseDateTime64BestEffortOrNull(processed_ts, 3, 'UTC') AS processed_parsed
    FROM netra.events_kafka
    WHERE length(_error) = 0
)
WHERE ts_parsed IS NOT NULL AND processed_parsed IS NOT NULL;

CREATE MATERIALIZED VIEW IF NOT EXISTS netra.events_errors_mv TO netra.events_errors AS
SELECT
    _topic AS topic,
    _raw_message AS raw,
    if(length(_error) > 0, _error,
       concat('unparseable timestamp event_ts=', event_ts, ' processed_ts=', processed_ts, ' event_id=', event_id)) AS error
FROM netra.events_kafka
WHERE length(_error) > 0
   OR parseDateTime64BestEffortOrNull(event_ts, 3, 'UTC') IS NULL
   OR parseDateTime64BestEffortOrNull(processed_ts, 3, 'UTC') IS NULL;
