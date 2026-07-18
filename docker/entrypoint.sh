#!/bin/sh
set -eu

export PGDATA="${PGDATA:-/data/postgresql}"
export POSTGRES_USER="${POSTGRES_USER:-shennong}"
export POSTGRES_DB="${POSTGRES_DB:-shennong}"

if [ "$(id -u)" != 0 ]; then
  echo "shennong-entrypoint must start as root" >&2
  exit 1
fi

case "${SHENNONG_ROLE:-all}" in
  api|worker)
    exec runuser -u shennong -- "$@"
    ;;
  all) ;;
  *)
    echo "unsupported SHENNONG_ROLE" >&2
    exit 1
    ;;
esac

mkdir -p "$PGDATA" /data/work/uploads /data/clickhouse /data/tiledb /data/objects /var/log/clickhouse-server /var/lib/clickhouse
chmod 755 /data
chown -R postgres:postgres "$PGDATA" /data/work /data/clickhouse /data/tiledb /data/objects /var/log/clickhouse-server /var/lib/clickhouse

secret_file=/data/.shennong-secrets
if [ ! -s "$secret_file" ]; then
  umask 077
  {
    printf 'SHENNONG_DEFAULT_ADMIN_API_KEY=%s\n' "$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64)"
    printf 'SHENNONG_DEFAULT_JWT_SECRET=%s\n' "$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64)"
    printf 'SHENNONG_DEFAULT_S3_SECRET=%s\n' "$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64)"
  } > "$secret_file"
fi
if ! grep -q '^SHENNONG_DEFAULT_S3_SECRET=' "$secret_file"; then
  printf 'SHENNONG_DEFAULT_S3_SECRET=%s\n' "$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64)" >> "$secret_file"
fi
. "$secret_file"
if [ -z "${SHENNONG_ADMIN_API_KEY:-}" ] && [ -z "${SHENNONG_ADMIN_API_KEY_FILE:-}" ] && [ -n "${SHENNONG_CONFIG_DIR:-}" ]; then
  SHENNONG_ADMIN_API_KEY_FILE="$SHENNONG_CONFIG_DIR/db-admin-key"
  attempts=0
  while [ ! -s "$SHENNONG_ADMIN_API_KEY_FILE" ]; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 120 ]; then
      echo "Shennong OS did not initialize $SHENNONG_ADMIN_API_KEY_FILE" >&2
      exit 1
    fi
    sleep 1
  done
  export SHENNONG_ADMIN_API_KEY_FILE
fi
if [ -n "${SHENNONG_ADMIN_API_KEY:-}" ] && [ -n "${SHENNONG_ADMIN_API_KEY_FILE:-}" ]; then
  echo "set only one of SHENNONG_ADMIN_API_KEY or SHENNONG_ADMIN_API_KEY_FILE" >&2
  exit 1
fi
if [ -n "${SHENNONG_ADMIN_API_KEY_FILE:-}" ]; then
  if [ ! -r "$SHENNONG_ADMIN_API_KEY_FILE" ]; then
    echo "cannot read SHENNONG_ADMIN_API_KEY_FILE" >&2
    exit 1
  fi
  SHENNONG_ADMIN_API_KEY="$(tr -d '\r\n' < "$SHENNONG_ADMIN_API_KEY_FILE")"
fi
export SHENNONG_ADMIN_API_KEY="${SHENNONG_ADMIN_API_KEY:-$SHENNONG_DEFAULT_ADMIN_API_KEY}"
export SHENNONG_JWT_SECRET="${SHENNONG_JWT_SECRET:-$SHENNONG_DEFAULT_JWT_SECRET}"
export AWS_ACCESS_KEY_ID=shennong
export AWS_SECRET_ACCESS_KEY="$SHENNONG_DEFAULT_S3_SECRET"
cat > /data/s3.json <<EOF
{"identities":[{"name":"shennong","credentials":[{"accessKey":"shennong","secretKey":"$SHENNONG_DEFAULT_S3_SECRET"}],"actions":["Admin","Read","Write"]}]}
EOF
chown postgres:postgres /data/s3.json
chmod 600 /data/s3.json

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  runuser -u postgres -- initdb -D "$PGDATA" --username="$POSTGRES_USER" --auth=trust
fi

runuser -u postgres -- pg_ctl -D "$PGDATA" -o '-c listen_addresses=127.0.0.1' -w start
if ! psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'SELECT 1' >/dev/null 2>&1; then
  runuser -u postgres -- createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
fi

runuser -u postgres -- clickhouse-server --config-file=/etc/clickhouse-server/config.xml &
clickhouse_pid=$!
for _ in $(seq 1 60); do
  wget -qO- 'http://127.0.0.1:8123/?query=SELECT%201' >/dev/null 2>&1 && break
  sleep 1
done
cache_ttl_days="${SHENNONG_CLICKHOUSE_CACHE_TTL_DAYS:-30}"
sed "s/__TTL_DAYS__/${cache_ttl_days}/g" /app/clickhouse/001_expression_cache.sql \
  | clickhouse-client --host 127.0.0.1 --multiquery >/dev/null

runuser -u postgres -- weed server -s3 -dir=/data/objects -ip=127.0.0.1 -s3.port=8333 -s3.config=/data/s3.json &
seaweed_pid=$!
for _ in $(seq 1 60); do
  wget -qO- http://127.0.0.1:8333/status >/dev/null 2>&1 && break
  sleep 1
done
printf 's3.bucket.create -name shennong\n' \
  | runuser -u postgres -- weed shell -master=127.0.0.1:9333 -filer=127.0.0.1:8888 >/dev/null

export SHENNONG_DATABASE_URL="${SHENNONG_DATABASE_URL:-postgres://${POSTGRES_USER}@127.0.0.1:5432/${POSTGRES_DB}}"
runuser -u postgres -- "$@" &
server_pid=$!

shutdown() {
  kill -TERM "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  kill -TERM "$clickhouse_pid" 2>/dev/null || true
  wait "$clickhouse_pid" 2>/dev/null || true
  kill -TERM "$seaweed_pid" 2>/dev/null || true
  wait "$seaweed_pid" 2>/dev/null || true
  runuser -u postgres -- pg_ctl -D "$PGDATA" -m fast stop
  exit 0
}
trap shutdown INT TERM

wait "$server_pid" || status=$?
kill -TERM "$clickhouse_pid" 2>/dev/null || true
wait "$clickhouse_pid" 2>/dev/null || true
kill -TERM "$seaweed_pid" 2>/dev/null || true
wait "$seaweed_pid" 2>/dev/null || true
runuser -u postgres -- pg_ctl -D "$PGDATA" -m fast stop
exit "${status:-0}"
