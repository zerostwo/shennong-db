#!/bin/sh
set -eu

compose=${COMPOSE_FILE:-docker-compose.production.yml}
out=${BACKUP_DIR:-./backups/$(date -u +%Y%m%dT%H%M%SZ)}
mkdir -p "$out"
docker compose -f "$compose" exec -T postgres pg_dump -U shennong -d shennong --format=custom > "$out/shennong.dump"
if [ -n "${S3_URI:-}" ]; then
  aws s3 sync "${S3_URI%/}/raw" "$out/raw" --only-show-errors
  aws s3 sync "${S3_URI%/}/canonical" "$out/canonical" --only-show-errors
fi
find "$out" -type f -print0 | sort -z | xargs -0 sha256sum > "$out/MANIFEST.sha256"
printf '%s\n' "$out"
