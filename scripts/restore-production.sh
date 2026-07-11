#!/bin/sh
set -eu

compose=${COMPOSE_FILE:-docker-compose.production.yml}
backup=${1:?usage: restore-production.sh BACKUP_DIR}
[ -f "$backup/shennong.dump" ]
(cd "$backup" && sha256sum -c MANIFEST.sha256)
docker compose -f "$compose" exec -T postgres dropdb -U shennong --if-exists shennong
docker compose -f "$compose" exec -T postgres createdb -U shennong shennong
docker compose -f "$compose" exec -T postgres pg_restore -U shennong -d shennong --exit-on-error < "$backup/shennong.dump"
if [ -n "${S3_URI:-}" ]; then
  aws s3 sync "$backup/raw" "${S3_URI%/}/raw" --only-show-errors
  aws s3 sync "$backup/canonical" "${S3_URI%/}/canonical" --only-show-errors
fi
echo "Restore complete; run verify-production.sh against the API."
