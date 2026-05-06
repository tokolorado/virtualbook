# Internal odds model - plan rozwoju

## Zasady produktowe

- Realne kursy BSD pozostają nadrzędne: `source = "bsd"` i `pricing_method = "bsd_market_normalized"`.
- Model wewnętrzny działa wyłącznie jako fallback i zapisuje kursy jako `source = "internal_model"` oraz `pricing_method = "internal_model_fallback"`.
- Model nie nadpisuje realnych kursów BSD.
- Jeżeli dane wejściowe są zbyt słabe, system nie generuje kursów i pokazuje komunikat: "Jeszcze nie ma kursów dla tego meczu."
- Każde uruchomienie modelu musi zostawić ślad w `internal_odds_model_runs`.

## Obecny bezpieczny zakres

Model może liczyć podstawowe rynki:

- 1X2,
- over/under 1.5,
- over/under 2.5,
- over/under 3.5,
- BTTS.

Źródła danych wejściowych:

- `team_stat_snapshots` jako preferowana baza drużynowa,
- `bsd_event_features` jako fallback, gdy snapshoty drużynowe są niedostępne,
- `match_pricing_features` jako read model meczowy i audytowy.

Walidacja wyniku:

- brak `null`, `NaN`, `Infinity`,
- kurs od 1.01 do 100,
- logiczna suma prawdopodobieństw w obrębie rynku,
- brak duplikatów selekcji,
- brak placeholderowego identycznego rozkładu 1X2.

## Docelowe wejścia modelu

- globalny ranking drużyn,
- statystyki teamowe home/away,
- xG oraz xGA,
- forma last 5 i last 10,
- absencje, kontuzje, zawieszenia i kartki,
- styl gry oraz trener,
- venue, neutral ground, local derby,
- H2H,
- rest days, fatigue index, podróże,
- live stats, jeżeli mecz trwa.

## Kolejne kroki

1. Rozszerzyć `team_stat_snapshots` o pełniejsze home/away split i last 5 / last 10.
2. Dodać ranking siły drużyn liczony per liga i globalnie.
3. Zbudować osobny audyt jakości wejścia modelu, widoczny w adminie.
4. Dopuścić brakujące rynki modelowe przy częściowych kursach BSD tylko wtedy, gdy rynek BSD nie istnieje.
5. Dodać panel porównania kurs BSD vs model, ale bez oznaczania tego jako Value Monitor w UI użytkownika.
