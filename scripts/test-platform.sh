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

echo 'production hardening baseline: all checks passed'
