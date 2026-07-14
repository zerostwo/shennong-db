#!/bin/sh
set -eu

base=${SHENNONG_BASE_URL:-http://127.0.0.1:18080}
backup=${1:-}
curl --fail --silent "$base/healthz" | grep -q '"status":"ok"'
curl --fail --silent "$base/api/v1/resources" > /tmp/shennong-resources.json
if [ -n "$backup" ]; then
  (cd "$backup" && sha256sum -c MANIFEST.sha256)
fi
echo "catalog and backup checks passed"
