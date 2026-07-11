#!/bin/sh
set -eu

old_compose=${OLD_COMPOSE_FILE:-docker-compose.yml}
old_service=${OLD_SERVICE:-shennong-db}
backup_dir=${BACKUP_DIR:-./migration-backup-$(date +%Y%m%d-%H%M%S)}

mkdir -p "$backup_dir/data"
echo "Exporting PostgreSQL metadata from $old_service..." >&2
docker compose -f "$old_compose" exec -T "$old_service" \
  pg_dump -U "${POSTGRES_USER:-shennong}" "${POSTGRES_DB:-shennong}" \
  > "$backup_dir/shennong.sql"
echo "Copying the legacy /data volume without deleting it..." >&2
docker compose -f "$old_compose" cp "$old_service:/data/." "$backup_dir/data/"
cat <<EOF
Backup written to: $backup_dir

Next steps (after reviewing the backup):
  1. Create the production secret files, especially database_url.
  2. Start docker-compose.production.yml.
  3. Restore metadata:
     docker compose -f docker-compose.production.yml exec -T postgres \
       psql -U shennong -d shennong < $backup_dir/shennong.sql
  4. Upload retained raw/canonical objects from $backup_dir/data to the
     configured S3 bucket, preserving their storage_uri and checksums.

The legacy deployment is left running and no source data is removed.
EOF
