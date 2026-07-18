#!/bin/sh
set -eu

if [ "${SHENNONG_TEST_DB_PROFILE:-headless}" != headless ]; then
  echo 'test-headless-platform.sh only runs the production headless profile' >&2
  exit 2
fi
export SHENNONG_TEST_DB_PROFILE=headless
export SHENNONG_TEST_ALLOW_LEGACY_PROFILE=0
if ! command -v openssl >/dev/null 2>&1; then
  echo 'openssl is required to generate ephemeral integration credentials' >&2
  exit 2
fi
SHENNONG_TEST_SERVICE_KEY=${SHENNONG_TEST_SERVICE_KEY:-$(openssl rand -hex 32)}
SHENNONG_TEST_JWT_SECRET=${SHENNONG_TEST_JWT_SECRET:-$(openssl rand -hex 32)}
SHENNONG_TEST_AGENT_ENCRYPTION_KEY=${SHENNONG_TEST_AGENT_ENCRYPTION_KEY:-$(openssl rand -hex 32)}
wrong_service_key=$(openssl rand -hex 32)
export SHENNONG_TEST_SERVICE_KEY SHENNONG_TEST_JWT_SECRET SHENNONG_TEST_AGENT_ENCRYPTION_KEY

base="http://127.0.0.1:${SHENNONG_TEST_PORT:-18081}"
project="shennong-headless-test-$$"
compose="${COMPOSE_COMMAND:-docker compose}"
file="docker-compose.test.yml"
service_header="X-Shennong-Admin-Key: $SHENNONG_TEST_SERVICE_KEY"
wrong_service_header="X-Shennong-Admin-Key: $wrong_service_key"
json='Content-Type: application/json'
tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/shennong-headless-test.XXXXXX")

run_compose() {
  # Intentional word splitting supports COMPOSE_COMMAND='sudo docker compose'.
  $compose --project-name "$project" -f "$file" "$@"
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ]; then
    run_compose logs --no-color || true
  fi
  run_compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$tmpdir"
  exit "$status"
}
trap cleanup EXIT INT TERM

expect_code() {
  expected=$1
  method=$2
  path=$3
  shift 3
  actual=$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' \
    --request "$method" "$@" "$base$path")
  if [ "$actual" != "$expected" ]; then
    echo "expected HTTP $expected for $method $path, received $actual" >&2
    exit 1
  fi
}

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

# Health is deliberately public, while every API and discovery route is a
# service-to-service boundary in the production headless profile.
curl --noproxy '*' --fail --silent "$base/health" \
  | jq -e '.status == "ok"' >/dev/null
curl --noproxy '*' --fail --silent "$base/healthz" \
  | jq -e '.status == "ok" and .backends.postgres == "ok" and .backends.clickhouse == "ok"' >/dev/null
curl --noproxy '*' --fail --silent "$base/version" \
  | jq -e '.service == "ShennongDB" and (.version | type == "string")' >/dev/null

expect_code 401 GET /api/v1/resources
expect_code 401 GET /api/v1/resources -H "$wrong_service_header"
expect_code 401 GET /api/v1/resources -H "Authorization: Bearer $SHENNONG_TEST_SERVICE_KEY"
expect_code 401 GET /api/v1/resources -H "Cookie: shennong_session=$SHENNONG_TEST_SERVICE_KEY"
expect_code 401 GET /.well-known/shennong-agent.json
expect_code 401 GET /.well-known/shennong-agent.json -H "$wrong_service_header"
expect_code 200 GET /api/v1/resources -H "$service_header"
expect_code 200 GET /.well-known/shennong-agent.json -H "$service_header"

# A bad credential must fail before a write reaches the data plane.
expect_code 401 PUT /api/v1/resources/wrong-key-must-not-exist \
  -H "$wrong_service_header" -H "$json" \
  -d '{"id":"wrong-key-must-not-exist","kind":"Dataset","metadata":{},"spec":{},"status":"available","provenance":{}}'
expect_code 404 GET /api/v1/resources/wrong-key-must-not-exist -H "$service_header"

# These routes still exist in the compatibility binary, but the headless gate
# must hide every OS-owned or retired standalone-application surface even from
# a correctly authenticated service caller.
while IFS=' ' read -r method path; do
  expect_code 404 "$method" "$path" -H "$service_header"
done <<'EOF'
GET /api/v1/public-config
GET /api/v1/settings
GET /api/v1/auth/session
POST /api/v1/auth/register
GET /api/v1/chat/threads
GET /api/v1/memories
GET /api/v1/ai/providers
GET /api/v1/agent/skills
GET /api/v1/users
GET /api/v1/projects
POST /api/v1/research-projects
EOF

# Route methods are allowlisted as well as paths.
expect_code 404 DELETE /api/v1/resources/headless-contract-resource -H "$service_header"
expect_code 404 POST /api/v1/research-projects/headless-contract-project \
  -H "$service_header" -H "$json" -d '{}'

# Exercise the authenticated Resource/Artifact/query data plane with a private
# fixture. Headless callers are the trusted OS service, never browser users.
curl --noproxy '*' --fail --silent --request PUT \
  -H "$service_header" -H "$json" \
  -d '{"id":"headless-contract-resource","kind":"Dataset","metadata":{"name":"Headless contract fixture"},"spec":{"backend":"local","operations":["expression"],"version":"v1"},"status":"available","provenance":{"source":"ci-headless-contract"},"permissions":{"visibility":"private","read_scopes":["resource.read"]}}' \
  "$base/api/v1/resources/headless-contract-resource" \
  | jq -e '.data.id == "headless-contract-resource" and .data.permissions.visibility == "private"' >/dev/null

curl --noproxy '*' --fail --silent -H "$service_header" "$base/api/v1/resources" \
  | jq -e '.data | map(.id) | index("headless-contract-resource")' >/dev/null
curl --noproxy '*' --fail --silent -H "$service_header" \
  "$base/api/v1/resources?limit=1&offset=0" \
  | jq -e '.data | type == "array" and length == 1' >/dev/null
expect_code 422 GET '/api/v1/resources?limit=501' -H "$service_header"
expect_code 422 GET '/api/v1/resources?offset=1&cursor=2' -H "$service_header"
curl --noproxy '*' --fail --silent -H "$service_header" "$base/api/v1/providers" \
  | jq -e '.data | type == "array"' >/dev/null
curl --noproxy '*' --fail --silent -H "$service_header" "$base/api/v1/capabilities" \
  | jq -e '.data.api_version == "v1" and (.data.query_operations | index("expression"))' >/dev/null

# Resource history is a strict immutable linear chain. Validate both the HTTP
# contract and the database trigger that protects direct/concurrent writes.
expect_code 422 POST /api/v1/resources/headless-contract-resource/revisions \
  -H "$service_header" -H "$json" \
  -d '{"id":"headless-revision-1-with-parent","resource_id":"headless-contract-resource","revision":1,"parent_revision_id":"impossible-parent","metadata":{},"spec":{},"provenance":{}}'

curl --noproxy '*' --fail --silent \
  -H "$service_header" -H "$json" \
  -d '{"id":"headless-revision-1","resource_id":"headless-contract-resource","revision":1,"parent_revision_id":null,"content_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","metadata":{"stage":"raw"},"spec":{"format":"tsv"},"provenance":{"source":"ci-headless-contract"},"created_by":"os-user-contract"}' \
  "$base/api/v1/resources/headless-contract-resource/revisions" \
  | jq -e '.data.id == "headless-revision-1" and .data.revision == 1 and .data.parent_revision_id == null and .data.provenance.source == "ci-headless-contract"' >/dev/null

curl --noproxy '*' --fail --silent \
  -H "$service_header" -H "$json" \
  -d '{"id":"headless-revision-2","resource_id":"headless-contract-resource","revision":2,"parent_revision_id":"headless-revision-1","content_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","metadata":{"stage":"normalized"},"spec":{"format":"parquet"},"provenance":{"pipeline":"fixture","version":"1"},"created_by":"os-user-contract"}' \
  "$base/api/v1/resources/headless-contract-resource/revisions" \
  | jq -e '.data.id == "headless-revision-2" and .data.revision == 2 and .data.parent_revision_id == "headless-revision-1"' >/dev/null

curl --noproxy '*' --fail --silent -H "$service_header" \
  "$base/api/v1/resources/headless-contract-resource/revisions/1" \
  | jq -e '.data.id == "headless-revision-1" and .data.content_sha256 == "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' >/dev/null
curl --noproxy '*' --fail --silent -H "$service_header" \
  "$base/api/v1/resources/headless-contract-resource/revisions" \
  | jq -e '.data | map(.revision) == [2,1]' >/dev/null

expect_code 409 POST /api/v1/resources/headless-contract-resource/revisions \
  -H "$service_header" -H "$json" \
  -d '{"id":"headless-revision-gap","resource_id":"headless-contract-resource","revision":4,"parent_revision_id":"headless-revision-2","metadata":{},"spec":{},"provenance":{}}'
expect_code 422 POST /api/v1/resources/headless-contract-resource/revisions \
  -H "$service_header" -H "$json" \
  -d '{"id":"headless-revision-wrong-parent","resource_id":"headless-contract-resource","revision":3,"parent_revision_id":"headless-revision-1","metadata":{},"spec":{},"provenance":{}}'
expect_code 409 POST /api/v1/resources/headless-contract-resource/revisions \
  -H "$service_header" -H "$json" \
  -d '{"id":"headless-revision-2-duplicate","resource_id":"headless-contract-resource","revision":2,"parent_revision_id":"headless-revision-1","metadata":{},"spec":{},"provenance":{}}'
expect_code 404 PUT /api/v1/resources/headless-contract-resource/revisions/1 \
  -H "$service_header" -H "$json" -d '{}'
expect_code 404 DELETE /api/v1/resources/headless-contract-resource/revisions/1 \
  -H "$service_header"

if run_compose exec -T shennong-db psql -U shennong -d shennong -v ON_ERROR_STOP=1 \
  -c "UPDATE resource_revisions SET metadata='{\"tampered\":true}'::jsonb WHERE id='headless-revision-1'" >/dev/null 2>&1; then
  echo 'immutable Resource Revision UPDATE unexpectedly succeeded' >&2
  exit 1
fi
if run_compose exec -T shennong-db psql -U shennong -d shennong -v ON_ERROR_STOP=1 \
  -c "DELETE FROM resource_revisions WHERE id='headless-revision-1'" >/dev/null 2>&1; then
  echo 'immutable Resource Revision DELETE unexpectedly succeeded' >&2
  exit 1
fi

curl --noproxy '*' --fail --silent \
  -H "$service_header" -H "$json" \
  -d '{"id":"headless-expression","resource_id":"headless-contract-resource","uri":"/data/fixtures/expression.tsv","format":"tsv","size":29,"checksum":null,"storage_backend":"local","schema":{"role":"expression"},"provenance":{"source":"ci-headless-contract"}}' \
  "$base/api/v1/resources/headless-contract-resource/artifacts" \
  | jq -e '.data.id == "headless-expression"' >/dev/null

artifact_sha_line=$(openssl dgst -sha256 -r tests/fixtures/expression.tsv)
artifact_sha=${artifact_sha_line%% *}
curl --noproxy '*' --fail --silent \
  -H "$service_header" -H "$json" \
  -d "{\"id\":\"headless-raw-artifact\",\"resource_id\":\"headless-contract-resource\",\"uri\":\"/data/fixtures/expression.tsv\",\"format\":\"tsv\",\"size\":29,\"checksum\":\"sha256:$artifact_sha\",\"storage_backend\":\"local\",\"data_class\":\"raw\",\"immutable\":true,\"content_sha256\":\"$artifact_sha\",\"source_uri\":\"https://example.test/expression.tsv\",\"derived_from\":[],\"retention_policy\":\"retain\",\"storage_uri\":\"/data/fixtures/expression.tsv\",\"schema\":{\"role\":\"raw\"},\"provenance\":{\"source\":\"ci-headless-contract\",\"integrity_status\":\"verified\"}}" \
  "$base/api/v1/resources/headless-contract-resource/artifacts" \
  | jq -e --arg sha "$artifact_sha" '.data.id == "headless-raw-artifact" and .data.checksum == ("sha256:" + $sha) and .data.content_sha256 == $sha and .data.provenance.integrity_status == "verified"' >/dev/null

curl --noproxy '*' --fail --silent \
  -H "$service_header" -H "$json" \
  -d "{\"id\":\"headless-derived-artifact\",\"resource_id\":\"headless-contract-resource\",\"uri\":\"/data/fixtures/expression.tsv\",\"format\":\"tsv\",\"size\":29,\"checksum\":\"$artifact_sha\",\"storage_backend\":\"local\",\"data_class\":\"derived\",\"immutable\":true,\"content_sha256\":\"$artifact_sha\",\"source_uri\":\"/data/fixtures/expression.tsv\",\"derived_from\":[\"headless-raw-artifact\"],\"pipeline_version\":\"fixture-v1\",\"retention_policy\":\"retain\",\"storage_uri\":\"/data/fixtures/expression.tsv\",\"schema\":{\"role\":\"normalized\"},\"provenance\":{\"pipeline\":\"fixture\",\"version\":\"1\"}}" \
  "$base/api/v1/resources/headless-contract-resource/artifacts" \
  | jq -e '.data.id == "headless-derived-artifact" and .data.derived_from == ["headless-raw-artifact"] and .data.provenance == {"pipeline":"fixture","version":"1"}' >/dev/null

curl --noproxy '*' --fail --silent -H "$service_header" \
  "$base/api/v1/resources/headless-contract-resource/artifacts" \
  | jq -e --arg sha "$artifact_sha" '
      .data as $artifacts |
      ($artifacts | map(select(.id == "headless-raw-artifact"))[0]) as $raw |
      ($artifacts | map(select(.id == "headless-derived-artifact"))[0]) as $derived |
      $raw.content_sha256 == $sha and
      $raw.provenance.integrity_status == "verified" and
      $derived.derived_from == ["headless-raw-artifact"] and
      $derived.provenance.pipeline == "fixture"' >/dev/null

expect_code 409 POST /api/v1/resources/headless-contract-resource/artifacts \
  -H "$service_header" -H "$json" \
  -d "{\"id\":\"headless-raw-artifact\",\"resource_id\":\"headless-contract-resource\",\"uri\":\"/data/fixtures/expression.tsv\",\"format\":\"tsv\",\"size\":29,\"checksum\":\"sha256:$artifact_sha\",\"storage_backend\":\"local\",\"data_class\":\"raw\",\"immutable\":true,\"content_sha256\":\"$artifact_sha\",\"source_uri\":\"https://example.test/expression.tsv\",\"derived_from\":[],\"retention_policy\":\"retain\",\"storage_uri\":\"/data/fixtures/expression.tsv\",\"schema\":{\"role\":\"raw\"},\"provenance\":{\"source\":\"tampered\"}}"
expect_code 422 POST /api/v1/resources/headless-contract-resource/artifacts \
  -H "$service_header" -H "$json" \
  -d "{\"id\":\"headless-missing-lineage\",\"resource_id\":\"headless-contract-resource\",\"uri\":\"/data/fixtures/expression.tsv\",\"format\":\"tsv\",\"size\":29,\"checksum\":\"$artifact_sha\",\"storage_backend\":\"local\",\"data_class\":\"derived\",\"immutable\":true,\"content_sha256\":\"$artifact_sha\",\"derived_from\":[\"missing-artifact\"],\"schema\":{},\"provenance\":{}}"
expect_code 422 POST /api/v1/resources/headless-contract-resource/artifacts \
  -H "$service_header" -H "$json" \
  -d "{\"id\":\"headless-self-lineage\",\"resource_id\":\"headless-contract-resource\",\"uri\":\"/data/fixtures/expression.tsv\",\"format\":\"tsv\",\"size\":29,\"checksum\":\"$artifact_sha\",\"storage_backend\":\"local\",\"data_class\":\"derived\",\"immutable\":true,\"content_sha256\":\"$artifact_sha\",\"derived_from\":[\"headless-self-lineage\"],\"schema\":{},\"provenance\":{}}"
expect_code 422 POST /api/v1/resources/headless-contract-resource/artifacts \
  -H "$service_header" -H "$json" \
  -d "{\"id\":\"headless-invalid-lineage-shape\",\"resource_id\":\"headless-contract-resource\",\"uri\":\"/data/fixtures/expression.tsv\",\"format\":\"tsv\",\"size\":29,\"checksum\":\"$artifact_sha\",\"storage_backend\":\"local\",\"data_class\":\"derived\",\"immutable\":true,\"content_sha256\":\"$artifact_sha\",\"derived_from\":[42],\"schema\":{},\"provenance\":{}}"

curl --noproxy '*' --fail --silent \
  -H "$service_header" -H "$json" \
  -d '{"id":"headless-mutable-staging","resource_id":"headless-contract-resource","uri":"/data/fixtures/staging.tmp","format":"tmp","storage_backend":"local","data_class":"staging","immutable":false,"derived_from":[],"schema":{},"provenance":{"purpose":"staging"}}' \
  "$base/api/v1/resources/headless-contract-resource/artifacts" >/dev/null
expect_code 422 POST /api/v1/resources/headless-contract-resource/artifacts \
  -H "$service_header" -H "$json" \
  -d "{\"id\":\"headless-mutable-parent-lineage\",\"resource_id\":\"headless-contract-resource\",\"uri\":\"/data/fixtures/expression.tsv\",\"format\":\"tsv\",\"size\":29,\"checksum\":\"$artifact_sha\",\"storage_backend\":\"local\",\"data_class\":\"derived\",\"immutable\":true,\"content_sha256\":\"$artifact_sha\",\"derived_from\":[\"headless-mutable-staging\"],\"schema\":{},\"provenance\":{}}"

curl --noproxy '*' --fail --silent --request PUT \
  -H "$service_header" -H "$json" \
  -d '{"id":"headless-other-resource","kind":"Dataset","metadata":{"name":"Other project fixture"},"spec":{"backend":"local"},"status":"available","provenance":{"source":"ci-headless-contract"},"permissions":{"visibility":"private","read_scopes":["resource.read"]}}' \
  "$base/api/v1/resources/headless-other-resource" >/dev/null
curl --noproxy '*' --fail --silent \
  -H "$service_header" -H "$json" \
  -d "{\"id\":\"headless-other-raw\",\"resource_id\":\"headless-other-resource\",\"uri\":\"/data/fixtures/expression.tsv\",\"format\":\"tsv\",\"size\":29,\"checksum\":\"$artifact_sha\",\"storage_backend\":\"local\",\"data_class\":\"raw\",\"immutable\":true,\"content_sha256\":\"$artifact_sha\",\"derived_from\":[],\"schema\":{},\"provenance\":{\"source\":\"other-project\"}}" \
  "$base/api/v1/resources/headless-other-resource/artifacts" >/dev/null
curl --noproxy '*' --fail --silent \
  -H "$service_header" -H "$json" \
  -d "{\"id\":\"headless-cross-resource-lineage\",\"resource_id\":\"headless-contract-resource\",\"uri\":\"/data/fixtures/expression.tsv\",\"format\":\"tsv\",\"size\":29,\"checksum\":\"$artifact_sha\",\"storage_backend\":\"local\",\"data_class\":\"derived\",\"immutable\":true,\"content_sha256\":\"$artifact_sha\",\"derived_from\":[\"headless-other-raw\"],\"schema\":{},\"provenance\":{\"scope\":\"cross-resource\"}}" \
  "$base/api/v1/resources/headless-contract-resource/artifacts" \
  | jq -e '.data.id == "headless-cross-resource-lineage" and .data.derived_from == ["headless-other-raw"]' >/dev/null

if run_compose exec -T shennong-db psql -U shennong -d shennong -v ON_ERROR_STOP=1 \
  -c "UPDATE artifacts SET provenance='{\"tampered\":true}'::jsonb WHERE id='headless-raw-artifact'" >/dev/null 2>&1; then
  echo 'immutable Artifact UPDATE unexpectedly succeeded' >&2
  exit 1
fi
if run_compose exec -T shennong-db psql -U shennong -d shennong -v ON_ERROR_STOP=1 \
  -c "DELETE FROM artifacts WHERE id='headless-raw-artifact'" >/dev/null 2>&1; then
  echo 'immutable Artifact DELETE unexpectedly succeeded' >&2
  exit 1
fi

curl --noproxy '*' --fail --silent -H "$service_header" \
  "$base/api/v1/resources/headless-contract-resource/artifacts/headless-expression/download" \
  -o "$tmpdir/expression.tsv"
cmp tests/fixtures/expression.tsv "$tmpdir/expression.tsv"

curl --noproxy '*' --fail --silent \
  -H "$service_header" -H "$json" \
  -d '{"resource":"headless-contract-resource","operation":"expression","feature":{"type":"gene","name":"GENE1"},"options":{"limit":2}}' \
  "$base/api/v1/query" \
  | jq -e '.data.status == "success" and .data.meta.n_rows == 2 and (.data.data | length) == 2' >/dev/null

# Exercise the sole Project-shadow mutation and its namespaced graph records.
curl --noproxy '*' --fail --silent --request PUT \
  -H "$service_header" -H "$json" \
  -d '{"id":"headless-contract-project","name":"Headless contract project","description":"OS-owned project shadow","owner_user_id":"os-user-contract","visibility":"private","status":"active","metadata":{"authority":"shennong-os"}}' \
  "$base/api/v1/research-projects/headless-contract-project" \
  | jq -e '.data.id == "headless-contract-project" and .data.owner_user_id == "os-user-contract"' >/dev/null

# Project-scoped uploads accept opaque OS UUIDs only after service
# authentication. The browser/user identity and Project are never inferred
# from untrusted upload metadata.
upload_project='4f11d3f7-d145-4f75-98a8-3603e5c0e4a5'
other_project='333f3816-5a85-4ec5-91ba-3eeab31e5d4f'
upload_actor='b4a43dbf-c14b-42a6-8ee4-e9f7b3cdd6c9'
other_actor='a58ed0d3-06d1-4444-aa97-2e021aa33256'
actor_header="X-Shennong-OS-Actor-ID: $upload_actor"
project_header="X-Shennong-OS-Project-ID: $upload_project"

for scoped_project in "$upload_project" "$other_project"; do
  curl --noproxy '*' --fail --silent --request PUT \
    -H "$service_header" -H "$json" \
    -d "{\"id\":\"$scoped_project\",\"name\":\"Upload boundary fixture\",\"description\":\"OS-owned upload project\",\"owner_user_id\":\"$upload_actor\",\"visibility\":\"private\",\"status\":\"active\",\"metadata\":{\"authority\":\"shennong-os\"}}" \
    "$base/api/v1/research-projects/$scoped_project" >/dev/null
done

printf 'sample\tvalue\nS1\t1\n' >"$tmpdir/upload.tsv"
expect_code 422 POST /api/v1/uploads \
  -H "$service_header" -H 'X-Filename: upload.tsv' \
  -H 'Content-Type: text/tab-separated-values' \
  --data-binary "@$tmpdir/upload.tsv"
expect_code 422 POST /api/v1/uploads \
  -H "$service_header" -H 'X-Shennong-OS-Actor-ID: forged-user' \
  -H "$project_header" -H 'X-Filename: upload.tsv' \
  -H 'Content-Type: text/tab-separated-values' \
  --data-binary "@$tmpdir/upload.tsv"

upload_id=$(curl --noproxy '*' --fail --silent \
  -H "$service_header" -H "$actor_header" -H "$project_header" \
  -H 'X-Filename: upload.tsv' -H 'Content-Type: text/tab-separated-values' \
  --data-binary "@$tmpdir/upload.tsv" \
  "$base/api/v1/uploads" | jq -er '.data.id')

curl --noproxy '*' --fail --silent \
  -H "$service_header" -H "$actor_header" -H "$project_header" \
  "$base/api/v1/uploads" \
  | jq -e --arg upload "$upload_id" --arg project "$upload_project" \
      '.data | length == 1 and .[0].id == $upload and .[0].project_id == $project' >/dev/null

expect_code 404 POST /api/v1/uploads/register \
  -H "$service_header" -H "X-Shennong-OS-Actor-ID: $other_actor" \
  -H "$project_header" -H "$json" \
  -d "{\"upload_ids\":[\"$upload_id\"],\"resource_id\":\"forged-upload-resource\",\"name\":\"Forged upload\",\"visibility\":\"private\"}"

curl --noproxy '*' --fail --silent \
  -H "$service_header" -H "$actor_header" -H "$project_header" -H "$json" \
  -d "{\"upload_ids\":[\"$upload_id\"],\"resource_id\":\"headless-upload-resource\",\"name\":\"Headless upload fixture\",\"format\":\"tsv\",\"data_class\":\"raw\",\"visibility\":\"private\"}" \
  "$base/api/v1/uploads/register" \
  | jq -e '.data.id == "headless-upload-resource" and .data.permissions.visibility == "private"' >/dev/null

curl --noproxy '*' --fail --silent \
  -H "$service_header" -H "$actor_header" -H "$project_header" \
  "$base/api/v1/research-projects/$upload_project/context-pack" \
  | jq -e '.data.resources | map(.id) | index("headless-upload-resource")' >/dev/null

curl --noproxy '*' --fail --silent \
  -H "$service_header" -H "$actor_header" \
  -H "X-Shennong-OS-Project-ID: $other_project" \
  "$base/api/v1/uploads" | jq -e '.data | length == 0' >/dev/null

curl --noproxy '*' --fail --silent \
  -H "$service_header" -H "$json" \
  -d '{"id":"headless-contract-sample","category":"sample","kind":"biospecimen","label":"Contract sample","metadata":{"assay":"RNA-seq"},"provenance":{"source":"ci-headless-contract"}}' \
  "$base/api/v1/research-projects/headless-contract-project/entities" \
  | jq -e '.data.id == "headless-contract-sample" and .data.project_id == "headless-contract-project"' >/dev/null

curl --noproxy '*' --fail --silent --request PUT \
  -H "$service_header" \
  "$base/api/v1/research-projects/headless-contract-project/resources/headless-contract-resource" >/dev/null
curl --noproxy '*' --fail --silent --request PUT \
  -H "$service_header" \
  "$base/api/v1/research-projects/$other_project/resources/headless-other-resource" >/dev/null

curl --noproxy '*' --fail --silent -H "$service_header" \
  "$base/api/v1/research-projects/headless-contract-project/context-pack" \
  | jq -e '.data.project.id == "headless-contract-project" and (.data.entities | map(.id) | index("headless-contract-sample")) and (.data.resources | map(.id) | index("headless-contract-resource")) and ((.data.resources | map(.id) | index("headless-other-resource")) == null) and (.data.resource_revisions | map(.revision) == [2,1])' >/dev/null

curl --noproxy '*' --fail --silent -H "$service_header" \
  "$base/api/v1/research-projects/$other_project/context-pack" \
  | jq -e '.data.resources | (map(.id) | index("headless-other-resource")) and ((map(.id) | index("headless-contract-resource")) == null)' >/dev/null

artifact_project_counts=$(run_compose exec -T shennong-db psql -U shennong -d shennong -At \
  -c "SELECT COUNT(*) FILTER (WHERE b.project_id='headless-contract-project') || '|' || COUNT(*) FILTER (WHERE b.project_id='$other_project') FROM artifacts a JOIN project_resource_bindings b ON b.resource_id=a.resource_id WHERE a.id='headless-derived-artifact'")
if [ "$artifact_project_counts" != '1|0' ]; then
  echo "Artifact project isolation mismatch: $artifact_project_counts" >&2
  exit 1
fi

curl --noproxy '*' --fail --silent -H "$service_header" "$base/api/v1/audit-events" \
  | jq -e '.data | type == "array" and length > 0' >/dev/null

# The JSON limit is part of the production contract; authentication must not
# allow a request to bypass it.
truncate -s 1048577 "$tmpdir/oversized.body"
expect_code 413 POST /api/v1/query -H "$service_header" -H "$json" \
  --data-binary "@$tmpdir/oversized.body"

echo 'production headless contract: all checks passed'
