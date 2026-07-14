#!/bin/sh
set -eu

compose=${COMPOSE_FILE:-docker-compose.production.yml}
service=${SHENNONG_SERVICE:-shennong-db}
backup=${1:?usage: restore-production.sh BACKUP_DIR}

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
data=${SHENNONG_DATA_PATH:-./data}

[ -f "$backup/data.tar" ] || {
  echo "missing backup archive: $backup/data.tar" >&2
  exit 1
}
[ -f "$backup/MANIFEST.sha256" ] || {
  echo "missing checksum manifest" >&2
  exit 1
}
(cd "$backup" && sha256sum -c MANIFEST.sha256)

if [ -e "$data" ] && [ "${ALLOW_REPLACE:-0}" != 1 ]; then
  echo "refusing to replace existing data directory: $data" >&2
  echo "set ALLOW_REPLACE=1 after verifying the backup and target" >&2
  exit 1
fi

docker compose -f "$compose" stop "$service" >/dev/null 2>&1 || true
if [ -e "$data" ]; then
  previous="${data}.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$data" "$previous"
  echo "previous data preserved at: $previous" >&2
fi
mkdir -p "$data"
tar --acls --xattrs --numeric-owner -C "$data" -xpf "$backup/data.tar"
docker compose -f "$compose" up -d "$service"
echo "restore complete; verify health, authentication, catalog, objects, and queries"
