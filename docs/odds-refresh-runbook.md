# Odds Refresh Runbook

Use this when testing BSD odds ingestion and internal fallback odds after a deploy.

## Rules

- Real BSD odds are public only when `source = 'bsd'` and `pricing_method = 'bsd_market_normalized'`.
- Internal odds are public only when `source = 'internal_model'` and `pricing_method = 'internal_model_fallback'`.
- Never restore `bsd_model_derived`.
- Before testing a cron change, purge future internal model odds so old rows cannot hide the current cron output.
- Only purge real BSD odds in a controlled staging-style test, with explicit confirmation.

## Preferred Production Test Flow

1. Deploy the code.
2. Dry-run the purge for future internal model odds:

```bash
curl -X POST "$APP_URL/api/admin/odds/purge-future" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"from":"2026-05-06","to":"2026-05-27","source":"internal_model","pricingMethod":"internal_model_fallback","dryRun":true}'
```

3. If the preview is correct, delete those future internal model odds:

```bash
curl -X POST "$APP_URL/api/admin/odds/purge-future" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"from":"2026-05-06","to":"2026-05-27","source":"internal_model","pricingMethod":"internal_model_fallback","dryRun":false,"confirm":"DELETE_FUTURE_ODDS"}'
```

4. Rescan the horizon from BSD:

```bash
curl -X POST "$APP_URL/api/odds/sync" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"dateFrom":"2026-05-06","days":21,"stopOnError":false,"tz":"Europe/Warsaw"}'
```

5. Run the normal cron/sync-runner. It should:

- keep real BSD odds when BSD provides them,
- skip internal fallback for matches with real BSD odds,
- refuse fallback when inputs are too weak,
- never create repeated placeholder-like odds such as `2.35 / 4.18 / 3.71`.

## Staging-Only Full Purge

Use this only when you intentionally want to remove all future odds, including real BSD odds:

```bash
curl -X POST "$APP_URL/api/admin/odds/purge-future" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"from":"2026-05-06","to":"2026-05-27","source":"all","pricingMethod":"all","dryRun":false,"confirm":"DELETE_FUTURE_ODDS","confirmRealBsd":"YES_DELETE_REAL_BSD_ODDS"}'
```

After a full purge, immediately rescan the same date range with `/api/odds/sync`.
