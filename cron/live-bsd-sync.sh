#!/usr/bin/env bash
set -euo pipefail

: "${CRON_BASE_URL:?Missing CRON_BASE_URL}"
: "${CRON_SECRET:?Missing CRON_SECRET}"

INTERVAL_SECONDS="${LIVE_BSD_INTERVAL_SECONDS:-15}"
MAX_RUNTIME_SECONDS="${LIVE_BSD_MAX_RUNTIME_SECONDS:-285}"
TICK_TIMEOUT_SECONDS="${LIVE_BSD_TICK_TIMEOUT_SECONDS:-28}"

started_at="$(date +%s)"
tick=1

while true; do
  now="$(date +%s)"
  elapsed=$((now - started_at))

  if [ "$elapsed" -ge "$MAX_RUNTIME_SECONDS" ]; then
    echo "LIVE BSD sync finished after ${elapsed}s"
    break
  fi

  echo "LIVE BSD sync tick ${tick}, elapsed ${elapsed}s"

  curl -fsS --max-time "$TICK_TIMEOUT_SECONDS" -X POST "${CRON_BASE_URL}/api/cron/live-bsd-sync" \
    -H "content-type: application/json" \
    -H "x-cron-secret: ${CRON_SECRET}" \
    --data '{}' \
    || echo "LIVE BSD sync tick ${tick} failed"

  tick=$((tick + 1))

  now="$(date +%s)"
  elapsed=$((now - started_at))
  remaining=$((MAX_RUNTIME_SECONDS - elapsed))

  if [ "$remaining" -le 0 ]; then
    break
  fi

  if [ "$remaining" -lt "$INTERVAL_SECONDS" ]; then
    sleep "$remaining"
  else
    sleep "$INTERVAL_SECONDS"
  fi
done