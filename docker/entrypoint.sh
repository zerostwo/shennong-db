#!/bin/sh
set -eu

export PGDATA="${PGDATA:-/var/lib/postgresql/data}"
export POSTGRES_USER="${POSTGRES_USER:-shennong}"
export POSTGRES_DB="${POSTGRES_DB:-shennong}"

if [ "$(id -u)" != 0 ]; then
  echo "shennong-entrypoint must start as root" >&2
  exit 1
fi

mkdir -p "$PGDATA" /data/resources /data/clickhouse /data/tiledb /var/log/clickhouse-server /var/lib/clickhouse
chown -R postgres:postgres "$PGDATA" /data/resources /data/clickhouse /data/tiledb /var/log/clickhouse-server /var/lib/clickhouse

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
wget -qO- --post-data='CREATE DATABASE IF NOT EXISTS shennong' http://127.0.0.1:8123/ >/dev/null
wget -qO- --post-data='CREATE TABLE IF NOT EXISTS shennong.expression_cache (dataset String, version String, feature String, sample_id String, value Float64, cached_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(cached_at) ORDER BY (dataset, version, feature, sample_id)' http://127.0.0.1:8123/ >/dev/null

for item in \
  'pbmc1k_filtered_feature_bc_matrix.h5:pbmc-1k' \
  'pbmc3k_filtered_feature_bc_matrix.h5:pbmc-3k' \
  'pbmc4k_filtered_feature_bc_matrix.h5:pbmc-4k'
do
  source_file="/data/pbmc/${item%%:*}"
  array_uri="/data/tiledb/${item#*:}"
  if [ -f "$source_file" ]; then
    gosu postgres /opt/tiledb/bin/python /app/tiledb_backend.py ingest --source "$source_file" --uri "$array_uri" >/dev/null
  fi
done

export SHENNONG_DATABASE_URL="${SHENNONG_DATABASE_URL:-postgres://${POSTGRES_USER}@127.0.0.1:5432/${POSTGRES_DB}}"
gosu postgres "$@" &
server_pid=$!

shutdown() {
  kill -TERM "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  kill -TERM "$clickhouse_pid" 2>/dev/null || true
  wait "$clickhouse_pid" 2>/dev/null || true
  gosu postgres pg_ctl -D "$PGDATA" -m fast stop
  exit 0
}
trap shutdown INT TERM

wait "$server_pid" || status=$?
kill -TERM "$clickhouse_pid" 2>/dev/null || true
wait "$clickhouse_pid" 2>/dev/null || true
gosu postgres pg_ctl -D "$PGDATA" -m fast stop
exit "${status:-0}"
