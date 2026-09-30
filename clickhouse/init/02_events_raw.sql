-- Pipeline 1: events.raw  ->  netra.events_raw
-- Independent of the processor (B), so ingest + freshness can be tested and load-tested
-- as soon as the generator runs.

-- Consumer only; stores nothing. Timestamps arrive as strings and are parsed in the MV
-- so one bad timestamp cannot stall the consumer.
CREATE TABLE IF NOT EXISTS netra.events_raw_kafka
(
    event_id     String,
    event_ts     String,
    source       String,
    user         String,
    ip           String,
    event_type   String,
    severity     String,
    status       String,
    host         String,
    bytes_out    UInt64,
    process      String,
    method       String,
    path         String,
    http_status  UInt16,
    user_agent   String,
    response_ms  UInt32
)
ENGINE = Kafka
SETTINGS
    kafka_broker_list = 'redpanda:9092',         -- internal listener (see docker-compose)
    kafka_topic_list = 'events.raw',
    kafka_group_name = 'clickhouse_raw',
    kafka_format = 'JSONEachRow',
    kafka_num_consumers = 3,                     -- topic has 3 partitions
    kafka_thread_per_consumer = 1,
    kafka_flush_interval_ms = 500,               -- default (~7.5 s) would dominate freshness
    kafka_handle_error_mode = 'stream',          -- bad messages -> events_errors, not a stalled consumer
    input_format_skip_unknown_fields = 1;        -- tolerate new fields added upstream

CREATE TABLE IF NOT EXISTS netra.events_raw
(
    event_id     String,
    event_ts     DateTime64(3, 'UTC'),
    source       LowCardinality(String),
    user         String,
    ip           String,
    event_type   LowCardinality(String),
    severity     LowCardinality(String),
    status       LowCardinality(String),
    host         LowCardinality(String),
    bytes_out    UInt64,
    process      String,
    method       LowCardinality(String),
    path         String,
    http_status  UInt16,
    user_agent   String,
    response_ms  UInt32,
    stored_ts    DateTime64(3, 'UTC'),           -- when ClickHouse wrote the row (freshness end)
    INDEX idx_event_id event_id TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_user     user     TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toDate(stored_ts)
ORDER BY (toStartOfMinute(event_ts), ip, event_ts)
TTL toDateTime(stored_ts) + INTERVAL 2 DAY;      -- demo retention; based on arrival time so replays/speed-ups are safe

CREATE MATERIALIZED VIEW IF NOT EXISTS netra.events_raw_mv TO netra.events_raw AS
SELECT
    event_id, ts_parsed AS event_ts, source, user, ip, event_type, severity, status, host,
    bytes_out, process, method, path, http_status, user_agent, response_ms,
    now64(3, 'UTC') AS stored_ts
FROM
(
    SELECT *, parseDateTime64BestEffortOrNull(event_ts, 3, 'UTC') AS ts_parsed
    FROM netra.events_raw_kafka
    WHERE length(_error) = 0
)
WHERE ts_parsed IS NOT NULL;

CREATE MATERIALIZED VIEW IF NOT EXISTS netra.events_raw_errors_mv TO netra.events_errors AS
SELECT
    _topic AS topic,
    _raw_message AS raw,
    if(length(_error) > 0, _error, concat('unparseable event_ts=', event_ts, ' event_id=', event_id)) AS error
FROM netra.events_raw_kafka
WHERE length(_error) > 0
   OR parseDateTime64BestEffortOrNull(event_ts, 3, 'UTC') IS NULL;
