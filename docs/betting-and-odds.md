# Kursy I Kupony

Stan: 2026-05-07.

Dokument opisuje aktualną logikę kuponów, kursów i Bet Buildera.

## Tryby Kuponu

VirtualBook ma dwa tryby:

- AKO - klasyczny kupon akumulatorowy, maksymalnie jeden typ z jednego meczu.
- Bet Builder - wiele typów z jednego meczu wycenianych jako jeden skorelowany pakiet.

Rozdzielenie jest celowe. Typy z jednego meczu są zależne od siebie i nie wolno ich naiwnie mnożyć jak niezależnych zdarzeń.

## Źródła Kursów

Realne kursy BSD:

```sql
source = 'bsd'
pricing_method = 'bsd_market_normalized'
```

Jawny fallback modelowy:

```sql
source = 'internal_model'
pricing_method = 'internal_model_fallback'
```

Stary `bsd_model_derived` jest zabroniony.

## Standardowe AKO

AKO przyjmuje maksymalnie jeden typ z jednego `match_id`.

Kurs łączny:

```text
kurs_laczny = kurs_1 * kurs_2 * kurs_3 * ...
```

SQL liczy to stabilniej:

```sql
round(exp(sum(ln(odds::float8)))::numeric, 2)
```

Warunki zapisu:

- każda pozycja jest z innego meczu,
- mecz istnieje i pochodzi z BSD,
- mecz jest otwarty do obstawiania,
- kickoff jest w przyszłości,
- status meczu jest dopuszczony do gry,
- kurs istnieje i przeszedł walidację,
- użytkownik ma wystarczające saldo VB,
- request jest idempotentny przez `client_request_id`.

## Bet Builder

Bet Builder obsługuje 2-8 typów z jednego meczu. Nie zapisuje kursu jako naiwnego iloczynu kursów pozycji.

Flow:

1. Frontend wysyła propozycję do `/api/bet-builder/quote`.
2. Backend pobiera aktualne kursy z `public.odds`.
3. Silnik Bet Buildera liczy jeden kurs pakietu.
4. Przy zapisie `/api/bets` liczy pakiet ponownie po stronie serwera.
5. Zapis idzie przez RPC `public.place_bet_builder`.

Najważniejsza zasada: Bet Builder wypłaca z `bets.total_odds`, a nie z iloczynu `bet_items.odds`.

## Fallback Modelowy

Fallback może zostać użyty tylko, gdy:

- BSD nie podało realnych kursów dla danego rynku albo meczu,
- istnieją wystarczające dane wejściowe,
- wynik przechodzi guardy jakości,
- kursy są jawnie oznaczone jako modelowe,
- run zapisuje audyt w `internal_odds_model_runs`.

Jeżeli warunki nie są spełnione, UI pokazuje:

```text
Jeszcze nie ma kursów dla tego meczu.
```

## Rozliczanie

AKO:

- dowolna pozycja `lost` przegrywa kupon,
- `void` nie podbija kursu,
- wszystkie pozycje `void` zwracają stawkę,
- wygrany kupon wypłaca `stake * effective_odds`.

Bet Builder:

- dowolna pozycja `lost` przegrywa pakiet,
- dowolna pozycja `void` voiduje cały Bet Builder,
- wszystkie pozycje `won` wypłacają `stake * bets.total_odds`.

Wszystkie wypłaty i zwroty przechodzą przez ledger VB. Settlement musi sprawdzać, czy dla danego `bet_id` nie istnieje już `BET_PAYOUT` albo `BET_REFUND`.

## Publiczne Kupony

Właściciel kuponu może utworzyć publiczny link. Publiczny endpoint zwraca tylko bezpieczny snapshot: status, kurs, stawkę, zdarzenia i etykiety typów. Nie ujawnia salda, emaila ani prywatnych danych użytkownika.
