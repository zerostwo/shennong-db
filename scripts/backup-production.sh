#!/bin/sh
set -eu

compose=${COMPOSE_FILE:-docker-compose.production.yml}
service=${SHENNONG_SERVICE:-shennong-db}
out=${BACKUP_DIR:-./backups/$(date -u +%Y%m%dT%H%M%SZ)}

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
data=${SHENNONG_DATA_PATH:-./data}

if [ ! -d "$data" ]; then
  echo "data directory does not exist: $data" >&2
  exit 1
fi
if [ -e "$out" ]; then
  echo "backup destination already exists: $out" >&2
  exit 1
fi

mkdir -m 700 -p "$out"
was_running=$(docker compose -f "$compose" ps --status running -q "$service")
restart() {
  if [ -n "$was_running" ]; then
    docker compose -f "$compose" start "$service" >/dev/null
  fi
}
trap restart EXIT INT TERM

if [ -n "$was_running" ]; then
  docker compose -f "$compose" stop "$service" >/dev/null
fi

tar --acls --xattrs --numeric-owner -C "$data" -cpf "$out/data.tar" .
cp "$compose" "$out/"
if [ -f .env ]; then
  cp .env "$out/environment.env"
  chmod 600 "$out/environment.env"
fi
docker image inspect "${SHENNONG_IMAGE:-zerostwo/shennong-db:0.7.0}" \
  --format '{{json .RepoDigests}}' > "$out/image-digests.json" 2>/dev/null || true
date -u +%Y-%m-%dT%H:%M:%SZ > "$out/created-at.txt"
(cd "$out" && find . -type f ! -name MANIFEST.sha256 -print0 \
  | sort -z | xargs -0 sha256sum > MANIFEST.sha256)

trap - EXIT INT TERM
restart
printf '%s\n' "$out"
