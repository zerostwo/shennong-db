# ClickHouse cache lifecycle

`shennong.expression_cache` is an acceleration layer, never the source of
truth. The migration in `docker/clickhouse/001_expression_cache.sql` partitions
by month, keys rows by `(dataset, version, feature, sample_id)`, and applies a
configurable TTL (`SHENNONG_CLICKHOUSE_CACHE_TTL_DAYS`, default 30 days).

The API bounds disk usage with `SHENNONG_CLICKHOUSE_CACHE_MAX_BYTES` (default
1 GiB). A full or unavailable cache is a miss; the query falls back to the
canonical Artifact and cache-write errors are logged without failing the main
request. A single-flight lock prevents concurrent misses from filling the
same cache simultaneously.

Administrators can inspect hit/miss counters and size:

```sh
curl -H "X-Shennong-Admin-Key: $KEY" http://127.0.0.1:8000/api/v1/cache/stats
```

Clear all cache rows or one Resource/version:

```sh
curl -X DELETE -H "X-Shennong-Admin-Key: $KEY" \
  'http://127.0.0.1:8000/api/v1/cache?resource=toil&version=2026.07'
```

ClickHouse data is disposable and is excluded from raw/canonical backup
requirements. After deletion or loss, the next canonical query rebuilds it.
