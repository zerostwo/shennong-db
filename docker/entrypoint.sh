#!/bin/sh
set -eu

export PGDATA="${PGDATA:-/var/lib/postgresql/data}"
export POSTGRES_USER="${POSTGRES_USER:-shennong}"
export POSTGRES_DB="${POSTGRES_DB:-shennong}"

if [ "$(id -u)" = 0 ]; then
  mkdir -p "$PGDATA" /data
  chown -R postgres:postgres "$PGDATA" /data
  exec gosu postgres "$0" "$@"
fi

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  initdb -D "$PGDATA" --username="$POSTGRES_USER" --auth=trust
fi

pg_ctl -D "$PGDATA" -o '-c listen_addresses=127.0.0.1' -w start
if ! psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'SELECT 1' >/dev/null 2>&1; then
  createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
fi

export SHENNONG_DATABASE_URL="${SHENNONG_DATABASE_URL:-postgres://${POSTGRES_USER}@127.0.0.1:5432/${POSTGRES_DB}}"
"$@" &
server_pid=$!

shutdown() {
  kill -TERM "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  pg_ctl -D "$PGDATA" -m fast stop
  exit 0
}
trap shutdown INT TERM

wait "$server_pid" || status=$?
pg_ctl -D "$PGDATA" -m fast stop
exit "${status:-0}"
