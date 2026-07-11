#!/bin/sh
set -eu

base="${1:-http://127.0.0.1:8000}"
toil='{"resource":"toil","operation":"expression","feature":{"type":"gene","name":"ENSG00000198492.14"},"options":{"limit":100}}'
pbmc='{"resource":"pbmc-3k","operation":"expression","feature":{"type":"gene","name":"YTHDF2"},"options":{"limit":100}}'

for backend in toil toil toil pbmc pbmc pbmc; do
  if [ "$backend" = toil ]; then payload="$toil"; else payload="$pbmc"; fi
  curl --noproxy '*' -fsS -o /dev/null -w "$backend %{time_total}s\n" \
    -H 'Content-Type: application/json' -d "$payload" "$base/api/v1/query"
done
