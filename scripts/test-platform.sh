#!/bin/sh
set -eu

base="http://127.0.0.1:${SHENNONG_TEST_PORT:-18081}"
project="shennong-test-$$"
compose="${COMPOSE_COMMAND:-docker compose}"
file="docker-compose.test.yml"
docker_command=$(printenv DOCKER_COMMAND 2>/dev/null || printf docker)
admin='X-Shennong-Admin-Key: integration-test-admin-key'
json='Content-Type: application/json'
tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/shennong-test.XXXXXX")
slow_pid=
query_pid=

run_compose() {
  # ponytail: word splitting lets callers use COMPOSE_COMMAND='sudo docker compose'.
  $compose --project-name "$project" -f "$file" "$@"
}

run_docker() {
  $docker_command "$@"
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ -n "$slow_pid" ]; then
    kill "$slow_pid" 2>/dev/null || true
    wait "$slow_pid" 2>/dev/null || true
  fi
  if [ -n "$query_pid" ]; then
    kill "$query_pid" 2>/dev/null || true
    wait "$query_pid" 2>/dev/null || true
  fi
  rm -rf "$tmpdir"
  if [ "$status" -ne 0 ]; then
    run_compose logs --no-color || true
  fi
  run_compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT INT TERM

run_compose config >/dev/null
if [ -z "${SHENNONG_TEST_IMAGE:-}" ]; then
  if [ "${SHENNONG_TEST_PULL:-1}" = 1 ]; then
    run_compose build --pull
  else
    run_compose build
  fi
fi
run_compose up --detach

attempt=0
until curl --noproxy '*' --fail --silent "$base/healthz" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 90 ] || exit 1
  sleep 2
done

curl --noproxy '*' --fail --silent "$base/health" \
  | jq -e '.status == "ok"' >/dev/null
curl --noproxy '*' --fail --silent "$base/healthz" \
  | jq -e '.status == "ok" and .backends.postgres == "ok" and .backends.clickhouse == "ok"' >/dev/null
curl --noproxy '*' --silent -D "$tmpdir/health.headers" -o /dev/null "$base/health"
tr -d '\r' < "$tmpdir/health.headers" | grep -qi '^x-content-type-options: nosniff$'
tr -d '\r' < "$tmpdir/health.headers" | grep -qi '^referrer-policy: no-referrer$'
tr -d '\r' < "$tmpdir/health.headers" | grep -qi '^content-security-policy:'
tr -d '\r' < "$tmpdir/health.headers" | grep -qi '^x-request-id:'
curl --noproxy '*' --silent -D "$tmpdir/request-id.headers" -o /dev/null \
  -H 'X-Request-ID: integration-request-id' "$base/health"
tr -d '\r' < "$tmpdir/request-id.headers" | grep -qi '^x-request-id: integration-request-id$'
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -X OPTIONS \
  -H 'Origin: https://allowed.example.test' -H 'Access-Control-Request-Method: GET' \
  "$base/health")" = 200 ] || [ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -X OPTIONS \
  -H 'Origin: https://allowed.example.test' -H 'Access-Control-Request-Method: GET' \
  "$base/health")" = 204 ]
curl --noproxy '*' --silent -D "$tmpdir/cors.allowed.headers" -o /dev/null -X OPTIONS \
  -H 'Origin: https://allowed.example.test' -H 'Access-Control-Request-Method: GET' \
  "$base/health"
tr -d '\r' < "$tmpdir/cors.allowed.headers" | grep -qi '^access-control-allow-origin: https://allowed.example.test$'
curl --noproxy '*' --silent -D "$tmpdir/cors.denied.headers" -o /dev/null -X OPTIONS \
  -H 'Origin: https://evil.example.test' -H 'Access-Control-Request-Method: GET' \
  "$base/health"
! tr -d '\r' < "$tmpdir/cors.denied.headers" | grep -qi '^access-control-allow-origin:'
truncate -s 1048577 "$tmpdir/oversized.body"
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -X POST \
  -H "$json" --data-binary "@$tmpdir/oversized.body" "$base/api/v1/query")" = 413 ]
curl --noproxy '*' --fail --silent "$base/api/v1/providers" \
  | jq -e '.data | all(.[]; (.files == null))' >/dev/null
curl --noproxy '*' --fail --silent -H "$admin" "$base/api/v1/providers" \
  | jq -e '.data | any(.[]; (.files != null))' >/dev/null

curl --noproxy '*' --fail --silent -X PUT -H "$admin" -H "$json" \
  -d '{"id":"fixture-public","kind":"Dataset","metadata":{},"spec":{"backend":"local","operations":["expression"],"version":"test"},"status":"available","provenance":{},"permissions":{"visibility":"public","read_scopes":["resource.read"]}}' \
  "$base/api/v1/resources/fixture-public" >/dev/null
curl --noproxy '*' --fail --silent -X PUT -H "$admin" -H "$json" \
  -d '{"id":"fixture-private","kind":"Dataset","metadata":{},"spec":{"backend":"local","operations":["expression"],"version":"test"},"status":"available","provenance":{},"permissions":{"visibility":"private","read_scopes":["resource.secret"]}}' \
  "$base/api/v1/resources/fixture-private" >/dev/null
curl --noproxy '*' --fail --silent -X PUT -H "$admin" -H "$json" \
  -d '{"id":"fixture-default","kind":"Dataset","metadata":{},"spec":{},"status":"available","provenance":{}}' \
  "$base/api/v1/resources/fixture-default" >/dev/null

curl --noproxy '*' --fail --silent "$base/api/v1/resources/fixture-public" \
  | jq -e '.data.id == "fixture-public"' >/dev/null
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$base/api/v1/resources/fixture-private")" = 404 ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$base/api/v1/resources/fixture-default")" = 404 ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -X PUT -H "$admin" -H "$json" -d '{"id":"fixture-invalid","kind":"Dataset","metadata":{},"spec":{},"status":"available","provenance":{},"permissions":{"visibility":"published","read_scopes":["resource.read"]}}' "$base/api/v1/resources/fixture-invalid")" = 422 ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -X PUT -H "$admin" -H "$json" -d '{"id":"fixture-invalid-scope","kind":"Dataset","metadata":{},"spec":{},"status":"available","provenance":{},"permissions":{"visibility":"private","read_scopes":"resource.read"}}' "$base/api/v1/resources/fixture-invalid-scope")" = 422 ]

curl --noproxy '*' --fail --silent -H "$admin" -H "$json" \
  -d '{"id":"fixture-expression","resource_id":"fixture-public","uri":"/data/fixtures/expression.tsv","format":"tsv","size":29,"checksum":null,"storage_backend":"local","schema":{"role":"expression"},"provenance":{}}' \
  "$base/api/v1/resources/fixture-public/artifacts" >/dev/null
curl --noproxy '*' --fail --silent -H "$admin" -H "$json" \
  -d '{"id":"fixture-outside-root","resource_id":"fixture-public","uri":"/etc/hosts","format":"txt","size":null,"checksum":null,"storage_backend":"local","schema":{"role":"raw"},"provenance":{}}' \
  "$base/api/v1/resources/fixture-public/artifacts" >/dev/null
curl --noproxy '*' --fail --silent -H "$admin" -H "$json" \
  -d '{"id":"fixture-private-expression","resource_id":"fixture-private","uri":"/data/fixtures/expression.tsv","format":"tsv","size":29,"checksum":null,"storage_backend":"local","schema":{"role":"expression"},"provenance":{}}' \
  "$base/api/v1/resources/fixture-private/artifacts" >/dev/null
curl --noproxy '*' --fail --silent -H "$admin" -H "$json" \
  -d '{"id":"fixture-private-gene-map","resource_id":"fixture-private","uri":"/data/fixtures/gene-map.tsv","format":"tsv","size":22,"checksum":null,"storage_backend":"local","schema":{"role":"gene_mapping"},"provenance":{}}' \
  "$base/api/v1/resources/fixture-private/artifacts" >/dev/null
curl --noproxy '*' --fail --silent -X POST -H "$admin" -H "$json" \
  -d '{"source":"fixture-private","target":"fixture-public","type":"derived_from","evidence":{},"provenance":{}}' \
  "$base/api/v1/resources/fixture-private/relations" >/dev/null

download="$base/api/v1/resources/fixture-public/artifacts/fixture-expression/download"
curl --noproxy '*' --fail --silent -D "$tmpdir/full.headers" -o "$tmpdir/full.tsv" "$download"
cmp tests/fixtures/expression.tsv "$tmpdir/full.tsv"
tr -d '\r' < "$tmpdir/full.headers" | grep -qi '^accept-ranges: bytes$'
tr -d '\r' < "$tmpdir/full.headers" | grep -qi '^content-length: 29$'
tr -d '\r' < "$tmpdir/full.headers" | grep -qi '^content-disposition: attachment; filename="expression.tsv"$'

assert_range() {
  range=$1
  skip=$2
  count=$3
  curl --noproxy '*' --fail --silent -D "$tmpdir/range.headers" -r "$range" -o "$tmpdir/range.tsv" "$download"
  dd if=tests/fixtures/expression.tsv of="$tmpdir/expected.tsv" bs=1 skip="$skip" count="$count" 2>/dev/null
  cmp "$tmpdir/expected.tsv" "$tmpdir/range.tsv"
  tr -d '\r' < "$tmpdir/range.headers" | grep -q '^HTTP/1.1 206 Partial Content$'
  tr -d '\r' < "$tmpdir/range.headers" | grep -qi "^content-range: bytes $skip-$((skip + count - 1))/29$"
}

assert_range 0-5 0 6
assert_range 9-14 9 6
assert_range 25- 25 4
[ "$(curl --noproxy '*' --silent -D "$tmpdir/invalid-range.headers" -o /dev/null -w '%{http_code}' -H 'Range: bytes=99-100' "$download")" = 416 ]
tr -d '\r' < "$tmpdir/invalid-range.headers" | grep -qi '^content-range: bytes \*/29$'

run_compose exec -T shennong-db truncate -s 67108865 /data/large-range.bin
curl --noproxy '*' --fail --silent -H "$admin" -H "$json" \
  -d '{"id":"fixture-large","resource_id":"fixture-public","uri":"/data/large-range.bin","format":"bin","size":67108865,"checksum":null,"storage_backend":"local","schema":{"role":"raw"},"provenance":{}}' \
  "$base/api/v1/resources/fixture-public/artifacts" >/dev/null
large_download="$base/api/v1/resources/fixture-public/artifacts/fixture-large/download"
curl --noproxy '*' --fail --silent -r 1048576-1048639 -o "$tmpdir/large-range.bin" "$large_download"
[ "$(wc -c < "$tmpdir/large-range.bin" | tr -d ' ')" = 64 ]

curl --noproxy '*' --fail --silent --limit-rate 1K -D "$tmpdir/slow.headers" -o "$tmpdir/slow.bin" "$large_download" &
slow_pid=$!
attempt=0
until [ -s "$tmpdir/slow.headers" ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 50 ] || exit 1
  sleep 1
done
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$large_download")" = 429 ]
kill "$slow_pid"
wait "$slow_pid" 2>/dev/null || true
slow_pid=
curl --noproxy '*' --fail --silent "$base/healthz" | jq -e '.status == "ok"' >/dev/null

[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$base/api/v1/resources/fixture-public/artifacts/fixture-outside-root/download")" = 404 ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$base/api/v1/resources/fixture-private/artifacts")" = 404 ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$base/api/v1/resources/fixture-private/relations")" = 404 ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$base/api/v1/resources/fixture-private/artifacts/fixture-private-expression/download")" = 404 ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$base/api/v1/agent/resources/fixture-private")" = 404 ]
curl --noproxy '*' --fail --silent "$base/api/v1/resources" \
  | jq -e '(.data | map(.id) | index("fixture-public")) and ((.data | map(.id) | index("fixture-private")) | not) and ((.data | map(.id) | index("fixture-default")) | not)' >/dev/null
curl --noproxy '*' --fail --silent "$base/.well-known/shennong-agent.json" \
  | jq -e '((.resources | map(.id) | index("fixture-private")) | not)' >/dev/null
curl --noproxy '*' --fail --silent "$base/api/v1/genes/resolve?q=GENE1&resources=fixture-private" \
  | jq -e '.data.status == "missing" and (.data.matches | length) == 0' >/dev/null
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -H "$json" -d '{"resource":"fixture-private","operation":"expression","feature":{"type":"gene","name":"GENE1"},"options":{"limit":2}}' "$base/api/v1/query")" = 404 ]

for user in reader-no-grant reader-bad-scope reader-good-scope reader-disabled reader-admin; do
  role=user
  [ "$user" = reader-admin ] && role=admin
  curl --noproxy '*' --fail --silent -X PUT -H "$admin" -H "$json" \
    -d "{\"id\":\"$user\",\"display_name\":\"$user\",\"email\":\"$user@example.test\",\"role\":\"$role\",\"status\":\"active\"}" \
    "$base/api/v1/users/$user" >/dev/null
done

no_grant_token=$(curl --noproxy '*' --fail --silent -H "$admin" -H "$json" -d '{"expires_in":3600,"scopes":["resource.secret"]}' "$base/api/v1/users/reader-no-grant/tokens" | jq -r '.data.token')
bad_scope_token=$(curl --noproxy '*' --fail --silent -H "$admin" -H "$json" -d '{"expires_in":3600,"scopes":["resource.read"]}' "$base/api/v1/users/reader-bad-scope/tokens" | jq -r '.data.token')
good_scope_token=$(curl --noproxy '*' --fail --silent -H "$admin" -H "$json" -d '{"expires_in":3600,"scopes":["resource.secret"]}' "$base/api/v1/users/reader-good-scope/tokens" | jq -r '.data.token')
disabled_token=$(curl --noproxy '*' --fail --silent -H "$admin" -H "$json" -d '{"expires_in":3600,"scopes":["resource.secret"]}' "$base/api/v1/users/reader-disabled/tokens" | jq -r '.data.token')
admin_token=$(curl --noproxy '*' --fail --silent -H "$admin" -H "$json" -d '{"expires_in":3600,"scopes":["resource.read"]}' "$base/api/v1/users/reader-admin/tokens" | jq -r '.data.token')

for user in reader-bad-scope reader-good-scope reader-disabled; do
  curl --noproxy '*' --fail --silent -X PUT -H "$admin" "$base/api/v1/resources/fixture-private/grants/$user" >/dev/null
done

[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $no_grant_token" "$base/api/v1/resources/fixture-private")" = 404 ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $bad_scope_token" "$base/api/v1/resources/fixture-private")" = 404 ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $good_scope_token" "$base/api/v1/resources/fixture-private")" = 200 ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $admin_token" "$base/api/v1/resources/fixture-private")" = 200 ]
curl --noproxy '*' --fail --silent -H "Authorization: Bearer $good_scope_token" "$base/api/v1/resources" \
  | jq -e '(.data | map(.id) | index("fixture-private"))' >/dev/null
curl --noproxy '*' --fail --silent -H "Authorization: Bearer $good_scope_token" "$base/api/v1/resources/fixture-private/artifacts" \
  | jq -e '.data | map(.id) | index("fixture-private-expression")' >/dev/null
curl --noproxy '*' --fail --silent -H "Authorization: Bearer $good_scope_token" "$base/api/v1/resources/fixture-private/relations" \
  | jq -e '.data | length == 1' >/dev/null
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $good_scope_token" "$base/api/v1/resources/fixture-private/artifacts/fixture-private-expression/download")" = 200 ]
curl --noproxy '*' --fail --silent -H "Authorization: Bearer $good_scope_token" "$base/api/v1/agent/resources/fixture-private" \
  | jq -e '.resource.id == "fixture-private"' >/dev/null
curl --noproxy '*' --fail --silent -H "Authorization: Bearer $good_scope_token" "$base/.well-known/shennong-agent.json" \
  | jq -e '(.resources | map(.id) | index("fixture-private"))' >/dev/null
curl --noproxy '*' --fail --silent -H "Authorization: Bearer $good_scope_token" "$base/api/v1/genes/resolve?q=GENE1&resources=fixture-private" \
  | jq -e '.data.status == "resolved" and (.data.matches | length) == 1' >/dev/null
curl --noproxy '*' --fail --silent -H "Authorization: Bearer $good_scope_token" -H "$json" \
  -d '{"resource":"fixture-private","operation":"expression","feature":{"type":"gene","name":"GENE1"},"options":{"limit":2}}' \
  "$base/api/v1/query" \
  | jq -e '.data.status == "success" and .data.meta.n_rows == 2' >/dev/null
curl --noproxy '*' --fail --silent -X PUT -H "$admin" -H "$json" \
  -d '{"id":"reader-disabled","display_name":"reader-disabled","email":"reader-disabled@example.test","role":"user","status":"disabled"}' \
  "$base/api/v1/users/reader-disabled" >/dev/null
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $disabled_token" "$base/api/v1/resources/fixture-private")" = 404 ]

curl --noproxy '*' --fail --silent -H "$json" \
  -d '{"resource":"fixture-public","operation":"expression","feature":{"type":"gene","name":"GENE1"},"options":{"limit":2}}' \
  "$base/api/v1/query" \
  | jq -e '.data.status == "success" and .data.meta.n_rows == 2 and (.data.data | length) == 2' >/dev/null

put_tiledb_resource() {
  id=$1
  uri=$2
  curl --noproxy '*' --fail --silent -X PUT -H "$admin" -H "$json" \
    -d "{\"id\":\"$id\",\"kind\":\"Dataset\",\"metadata\":{},\"spec\":{\"backend\":\"tiledb\",\"array_uri\":\"$uri\",\"operations\":[\"expression\"]},\"status\":\"available\",\"provenance\":{},\"permissions\":{\"visibility\":\"public\",\"read_scopes\":[\"resource.read\"]}}" \
    "$base/api/v1/resources/$id" >/dev/null
}

query_tiledb() {
  id=$1
  shift
  curl --noproxy '*' --silent -H "$json" \
    -d "{\"resource\":\"$id\",\"operation\":\"expression\",\"feature\":{\"type\":\"gene\",\"name\":\"YTHDF2\"}}" \
    "$@" "$base/api/v1/query"
}

assert_backend_error() {
  id=$1
  status=$2
  code=$3
  actual=$(query_tiledb "$id" -o "$tmpdir/$id.json" -w '%{http_code}')
  [ "$actual" = "$status" ]
  jq -e --arg code "$code" '.code == $code and (.request_id | type == "string")' "$tmpdir/$id.json" >/dev/null
  ! rg -q '/data|Traceback|python' "$tmpdir/$id.json"
}

put_tiledb_resource fixture-tiledb-normal normal
put_tiledb_resource fixture-tiledb-sleep sleep
put_tiledb_resource fixture-tiledb-exit exit
put_tiledb_resource fixture-tiledb-stdout stdout
put_tiledb_resource fixture-tiledb-stderr stderr
query_tiledb fixture-tiledb-normal --fail | jq -e '.data.status == "success"' >/dev/null
curl --noproxy '*' --fail --silent "$base/api/v1/genes/resolve?q=YTHDF2&resources=fixture-tiledb-normal" \
  | jq -e '.data.status == "missing"' >/dev/null
assert_backend_error fixture-tiledb-sleep 504 query_backend_timeout
assert_backend_error fixture-tiledb-exit 422 query_backend_failed
assert_backend_error fixture-tiledb-stdout 422 query_backend_failed
assert_backend_error fixture-tiledb-stderr 422 query_backend_failed

query_tiledb fixture-tiledb-sleep -o "$tmpdir/tiledb-slow.json" &
query_pid=$!
sleep 0.2
[ "$(query_tiledb fixture-tiledb-normal -o /dev/null -w '%{http_code}')" = 429 ]
wait "$query_pid" 2>/dev/null || true
query_pid=

curl --noproxy '*' --fail --silent -X PUT -H "$admin" -H "$json" \
  -d '{"id":"fixture-registered","kind":"Dataset","metadata":{},"spec":{"backend":"local","operations":["expression"]},"status":"registered","provenance":{},"permissions":{"visibility":"public","read_scopes":["resource.read"]}}' \
  "$base/api/v1/resources/fixture-registered" >/dev/null
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -H "$json" -d '{"resource":"fixture-registered","operation":"expression","feature":{"type":"gene","name":"GENE1"}}' "$base/api/v1/query")" = 404 ]

database_url='postgres://shennong@127.0.0.1:5432/shennong'
run_compose exec -T -e "SHENNONG_DATABASE_URL=$database_url" shennong-db shennong-cli import /data/fixtures/import-success.json >/dev/null
curl --noproxy '*' --fail --silent "$base/api/v1/resources/atomic-success" \
  | jq -e '.data.status == "available"' >/dev/null
curl --noproxy '*' --fail --silent "$base/api/v1/resources/atomic-success/artifacts" \
  | jq -e '.data | length == 1 and .[0].id == "atomic-success-expression"' >/dev/null
if run_compose exec -T -e "SHENNONG_DATABASE_URL=$database_url" shennong-db shennong-cli import /data/fixtures/import-failure.json >/dev/null 2>&1; then
  exit 1
fi
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$base/api/v1/resources/atomic-failure")" = 404 ]
if run_compose exec -T -e "SHENNONG_DATABASE_URL=$database_url" shennong-db shennong-cli import /data/fixtures/import-missing-local.json >/dev/null 2>&1; then
  exit 1
fi
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$base/api/v1/resources/atomic-missing-local")" = 404 ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -H "$admin" -H "$json" -d '{"name":"bad-second"}' "$base/api/v1/resources/install")" = 422 ]
container_id=$(run_compose ps -q shennong-db)
run_docker exec "$container_id" psql -U shennong -d shennong -A -t -c "SELECT status FROM ingestion_jobs WHERE provider_name = 'bad-second'" > "$tmpdir/bad-second.status"
[ "$(tr -d '\r\n' < "$tmpdir/bad-second.status")" = failed ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$base/api/v1/resources/bad-second")" = 404 ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -H "$admin" -H "$json" -d '{"name":"bad-materialization"}' "$base/api/v1/resources/install")" = 422 ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$base/api/v1/resources/bad-materialization")" = 404 ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -H "$admin" -H "$json" -d '{"name":"missing-checksum"}' "$base/api/v1/resources/install")" = 422 ]
[ "$(run_docker exec "$container_id" psql -U shennong -d shennong -A -t -c "SELECT status || ':' || error_code FROM ingestion_jobs WHERE provider_name = 'missing-checksum'" | tr -d '\r\n')" = "failed:provider_integrity_required" ]
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$base/api/v1/resources/missing-checksum")" = 404 ]
run_docker exec "$container_id" psql -U shennong -d shennong -c "UPDATE ingestion_jobs SET status = 'downloading' WHERE provider_name = 'bad-second'" >/dev/null
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' -H "$admin" -H "$json" -d '{"name":"bad-second"}' "$base/api/v1/resources/install")" = 422 ]
run_compose exec -T -e "SHENNONG_DATABASE_URL=$database_url" shennong-db shennong-cli import /app/seed/toil-pbmc.json >/dev/null
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$base/api/v1/resources/toil")" = 404 ]
run_compose restart shennong-db >/dev/null
attempt=0
until curl --noproxy '*' --fail --silent "$base/healthz" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 90 ] || exit 1
  sleep 2
done
curl --noproxy '*' --fail --silent "$base/api/v1/resources/atomic-success/artifacts" \
  | jq -e '.data | length == 1 and .[0].id == "atomic-success-expression"' >/dev/null

rate_status=
for _ in $(seq 1 25); do
  code=$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' \
    -H 'X-Forwarded-For: 198.51.100.77' -H "$json" \
    -d '{"resource":"fixture-public","operation":"expression","feature":{"type":"gene","name":"GENE1"},"options":{"limit":1}}' \
    "$base/api/v1/query")
  if [ "$code" = 429 ]; then
    rate_status=429
    break
  fi
done
[ "$rate_status" = 429 ]

echo 'production hardening baseline: all checks passed'
