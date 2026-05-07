# VirtualBook

VirtualBook to aplikacja bukmacherska bez prawdziwych pieniędzy, z wirtualnym saldem VB. Projekt działa na Next.js App Router, React, TypeScript i Supabase. Głównym źródłem meczów, kursów, statusów, danych live i informacji meczowych jest BSD / Bzzoiro Sports.

Stan dokumentacji: 2026-05-07.

## Zasady Produktowe

- Mecze publiczne pochodzą z BSD: `matches.source = 'bsd'`.
- Realne kursy BSD są zapisywane i pokazywane wyłącznie jako `source = 'bsd'` oraz `pricing_method = 'bsd_market_normalized'`.
- Stary fallback `bsd_model_derived` jest wyłączony i nie wolno go przywracać.
- Brak kursów jest poprawnym stanem produktu. UI pokazuje wtedy: `Jeszcze nie ma kursów dla tego meczu.`
- Wewnętrzny fallback modelowy może istnieć tylko jako osobne, jawne źródło: `source = 'internal_model'` i `pricing_method = 'internal_model_fallback'`.
- Model nie nadpisuje realnych kursów BSD i musi zostawiać ślad w `internal_odds_model_runs`.
- Kupony, portfel VB, ledger i settlement muszą pozostać idempotentne.

## Stack

- Next.js App Router
- React 19
- TypeScript
- Tailwind CSS 4
- Supabase Auth, Postgres i RPC
- BSD / Bzzoiro Sports API v2 oraz WebSocket jako kierunek realtime
- SofaScore jako dodatkowe źródło mapowania i match center, gdy mapping istnieje

## Główne Funkcje

- lista meczów z kalendarzem dni meczowych,
- szczegóły meczu, kursy i rynki,
- match center z informacjami, składami, statystykami, tabelą i H2H,
- obsługa meczów live z priorytetem dla danych live,
- standardowy kupon AKO,
- Bet Builder dla jednego meczu,
- historia kuponów,
- wirtualne saldo VB i ledger,
- ranking, quizy, misje i grupy,
- panel admina,
- synchronizacja BSD, predykcji, kursów, ikon, mapowania i settlementu.

## Struktura Repozytorium

- `app/` - strony, layouty i API routes.
- `components/` - współdzielone komponenty UI.
- `lib/` - logika domenowa, Supabase, BSD, kursy, kupony i formatowanie.
- `scripts/` - lokalne narzędzia i workery.
- `supabase/migrations/` - źródło prawdy dla zmian SQL.
- `tests/` - testy TypeScript/Node.
- `docs/` - runbooki i plany rozwoju.
- `public/` - statyczne assety aplikacji.

## Najważniejsze Ścieżki UI

- `/events` - oferta meczów, kalendarz, filtry, kursy i kupon.
- `/events/[matchId]` - karta meczu, rynki, match center i szczegóły.
- `/bets` - historia kuponów.
- `/wallet` - saldo VB i ledger.
- `/account` - konto użytkownika.
- `/admin` - panel administracyjny.
- `/leaderboard` - ranking.
- `/missions` - misje.

## Najważniejsze Endpointy

Publiczne i użytkownika:

- `GET /api/events` - mecze z bazy/cache, bez ciężkiego fetcha BSD przy wejściu użytkownika.
- `GET /api/events-enabled-dates` - daty z meczami z bazy.
- `POST /api/bets` - zapis kuponu AKO albo Bet Buildera.
- `GET /api/match-center/info` - informacje meczowe z `matches`, `raw_bsd` i snapshotów.
- `GET /api/match-center/comparison` - porównanie drużyn.
- `GET /api/predictions/bsd/match-insights` - zapisane insighty i predykcje.

BSD, admin i crony:

- `GET /api/admin/bsd/leagues/sync` - synchronizacja lig BSD i ikon lig.
- `GET /api/admin/bsd/matches/sync?date=YYYY-MM-DD` - synchronizacja meczów, wyników, snapshotów i kursów BSD.
- `POST /api/odds/sync` - horyzontowa synchronizacja kursów BSD.
- `POST /api/admin/odds/purge-future` - kontrolowane czyszczenie przyszłych kursów modelowych do testów.
- `GET /api/admin/internal-odds/fallback/sync` - bezpieczny fallback modelowy dla kwalifikujących się meczów bez kursów BSD.
- `GET /api/admin/sync-runner` - główny runner administracyjny.
- `GET /api/cron/sync-runner` - wrapper cronowy.
- `GET /api/cron/settle` - settlement kuponów.

Starsze endpointy po legacy providerach są blokowane albo wygaszane. Nie powinny wracać jako źródło danych publicznych.

## Flow Danych

1. Cron albo admin sync pobiera mecze BSD.
2. Endpoint BSD sync filtruje lokalnie aktywne ligi z `provider_leagues`.
3. Dane są zapisywane w `matches`, `match_pricing_features`, `bsd_event_features` i `match_results`.
4. Kursy realne są pobierane z BSD v2 i zapisywane w `odds` jako `bsd_market_normalized`.
5. Frontend czyta bazę przez `/api/events` i endpointy match center.
6. Jeżeli BSD nie ma kursów, aplikacja może pokazać brak kursów albo, po spełnieniu guardów, jawne kursy `internal_model_fallback`.
7. Kupon przechodzi walidację w UI, API i SQL.

Klikanie po kalendarzu nie powinno wywoływać ciężkich fetchy do BSD. Daty i mecze mają pochodzić z bazy/cache.

## Kluczowe Tabele

- `matches` - mecze BSD, statusy, `raw_bsd`, identyfikatory providera.
- `odds` - realne kursy BSD i jawnie oznaczone kursy modelowe.
- `provider_leagues` - aktywne ligi providera BSD.
- `icons_leagues` - ikony lig z bazy.
- `icons_teams` - ikony drużyn z bazy.
- `match_pricing_features` - read model pricingowy meczu.
- `bsd_event_features` - cechy eventu BSD, xG, prawdopodobieństwa i live stats.
- `team_stat_snapshots` - statystyki drużynowe pod fallback i porównania.
- `event_predictions` - predykcje i insighty.
- `internal_odds_model_runs` - audyt uruchomień modelu fallback.
- `bsd_realtime_frames` - surowe ramki WebSocket BSD do audytu realtime.

## Kursy I Kupony

Realne kursy BSD mają pierwszeństwo. Model fallback:

- działa tylko, gdy BSD nie podało rynku albo nie podało kursów,
- wymaga wystarczających danych wejściowych,
- zapisuje osobne źródło i metodę pricingu,
- nie może generować identycznych placeholderów dla różnych meczów,
- musi przejść walidację zakresu kursów, prawdopodobieństw i audytu wejścia.

Szczegóły kuponów i Bet Buildera są w [docs/betting-and-odds.md](docs/betting-and-odds.md).

## Realtime BSD

BSD ogłosiło v2, ruchy kursów co minutę oraz pełniejsze live stats na WebSocket. Obecny bezpieczny kierunek:

- synchronizacja REST v2 pozostaje podstawą produkcji,
- hot sync powinien odświeżać najbliższy horyzont częściej niż długi horyzont,
- worker WebSocket zapisuje surowe ramki do audytu,
- mapowanie ramek `odds` i `odds_book` na publiczne kursy wymaga stabilnego parsera i walidacji.

Plan: [docs/bsd-v2-realtime-plan.md](docs/bsd-v2-realtime-plan.md).

## Ikony

Ikony lig i drużyn powinny pochodzić z bazy, nie z ręcznego mapowania w komponencie:

- ligi: `icons_leagues`,
- drużyny: `icons_teams`.

BSD jest preferowanym źródłem ikon, jeżeli dostarcza stabilny URL w danych ligi, drużyny albo `raw_bsd`. Stare pola `fallback_provider` i `fallback_code` po `football-data` nie powinny być używane jako logika publiczna.

## Uruchomienie Lokalnie

```bash
npm install
npm run dev
```

Aplikacja lokalnie działa zwykle pod `http://localhost:3000`.

Przydatne komendy:

```bash
npm run lint
npm test
npm run build
npm run cron:local
npm run sofascore:worker
npm run bsd:realtime
```

## Zmienne Środowiskowe

Minimalny zestaw:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
BSD_API_KEY=
CRON_SECRET=
CRON_BASE_URL=http://localhost:3000
```

Realtime BSD:

```env
BSD_REALTIME_WS_URL=
BSD_REALTIME_TOKEN=
BSD_REALTIME_POLL_MS=
BSD_REALTIME_MAX_EVENTS=
```

Nie commituj `.env.local`. Sekrety `SUPABASE_SERVICE_ROLE_KEY`, `BSD_API_KEY`, `BSD_REALTIME_TOKEN` i `CRON_SECRET` nie mogą trafić do klienta.

## Migracje SQL

Migracje w `supabase/migrations/` są źródłem prawdy dla zmian produkcyjnych. Snapshoty eksportowane z Supabase nie są już trzymane w repo.

Po zmianie funkcji `SECURITY DEFINER` sprawdź definicję w produkcji:

```sql
select
  p.proname,
  pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('place_bet', 'place_bet_builder');
```

## Operacyjne Checklisty

- Po zmianach kursów uruchom lint/build.
- Przed testem fallbacku można wyczyścić przyszłe `internal_model_fallback`, ale nie usuwać realnych kursów BSD bez wyraźnego powodu.
- Po deployu sprawdź `/api/odds/sync` dla horyzontu dni z meczami.
- Sprawdź, czy `/api/events` pokazuje realne BSD odds albo czytelny brak kursów.
- Sprawdź, czy model fallback nie generuje identycznego rozkładu dla wielu meczów.
- Sprawdź `internal_odds_model_runs` po każdej zmianie modelu.

## Kierunki Rozwoju

- dopracowanie parsera BSD WebSocket `odds`, `odds_book` i `event`,
- automatyczne zasilanie `icons_leagues` i `icons_teams` z BSD,
- rozbudowa `team_stat_snapshots`,
- lepszy model fallback odds oparty o dane drużynowe, xG, formę, absencje i venue,
- bogatsze porównanie drużyn i H2H,
- pełniejsze match center live,
- bezpieczna gamifikacja: streak, misje, quizy, sklep VB i koło nagród jako osobny etap.
