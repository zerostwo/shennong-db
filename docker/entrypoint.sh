#!/bin/sh
set -eu

export PGDATA="${PGDATA:-/var/lib/postgresql/data}"
export POSTGRES_USER="${POSTGRES_USER:-shennong}"
export POSTGRES_DB="${POSTGRES_DB:-shennong}"

if [ "$(id -u)" != 0 ]; then
  echo "shennong-entrypoint must start as root" >&2
  exit 1
fi

case "${SHENNONG_ROLE:-all}" in
  api|worker)
    exec gosu shennong "$@"
    ;;
  all) ;;
  *)
    echo "unsupported SHENNONG_ROLE" >&2
    exit 1
    ;;
esac

mkdir -p "$PGDATA" /data/resources /data/clickhouse /data/tiledb /data/seaweedfs /var/log/clickhouse-server /var/lib/clickhouse
chown -R postgres:postgres "$PGDATA" /data/resources /data/clickhouse /data/tiledb /data/seaweedfs /var/log/clickhouse-server /var/lib/clickhouse

secret_file=/data/.shennong-secrets
if [ ! -s "$secret_file" ]; then
  umask 077
  {
    printf 'SHENNONG_DEFAULT_ADMIN_API_KEY=%s\n' "$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64)"
    printf 'SHENNONG_DEFAULT_JWT_SECRET=%s\n' "$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64)"
  } > "$secret_file"
fi
. "$secret_file"
export SHENNONG_ADMIN_API_KEY="${SHENNONG_ADMIN_API_KEY:-$SHENNONG_DEFAULT_ADMIN_API_KEY}"
export SHENNONG_JWT_SECRET="${SHENNONG_JWT_SECRET:-$SHENNONG_DEFAULT_JWT_SECRET}"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  gosu postgres initdb -D "$PGDATA" --username="$POSTGRES_USER" --auth=trust
fi

gosu postgres pg_ctl -D "$PGDATA" -o '-c listen_addresses=127.0.0.1' -w start
if ! psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'SELECT 1' >/dev/null 2>&1; then
  gosu postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
fi

gosu postgres clickhouse-server --config-file=/etc/clickhouse-server/config.xml &
clickhouse_pid=$!
for _ in $(seq 1 60); do
  wget -qO- 'http://127.0.0.1:8123/?query=SELECT%201' >/dev/null 2>&1 && break
  sleep 1
done
cache_ttl_days="${SHENNONG_CLICKHOUSE_CACHE_TTL_DAYS:-30}"
sed "s/__TTL_DAYS__/${cache_ttl_days}/g" /app/clickhouse/001_expression_cache.sql \
  | clickhouse-client --host 127.0.0.1 --multiquery >/dev/null

gosu postgres weed server -s3 -dir=/data/seaweedfs -ip=127.0.0.1 -s3.port=8333 &
seaweed_pid=$!
for _ in $(seq 1 60); do
  wget -qO- http://127.0.0.1:8333/status >/dev/null 2>&1 && break
  sleep 1
done

export SHENNONG_DATABASE_URL="${SHENNONG_DATABASE_URL:-postgres://${POSTGRES_USER}@127.0.0.1:5432/${POSTGRES_DB}}"
gosu postgres "$@" &
server_pid=$!

shutdown() {
  kill -TERM "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  kill -TERM "$clickhouse_pid" 2>/dev/null || true
  wait "$clickhouse_pid" 2>/dev/null || true
  kill -TERM "$seaweed_pid" 2>/dev/null || true
  wait "$seaweed_pid" 2>/dev/null || true
  gosu postgres pg_ctl -D "$PGDATA" -m fast stop
  exit 0
}
trap shutdown INT TERM

wait "$server_pid" || status=$?
kill -TERM "$clickhouse_pid" 2>/dev/null || true
wait "$clickhouse_pid" 2>/dev/null || true
kill -TERM "$seaweed_pid" 2>/dev/null || true
wait "$seaweed_pid" 2>/dev/null || true
gosu postgres pg_ctl -D "$PGDATA" -m fast stop
exit "${status:-0}"
