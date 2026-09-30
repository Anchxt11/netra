-- Netra / ClickHouse bootstrap (runs once, on first start with an empty data volume)
CREATE DATABASE IF NOT EXISTS netra;

-- Rows that could not be ingested (malformed JSON, wrong types, unparseable timestamps)
-- from ANY Kafka table. Nothing is silently dropped: check this table first when counts look low.
CREATE TABLE IF NOT EXISTS netra.events_errors
(
    ts     DateTime64(3, 'UTC') DEFAULT now64(3, 'UTC'),
    topic  LowCardinality(String),
    raw    String,
    error  String
)
ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY ts
TTL toDateTime(ts) + INTERVAL 2 DAY;
