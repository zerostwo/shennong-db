# Backup, recovery, and restore drill

PostgreSQL metadata, authentication, grants, audit events, and ingestion state
are mandatory backups. Raw objects are copied/versioned in the S3 bucket;
canonical objects are retained, while derived TileDB/index outputs are
rebuildable. ClickHouse cache is intentionally excluded.

The backup is a PostgreSQL custom-format dump plus an object copy and a single
SHA-256 manifest. It is not described as a transactionally simultaneous
`pg_dump`/`rsync`: capture time and object version IDs are recorded by the
storage provider, and production RPO/RTO must be agreed with the operator.

```sh
BACKUP_DIR=/backup/shennong/$(date -u +%Y%m%dT%H%M%SZ) \
S3_URI=s3://shennong-prod \
  ./scripts/backup-production.sh
```

Recovery order is: provision secrets and empty PostgreSQL, restore the
database dump, restore raw/canonical objects, start the API and TileDB worker,
run `verify-production.sh`, then rebuild derived artifacts and allow cache
warm-up. `restore-drill.sh` runs the same flow against a non-production stack.

Readiness (`/healthz`) checks PostgreSQL and ClickHouse without full scans;
liveness (`/health`) only checks the process. `/metrics` exposes cache hit/miss
counters and cache capacity for Prometheus. Request IDs and the existing
structured tracing output provide request correlation; ingestion failures and
checksum failures are recorded in the ingestion/audit tables.

Recommended alert thresholds are: backup manifest failure, PostgreSQL or
object-store errors, failed ingestion jobs, checksum failures, low disk space,
cache capacity saturation, worker queue timeouts, and certificates within 14
days of expiry.
