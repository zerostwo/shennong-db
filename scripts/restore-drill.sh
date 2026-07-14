#!/bin/sh
set -eu

backup=${1:?usage: restore-drill.sh BACKUP_DIR}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yml} \
ALLOW_REPLACE=${ALLOW_REPLACE:-1} \
  ./scripts/restore-production.sh "$backup"
SHENNONG_BASE_URL=${SHENNONG_BASE_URL:-http://127.0.0.1:18080} \
  ./scripts/verify-production.sh "$backup"
