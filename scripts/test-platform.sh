#!/bin/sh
set -eu

base="http://127.0.0.1:${SHENNONG_TEST_PORT:-18081}"
project="shennong-test-$$"
compose="${COMPOSE_COMMAND:-docker compose}"
file="docker-compose.test.yml"
admin='X-Shennong-Admin-Key: integration-test-admin-key'
json='Content-Type: application/json'

run_compose() {
  # ponytail: word splitting lets callers use COMPOSE_COMMAND='sudo docker compose'.
  $compose --project-name "$project" -f "$file" "$@"
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
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

curl --noproxy '*' --fail --silent -X PUT -H "$admin" -H "$json" \
  -d '{"id":"fixture-public","kind":"Dataset","metadata":{},"spec":{"backend":"local","operations":["expression"],"version":"test"},"status":"available","provenance":{},"permissions":{"visibility":"public","read_scopes":["resource.read"]}}' \
  "$base/api/v1/resources/fixture-public" >/dev/null
curl --noproxy '*' --fail --silent -X PUT -H "$admin" -H "$json" \
  -d '{"id":"fixture-private","kind":"Dataset","metadata":{},"spec":{},"status":"available","provenance":{},"permissions":{"visibility":"private","read_scopes":["resource.read"]}}' \
  "$base/api/v1/resources/fixture-private" >/dev/null

curl --noproxy '*' --fail --silent "$base/api/v1/resources/fixture-public" \
  | jq -e '.data.id == "fixture-public"' >/dev/null
[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$base/api/v1/resources/fixture-private")" = 404 ]

curl --noproxy '*' --fail --silent -H "$admin" -H "$json" \
  -d '{"id":"fixture-expression","resource_id":"fixture-public","uri":"/data/fixtures/expression.tsv","format":"tsv","size":29,"checksum":null,"storage_backend":"local","schema":{"role":"expression"},"provenance":{}}' \
  "$base/api/v1/resources/fixture-public/artifacts" >/dev/null
curl --noproxy '*' --fail --silent -H "$admin" -H "$json" \
  -d '{"id":"fixture-outside-root","resource_id":"fixture-public","uri":"/etc/hosts","format":"txt","size":null,"checksum":null,"storage_backend":"local","schema":{"role":"raw"},"provenance":{}}' \
  "$base/api/v1/resources/fixture-public/artifacts" >/dev/null

[ "$(curl --noproxy '*' --silent -o /dev/null -w '%{http_code}' "$base/api/v1/resources/fixture-public/artifacts/fixture-outside-root/download")" = 404 ]

curl --noproxy '*' --fail --silent -H "$json" \
  -d '{"resource":"fixture-public","operation":"expression","feature":{"type":"gene","name":"GENE1"},"options":{"limit":2}}' \
  "$base/api/v1/query" \
  | jq -e '.data.status == "success" and .data.meta.n_rows == 2 and (.data.data | length) == 2' >/dev/null

echo 'production hardening baseline: all checks passed'
