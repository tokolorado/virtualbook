#!/usr/bin/env bash
set -euo pipefail

: "${CRON_BASE_URL:?Missing CRON_BASE_URL}"
: "${CRON_SECRET:?Missing CRON_SECRET}"

TICKS="${TICKS:-10}"
SLEEP_SECONDS="${SLEEP_SECONDS:-30}"
ENDPOINT="${ENDPOINT:-/api/cron/live-bsd-sync}"

BASE_URL="${CRON_BASE_URL%/}"

for i in $(seq 1 "$TICKS"); do
  echo "LIVE BSD sync tick ${i}/${TICKS} at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  curl --fail-with-body --show-error --silent --location --max-time 25 \
    -X POST "${BASE_URL}${ENDPOINT}" \
    -H "content-type: application/json" \
    -H "x-cron-secret: ${CRON_SECRET}" \
    --data '{"windowHours":6,"source":"github-actions"}'

  echo

  if [ "$i" -lt "$TICKS" ]; then
    sleep "$SLEEP_SECONDS"
  fi
done