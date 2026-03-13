# VirtualBook

VirtualBook to wirtualna aplikacja bukmacherska do obstawiania zakładów piłkarskich bez prawdziwych pieniędzy.  
Projekt działa na Next.js + Supabase i obsługuje:

- listę meczów i rynków,
- kupon gracza,
- zapis zakładów do bazy,
- historię kuponów,
- automatyczną synchronizację meczów / kursów / wyników,
- automatyczne rozliczanie kuponów,
- ledger i saldo VB,
- panel admina do monitoringu, ręcznych akcji i diagnostyki.

------------------------------------------------------------------------

## Aktualny stan projektu

Projekt ma obecnie działające:

- logowanie / rejestrację,
- stronę meczów z wyborem dnia i ligi,
- dodawanie pozycji do kuponu,
- stawianie kuponów przez backend + bazę,
- historię kuponów,
- automatyczne rozliczanie wyników,
- dopisywanie wypłat do salda VB,
- ledger VB,
- panel admina,
- lokalny skrypt cron,
- zabezpieczenie endpointów operacyjnych przez `CRON_SECRET`,
- zabezpieczenie endpointów administracyjnych przez `requireAdmin`.

------------------------------------------------------------------------

## Stack technologiczny

- **Next.js (App Router)**
- **React**
- **TypeScript**
- **Tailwind CSS v4**
- **Supabase**
  - Auth
  - Postgres
  - RPC / funkcje SQL
- **football-data.org API** jako źródło danych meczowych / wyników

------------------------------------------------------------------------

## Struktura projektu

### Główne katalogi

- `app/` – routing i strony aplikacji
- `app/api/` – endpointy backendowe
- `components/` – komponenty UI
- `lib/` – helpery, auth, supabase, logika pomocnicza
- `scripts/` – narzędzia lokalne, m.in. lokalny cron
- `public/` – statyczne assety
- `app/globals.css` – globalne style aplikacji

------------------------------------------------------------------------

## Najważniejsze ścieżki aplikacji

### Frontend

- `/events` – lista meczów, dzień, ligi, ręczna synchronizacja kursów dla admina
- `/bets` – historia kuponów
- `/wallet` – saldo i historia VB
- `/account` – konto użytkownika
- `/admin` – panel administracyjny
- `/login` – logowanie
- `/register` – rejestracja
- `/leaderboard` – ranking
- `/groups` – grupy

------------------------------------------------------------------------

## Najważniejsze endpointy API

### Endpointy użytkowe

- `app/api/bets/route.ts` – postawienie kuponu
- `app/api/events/route.ts` – lista meczów
- `app/api/events-enabled-dates/route.ts` – dni z dostępnymi meczami
- `app/api/wallet/...` – dane salda / ledgera
- `app/api/users/...` – dane userów publiczne / profilowe
- `app/api/auth/...` – auth pomocniczy

### Endpointy operacyjne / cron

- `app/api/odds/sync/route.ts` – synchronizacja kursów
- `app/api/results/sync/route.ts` – synchronizacja wyników
- `app/api/ratings/update/route.ts` – aktualizacja ratingów
- `app/api/import/standings/route.ts` – import standings
- `app/api/cron/enqueue-day/route.ts` – kolejka dnia
- `app/api/cron/results/route.ts` – pobieranie wyników do rozliczeń
- `app/api/cron/settle/route.ts` – rozliczanie kuponów
- `app/api/cron/pipeline/route.ts` – pipeline operacyjny

### Endpointy administracyjne

- `app/api/admin/run-settle/route.ts`
- `app/api/admin/manual-odds-sync/route.ts`
- `app/api/admin/sync-runner/route.ts`
- `app/api/admin/settle-stats/route.ts`
- `app/api/admin/system-health-ui/route.ts`
- `app/api/admin/users/route.ts`
- `app/api/admin/send-surprise/route.ts`
- `app/api/admin/cron-logs/...`

------------------------------------------------------------------------

## Aktualny model bezpieczeństwa

### 1. Endpointy adminowe
Endpointy administracyjne są chronione przez:

- `lib/requireAdmin.ts`

To oznacza, że klient musi mieć poprawny token użytkownika admina.

### 2. Endpointy operacyjne / cron
Endpointy techniczne i synchronizacyjne są chronione przez:

- `lib/requireCronSecret.ts`

Te endpointy wymagają nagłówka:

- `x-cron-secret: <CRON_SECRET>`

### 3. Ważna zasada
Frontend **nie powinien** bezpośrednio wywoływać chronionych endpointów cronowych.  
Jeśli admin ma ręcznie uruchamiać akcję, robi to przez endpoint adminowy-proxy, np.:

- frontend → `/api/admin/manual-odds-sync`
- backend adminowy → `/api/odds/sync` z `x-cron-secret`

------------------------------------------------------------------------

## Najważniejsze pliki w `lib/`

- `lib/requireAdmin.ts` – guard admina
- `lib/requireUser.ts` – guard usera
- `lib/requireCronSecret.ts` – guard endpointów cronowych
- `lib/supabase.ts` – klient Supabase po stronie klienta
- `lib/supabaseServer.ts` – klient serwerowy / admin
- `lib/BetSlipContext.tsx` – stan kuponu
- `lib/cronLogger.ts` – logowanie operacji cronowych
- `lib/format.ts` – helpery formatowania
- `lib/date.ts` – helpery dat
- `lib/matchSync.ts` – logika synchronizacji meczów
- `lib/odds/engine-v1.ts`
- `lib/odds/engine-v2.ts`

### Uwaga
Stary legacy pakiet oddsów został usunięty:
- `lib/odds.ts`
- `lib/oddsEngine.ts`
- `lib/oddsComputeAndStore.ts`
- `lib/lambdaMvp.ts`
- `app/api/odds/route.ts`

To nie powinno już wracać jako source of truth.

------------------------------------------------------------------------

## Panel admina

Panel admina służy do:

- przeglądu użytkowników,
- dodawania VB,
- resetu salda,
- ban / unban,
- health check systemu,
- sprawdzania pozycji do rozliczenia,
- ręcznego uruchamiania auto-rozliczania,
- ręcznej synchronizacji kursów,
- wysyłania „niespodzianek” użytkownikom,
- wglądu w logi cronów i audyty.

### Ważne
Hard delete użytkownika jest **tymczasowo wyłączony**.  
Powód: wcześniejsza implementacja nie była transakcyjna i mogła zostawić bazę w niespójnym stanie.

Docelowo trzeba to zastąpić:
- bezpiecznym RPC,
- albo archiwizacją / soft-delete.

------------------------------------------------------------------------

## Automatyczne rozliczanie kuponów

System rozliczeń działa w oparciu o:

- wyniki meczów,
- statusy pozycji kuponu,
- finalne rozliczenie kuponu,
- dopisanie wypłaty do VB ledger.

### Kluczowe założenia
- rozliczenie powinno być idempotentne,
- payout nie może być dopisany drugi raz,
- ledger jest source of truth dla salda,
- rozliczenie nie powinno zależeć od UI.

------------------------------------------------------------------------

## System Health

Admin UI pokazuje obecnie m.in.:

- mecze utkwione zbyt długo w `IN_PLAY` / `PAUSED`,
- mecze zakończone, ale z nierozliczonymi `bet_items`,
- kupony `pending`, mimo że wszystkie pozycje są już settled,
- rozliczone kupony z payoutem, ale bez wpisu `BET_PAYOUT` w ledgerze.

To służy do szybkiego wykrywania niespójności operacyjnych.

------------------------------------------------------------------------

## Lokalny cron

Plik:

- `scripts/cron-local.ts`

pozwala lokalnie odpalać pipeline cykliczny.

### Założenia
- wymaga uruchomionego Next dev na `localhost:3000`
- wymaga `CRON_SECRET`
- chronione trasy dostają `x-cron-secret`

### Konfiguracja
Wykorzystywane są m.in.:

- `CRON_BASE_URL`
- `CRON_SECRET`
- `CRON_INTERVAL_MS`
- `CRON_RANGE_EVERY_N_TICKS`
- `CRON_STALE_LIMIT`
- `CRON_RANGE_LIMIT`
- `CRON_RANGE_DAYS_BACK`

------------------------------------------------------------------------

## Environment variables

Minimalnie projekt wymaga konfiguracji z `.env.local`.

Najważniejsze zmienne używane w projekcie:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
CRON_BASE_URL=http://localhost:3000
FOOTBALL_DATA_API_KEY=


------------------------------------------------------------------------


Uwaga bezpieczeństwa

.env.local nie powinien być wrzucany do zipa / backupów wysyłanych dalej

nie należy udostępniać SUPABASE_SERVICE_ROLE_KEY

CRON_SECRET nie może trafiać do klienta



------------------------------------------------------------------------


Ważne konwencje projektowe
1. Nie wywołuj endpointów cronowych z klienta

Zawsze:

klient → endpoint adminowy / użytkowy

endpoint adminowy → endpoint techniczny z sekretem

2. Ledger jest źródłem prawdy dla salda

Nie dopisujemy salda „na skróty” poza kontrolowanym flow.

3. Rozliczenia muszą być idempotentne

Każda operacja payout / settlement musi być odporna na ponowne uruchomienie.

4. Admin delete user nie może wrócić bez transakcyjnego rozwiązania

Najpierw RPC / archiwizacja, potem ewentualne usuwanie.


------------------------------------------------------------------------

Uruchamianie lokalne:

npm install
npm run dev

Lokalny cron:

npm run cron:local



------------------------------------------------------------------------

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
