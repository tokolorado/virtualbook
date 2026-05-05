# VirtualBook

VirtualBook to aplikacja bukmacherska bez prawdziwych pieniędzy, zbudowana na Next.js i Supabase. Projekt służy do przeglądania meczów piłkarskich, kursów, analiz, kuponów i wirtualnego salda VB.

Aktualnym źródłem danych meczowych, kursów i statusów jest BSD / Bzzoiro Sports. Starsze źródła typu `football-data` są wyłączone i nie powinny wracać jako źródło prawdy.

## Najważniejsze Zasady

- Mecze publicznie używane przez aplikację pochodzą z BSD: `matches.source = 'bsd'`.
- Publiczne kursy bukmacherskie mogą być pokazywane tylko z `odds.source = 'bsd'` i `odds.pricing_method = 'bsd_market_normalized'`.
- Aplikacja nie może udawać kursów realnego bukmachera, jeżeli BSD ich nie zwróciło.
- Dla meczu bez realnych kursów UI pokazuje: `Jeszcze nie ma kursów dla tego meczu.`
- `bsd_model_derived` jest wyłączone i nie powinno wracać.
- Przyszły fallback modelowy musi być jawnie oznaczony osobną metodą, np. `internal_model_fallback`, i nie może być traktowany jako kurs BSD.

## Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS v4
- Supabase Auth
- Supabase Postgres
- Supabase RPC / funkcje SQL
- BSD / Bzzoiro Sports API
- SofaScore jako dodatkowe źródło mapowania i match center, gdy mapping jest dostępny

## Główne Funkcje

- lista wydarzeń z kalendarzem dni meczowych,
- szczegóły meczu i match center,
- kursy 1X2 oraz wybrane rynki dodatkowe,
- kupon standardowy,
- Bet Builder dla jednego meczu,
- historia kuponów,
- wirtualny portfel VB i ledger,
- ranking, misje i profile użytkowników,
- panel admina,
- crony synchronizacji BSD, predykcji, mapowania i rozliczeń,
- AI prediction / insights dla kwalifikujących się meczów.

## Struktura Projektu

- `app/` - routing, strony i API routes.
- `components/` - komponenty UI.
- `lib/` - logika domenowa, Supabase, auth, odds, formatowanie.
- `scripts/` - lokalne narzędzia i workery.
- `supabase/` - migracje SQL i snapshoty funkcji.
- `tests/` - testy Node/TypeScript.
- `public/` - statyczne assety.

## Najważniejsze Ścieżki UI

- `/events` - lista meczów, kalendarz i kursy.
- `/events/[matchId]` - szczegóły meczu, rynki, informacje, porównanie i insighty.
- `/bets` - historia kuponów.
- `/wallet` - saldo VB i ledger.
- `/account` - konto użytkownika.
- `/admin` - panel administracyjny.
- `/leaderboard` - ranking.
- `/missions` - misje.

## Najważniejsze Endpointy

### Publiczne / Użytkownika

- `GET /api/events` - mecze z bazy, tylko BSD.
- `GET /api/events-enabled-dates` - dni z meczami BSD.
- `POST /api/bets` - zapis kuponu standardowego lub Bet Buildera.
- `GET /api/match-center/info` - informacje meczowe z BSD/raw snapshotów.
- `GET /api/match-center/comparison` - porównanie drużyn, forma i statystyki.
- `GET /api/predictions/bsd/match-insights` - zapisane insighty dla meczu.

### BSD / Admin

- `GET /api/admin/bsd/leagues/sync` - synchronizacja lig BSD i mapowania do `competitions`.
- `GET /api/admin/bsd/matches/sync?date=YYYY-MM-DD` - synchronizacja meczów, wyników, snapshotów i realnych kursów BSD.
- `GET /api/admin/bsd/debug/events` - diagnostyka eventów BSD.
- `GET /api/admin/sync-runner` - główny runner administracyjny.
- `GET /api/admin/internal-odds/fallback/sync` - eksperymentalny zapis jawnych kursów modelowych `internal_model_fallback` dla meczów bez BSD odds.

### Cron

- `GET /api/cron/sync-runner` - cronowy wrapper sync runnera.
- `GET /api/cron/sync-bsd-predictions` - automatyzacja predykcji BSD dla meczów z realnymi kursami.
- `GET /api/cron/settle` - rozliczanie kuponów.
- `GET /api/cron/enqueue-match-mapping` - kolejka mapowania SofaScore.
- `GET /api/cron/process-match-mapping` - przetwarzanie kolejki mapowania.
- `GET /api/cron/import-match-center-batch` - import danych match center dla zmapowanych meczów.

Niektóre stare endpointy istnieją tylko jako świadome blokady i zwracają `410 Gone`, np. `/api/matches`, `/api/fixtures`, `/api/results/sync`, `/api/standings`.

## Dane I Kursy

Podstawowy flow danych:

1. Cron lub admin uruchamia synchronizację BSD.
2. Dane są zapisywane w Supabase.
3. Frontend czyta bazę przez `/api/events` i endpointy match center.
4. Klikanie po kalendarzu nie powinno robić ciężkich fetchy do BSD.

Ważne tabele:

- `matches` - mecze, statusy, źródło BSD i `raw_bsd`.
- `odds` - kursy i metadane pricingu.
- `provider_leagues` - aktywne ligi providera.
- `competitions` - dane lig używane w UI, w tym ikony.
- `match_pricing_features` - snapshoty cech pricingowych.
- `bsd_event_features` - snapshoty cech eventów BSD.
- `event_predictions` - zapisane predykcje/insighty.
- `team_stat_snapshots` - fundament pod statystyki drużynowe.
- `internal_odds_model_runs` - log uruchomień fallback odds modelu.

## Reguły Zakładów

Warstwa aplikacji i funkcje SQL w bazie wymagają realnych kursów BSD:

```sql
source = 'bsd'
pricing_method = 'bsd_market_normalized'
coalesce(is_model, false) = false
```

Funkcje `place_bet` i `place_bet_builder` dodatkowo wymagają, aby mecz pochodził z BSD. To zabezpieczenie jest celowo zdublowane: UI daje dobry komunikat użytkownikowi, API waliduje payload, a SQL jest ostatnią granicą przed zapisem kuponu.

## Predykcje AI

Predykcje BSD są automatyzowane przez:

- `GET /api/predictions/bsd/sync`
- `GET /api/cron/sync-bsd-predictions`

Kwalifikacja meczu:

- `matches.source = 'bsd'`,
- mecz ma realne kursy `bsd_market_normalized`,
- BSD udostępnia predykcję lub dane wystarczające do zmapowania,
- rekord `event_predictions` nie istnieje albo wymaga odświeżenia.

## Match Center

Match center zbiera dane z kilku źródeł:

- `matches` i `raw_bsd`,
- `bsd_event_features`,
- `event_predictions`,
- dane SofaScore, jeśli istnieje mapping.

Zakładka informacji meczowych pokazuje m.in. stadion, lokalizację, sędziego, trenerów, rundę, sezon, pogodę i identyfikatory BSD, o ile dane są dostępne.

Zakładka porównania pokazuje ostatnie mecze, formę, gole, trendy BTTS/over, ratingi i krótkie summary.

## Uruchomienie Lokalnie

```bash
npm install
npm run dev
```

Aplikacja lokalnie działa zwykle pod:

```text
http://localhost:3000
```

Testy:

```bash
npm test
```

Build produkcyjny:

```bash
npm run build
```

Lokalny cron:

```bash
npm run cron:local
```

Worker mapowania SofaScore:

```bash
npm run sofascore:worker
```

## Zmienne Środowiskowe

Minimalny zestaw do pracy lokalnej:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
BSD_API_KEY=
CRON_SECRET=
CRON_BASE_URL=http://localhost:3000
```

Opcjonalnie używane są też:

```env
NEXT_PUBLIC_BASE_URL=
NEXT_PUBLIC_SITE_URL=
SITE_URL=
APP_URL=
VERCEL_URL=
PREFETCH_SECRET=
CRON_INTERVAL_MS=
CRON_RANGE_EVERY_N_TICKS=
CRON_STALE_LIMIT=
CRON_RANGE_LIMIT=
CRON_RANGE_DAYS_BACK=
SETTLE_BATCH_LIMIT=
SETTLE_BET_BACKFILL_LIMIT=
MAPPING_WORKER_ID=
MAPPING_BATCH_SIZE=
MAPPING_MAX_ATTEMPTS=
MAPPING_MIN_CONFIDENCE=
```

Nie commituj `.env.local`. `SUPABASE_SERVICE_ROLE_KEY`, `BSD_API_KEY` i `CRON_SECRET` nie mogą trafić do klienta.

## Migracje SQL

Migracje w `supabase/migrations/` są częścią kontraktu produkcyjnego. Szczególnie ważne:

- migracje hardeningowe funkcji SQL,
- migracje tabel BSD i predykcji,
- migracje idempotentnego rozliczania kuponów,
- migracje misji, ledgera i publicznego udostępniania kuponów.

Po zmianie funkcji `SECURITY DEFINER` warto sprawdzić definicje:

```sql
select
  p.proname,
  pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('place_bet', 'place_bet_builder');
```

## Konwencje Operacyjne

1. Endpointy cronowe nie są wywoływane bezpośrednio z klienta.
2. Admin UI używa endpointów adminowych, a backend dopiero wtedy wywołuje chronione flow.
3. Ledger VB jest źródłem prawdy dla salda.
4. Rozliczanie kuponów musi być idempotentne.
5. Brak kursów jest poprawnym stanem produktu, nie błędem do maskowania.
6. Każdy modelowy fallback kursów musi być jawnie oznaczony i oddzielony od realnych kursów BSD.

## Znane Kierunki Rozwoju

- rozbudowa `team_stat_snapshots` i danych drużynowych,
- jakościowy fallback odds model oparty o statystyki, a nie placeholdery,
- bogatszy head-to-head i porównanie drużyn,
- dalsze wzbogacanie match center o dane BSD,
- stabilniejsze pobieranie danych SofaScore tam, gdzie pojawia się `403`,
- porządkowanie starszego długu ESLint.
