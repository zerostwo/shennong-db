CREATE DATABASE IF NOT EXISTS shennong;

CREATE TABLE IF NOT EXISTS shennong.expression_cache
(
    dataset LowCardinality(String),
    version String,
    feature String,
    sample_id String,
    value Float64,
    cached_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(cached_at)
PARTITION BY toYYYYMM(cached_at)
ORDER BY (dataset, version, feature, sample_id)
TTL cached_at + INTERVAL __TTL_DAYS__ DAY;
