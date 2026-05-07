#!/usr/bin/env bash
set -euo pipefail

: "${CRON_BASE_URL:?Missing CRON_BASE_URL}"
: "${CRON_SECRET:?Missing CRON_SECRET}"

TICKS="${LIVE_SYNC_TICKS:-10}"
SLEEP_SECONDS="${LIVE_SYNC_SLEEP_SECONDS:-30}"

for i in $(seq 1 "$TICKS"); do
  echo "LIVE BSD sync tick ${i}/${TICKS}"

  curl -fsS -X POST "${CRON_BASE_URL}/api/cron/live-bsd-sync" \
    -H "content-type: application/json" \
    -H "x-cron-secret: ${CRON_SECRET}" \
    --data '{}'

  if [ "$i" -lt "$TICKS" ]; then
    sleep "$SLEEP_SECONDS"
  fi
done