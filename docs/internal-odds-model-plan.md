# Internal Odds Model

Stan: 2026-05-07.

Ten dokument opisuje bezpieczny zakres wewnętrznego modelu kursów. Model nie jest zamiennikiem BSD i nie może udawać realnych kursów bukmacherskich.

## Kontrakt Produktowy

- Realne kursy BSD są nadrzędne: `source = 'bsd'`, `pricing_method = 'bsd_market_normalized'`.
- Stary fallback `bsd_model_derived` nie wraca.
- Wewnętrzny model zapisuje wyłącznie `source = 'internal_model'` i `pricing_method = 'internal_model_fallback'`.
- Model nie nadpisuje realnych kursów BSD.
- Jeżeli dane wejściowe są zbyt słabe, system nie generuje kursów.
- Każde uruchomienie zostawia audyt w `internal_odds_model_runs`.

## Obecny Bezpieczny Zakres

Model może liczyć tylko podstawowe rynki:

- 1X2,
- over/under 1.5,
- over/under 2.5,
- over/under 3.5,
- BTTS.

Źródła danych wejściowych, w kolejności preferencji:

- `team_stat_snapshots` - statystyki drużynowe,
- `bsd_event_features` - cechy wydarzenia BSD,
- `match_pricing_features` - snapshot pricingowy meczu,
- realne rynki BSD jako kotwica tylko wtedy, gdy BSD poda część rynków.

## Guardy

Model nie powinien zapisać kursów, jeżeli:

- mecz nie pochodzi z BSD,
- realne kursy BSD już istnieją dla tego samego rynku,
- brakuje danych wejściowych dla obu drużyn,
- wynik zawiera `null`, `NaN`, `Infinity`,
- kurs jest poza zakresem 1.01-100,
- suma prawdopodobieństw w rynku jest nielogiczna,
- rozkład 1X2 wygląda jak stały placeholder,
- input snapshot nie pozwala odtworzyć decyzji modelu.

## Audyt

Każdy run powinien zapisywać:

- `match_id`,
- `model_version`,
- `status`,
- `confidence`,
- `lambda_home`,
- `lambda_away`,
- `input_snapshot`,
- `output_snapshot`.

Statusy powinny odróżniać udane wyceny od pominięć, błędów, purga i starszych runów zastąpionych nowszym wynikiem.

## Docelowe Dane

Model docelowo powinien korzystać z:

- globalnego rankingu drużyn,
- statystyk home/away,
- xG i xGA,
- formy last 5 i last 10,
- absencji, kontuzji, zawieszeń i kartek,
- stylu gry i trenera,
- venue, neutral ground i local derby,
- H2H,
- rest days, fatigue index i podróży,
- danych live, jeżeli mecz trwa.

## Kolejne Kroki

1. Rozszerzyć `team_stat_snapshots` o home/away split oraz last 5 / last 10.
2. Dodać ranking siły drużyn per liga i globalnie.
3. Zbudować panel audytu modelu w adminie.
4. Dopuścić modelowe uzupełnianie brakujących rynków tylko wtedy, gdy realne rynki BSD pozostają nienaruszone.
5. Dodać monitoring jakości: liczba meczów wycenionych, pominiętych, z realnymi BSD odds i z fallbackiem.
