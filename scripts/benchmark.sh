#!/bin/sh
set -eu

base="${1:-http://127.0.0.1:8000}"
toil='{"resource":"toil","operation":"expression","feature":{"type":"gene","name":"ENSG00000198492.14"},"context":{"disease":"Skin Cutaneous Melanoma","sample_type":"Primary Tumor"},"options":{"limit":1000}}'
survival='{"resource":"toil","operation":"survival_expression","feature":{"type":"gene","name":"ENSG00000198492.14"},"context":{"disease":"Skin Cutaneous Melanoma"},"options":{"limit":1000}}'
pbmc='{"resource":"pbmc-3k","operation":"expression","feature":{"type":"gene","name":"YTHDF2"},"options":{"limit":100}}'

for backend in toil survival pbmc; do
  case "$backend" in
    toil) payload="$toil" ;;
    survival) payload="$survival" ;;
    pbmc) payload="$pbmc" ;;
  esac
  curl --noproxy '*' -fsS -o /dev/null -w "$backend %{time_total}s\n" \
    -H 'Content-Type: application/json' -d "$payload" "$base/api/v1/query"
done
