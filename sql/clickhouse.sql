CREATE DATABASE IF NOT EXISTS shennong;

CREATE TABLE IF NOT EXISTS shennong.expression_bulk
(
    dataset LowCardinality(String),
    version LowCardinality(String),
    sample_id String,
    gene_symbol LowCardinality(String),
    cancer LowCardinality(String),
    group_name LowCardinality(String),
    value Float64,
    INDEX idx_gene gene_symbol TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_sample sample_id TYPE bloom_filter(0.01) GRANULARITY 8
)
ENGINE = MergeTree
PARTITION BY (dataset, version)
ORDER BY (dataset, version, gene_symbol, cancer, sample_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS shennong.survival_events
(
    dataset LowCardinality(String),
    version LowCardinality(String),
    sample_id String,
    cancer LowCardinality(String),
    time Float64,
    event UInt8,
    group_name LowCardinality(String),
    covariates String DEFAULT '{}'
)
ENGINE = MergeTree
PARTITION BY (dataset, version)
ORDER BY (dataset, version, cancer, sample_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS shennong.eqtl_summary
(
    dataset LowCardinality(String),
    version LowCardinality(String),
    gene_symbol LowCardinality(String),
    variant_id String,
    tissue LowCardinality(String),
    phenotype LowCardinality(String),
    beta Float64,
    se Float64,
    pvalue Float64,
    qvalue Float64,
    INDEX idx_variant variant_id TYPE bloom_filter(0.01) GRANULARITY 8
)
ENGINE = MergeTree
PARTITION BY (dataset, version)
ORDER BY (dataset, version, gene_symbol, tissue, pvalue, variant_id)
SETTINGS index_granularity = 8192;
