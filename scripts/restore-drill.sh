#!/bin/sh
set -eu

backup=${1:?usage: restore-drill.sh BACKUP_DIR}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yml} \
  ./scripts/restore-production.sh "$backup"
SHENNONG_BASE_URL=${SHENNONG_BASE_URL:-https://localhost} \
  ./scripts/verify-production.sh "$backup"
