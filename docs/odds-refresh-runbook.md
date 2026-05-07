# Odds Refresh Runbook

Stan: 2026-05-07.

Runbook służy do testowania synchronizacji realnych kursów BSD i jawnego fallbacku modelowego po deployu.

## Reguły

- Realne kursy BSD: `source = 'bsd'`, `pricing_method = 'bsd_market_normalized'`.
- Kursy modelowe: `source = 'internal_model'`, `pricing_method = 'internal_model_fallback'`.
- Nie przywracamy `bsd_model_derived`.
- Przed testem crona można wyczyścić przyszłe kursy modelowe, żeby stare rekordy nie maskowały wyniku nowego kodu.
- Realne kursy BSD usuwamy tylko w kontrolowanym teście i po dodatkowym potwierdzeniu.

## Produkcyjny Rytm Odświeżania

Docelowo użytkownik powinien dostać nowe kursy BSD najpóźniej kilka minut po pojawieniu się ich w BSD. Aktualny kierunek:

- najbliższy horyzont: `/api/odds/sync` co około 5 minut,
- szerszy horyzont: `/api/odds/sync` co około 20 minut,
- match sync preferuje BSD v2 event odds,
- starszy endpoint BSD jest fallbackiem technicznym, gdy v2 jest niedostępne lub puste.

Obie ścieżki zapisują realne kursy tylko jako `bsd_market_normalized`.

## Standardowy Test Po Deployu

1. Deploy kodu.
2. Dry-run purga przyszłych kursów modelowych:

```bash
curl -X POST "$APP_URL/api/admin/odds/purge-future" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"from":"2026-05-06","to":"2026-05-27","source":"internal_model","pricingMethod":"internal_model_fallback","dryRun":true}'
```

3. Jeżeli preview jest poprawne, usuń tylko przyszłe kursy modelowe:

```bash
curl -X POST "$APP_URL/api/admin/odds/purge-future" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"from":"2026-05-06","to":"2026-05-27","source":"internal_model","pricingMethod":"internal_model_fallback","dryRun":false,"confirm":"DELETE_FUTURE_ODDS"}'
```

4. Przeskanuj horyzont z BSD:

```bash
curl -X POST "$APP_URL/api/odds/sync" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"dateFrom":"2026-05-06","days":21,"stopOnError":false,"tz":"Europe/Warsaw"}'
```

5. Uruchom normalny cron albo `/api/admin/sync-runner`.

Oczekiwany wynik:

- realne kursy BSD są zapisywane i widoczne,
- fallback nie uruchamia się dla rynków z realnymi BSD odds,
- fallback odmawia wyceny przy słabych danych,
- nie pojawia się stały placeholder typu `2.35 / 4.18 / 3.71`.

## Audyt

```bash
curl "$APP_URL/api/admin/odds/audit?from=2026-05-06&days=21" \
  -H "x-cron-secret: $CRON_SECRET"
```

Audit powinien pokazywać:

- brak `knownBadFallbackMatches`,
- brak `duplicatePricedRuns`,
- brak `orphanPricedRuns`,
- brak modelowych kursów dla meczów z realnymi BSD odds na tym samym rynku.

## Pełny Purge Tylko Testowo

Tego używamy tylko wtedy, gdy świadomie chcemy usunąć także realne przyszłe kursy BSD:

```bash
curl -X POST "$APP_URL/api/admin/odds/purge-future" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"from":"2026-05-06","to":"2026-05-27","source":"all","pricingMethod":"all","dryRun":false,"confirm":"DELETE_FUTURE_ODDS","confirmRealBsd":"YES_DELETE_REAL_BSD_ODDS"}'
```

Po pełnym purgu natychmiast uruchom `/api/odds/sync` dla tego samego zakresu.

## Opcjonalny Worker Realtime

BSD zapowiedziało WebSocket z ruchem kursów co minutę i pełniejszymi live stats. Worker realtime ma działać jako osobny proces, nie jako Vercel API route.

Migracja:

```sql
-- supabase/migrations/20260507_bsd_realtime_frames.sql
```

Uruchomienie:

```bash
npm run bsd:realtime
```

Wymagane env:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
BSD_REALTIME_TOKEN or BSD_API_KEY
```

Na tym etapie worker zapisuje surowe ramki `odds`, `odds_book`, `event` i `livedata` do audytu. Mapowanie realtime odds do publicznej tabeli `odds` wymaga stabilnego parsera i porównania próbek z REST v2.
