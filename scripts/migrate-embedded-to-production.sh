#!/bin/sh
set -eu

old_compose=${OLD_COMPOSE_FILE:-docker-compose.yml}
old_service=${OLD_SERVICE:-shennong-db}
backup_dir=${BACKUP_DIR:-./migration-backup-$(date -u +%Y%m%dT%H%M%SZ)}

echo "Current development and production Compose files use the same all-in-one /data layout." >&2
echo "Creating a consistent full backup before switching Compose files..." >&2
COMPOSE_FILE=$old_compose \
SHENNONG_SERVICE=$old_service \
BACKUP_DIR=$backup_dir \
  ./scripts/backup-production.sh

cat <<EOF
Backup written to: $backup_dir

Next steps (after reviewing the backup):
  1. Copy .env.example to .env and set independent production secrets.
  2. Point SHENNONG_DATA_PATH at the existing data directory, or restore this
     backup into the production data path with scripts/restore-production.sh.
  3. Start the current one-container deployment:
     docker compose -f docker-compose.production.yml up -d
  4. Run scripts/verify-production.sh and verify login, catalog, objects, and
     representative biological queries.

The source data is not converted or removed. The backup includes PostgreSQL,
ClickHouse, TileDB, object storage, and WebUI metadata under /data.
EOF
