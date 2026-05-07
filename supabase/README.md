# Supabase

Ten katalog trzyma wersjonowane zmiany bazy dla VirtualBook. Zrodlem prawdy sa migracje w `supabase/migrations`, a nie reczne eksporty z SQL Editora.

## Zasady

- Kazda zmiana struktury bazy powinna trafic do osobnej migracji SQL.
- Nie commitujemy screenshotow, jednorazowych dumpow schematu ani prywatnych eksportow funkcji z Supabase.
- Funkcje produkcyjne powinny byc idempotentne tam, gdzie sa uzywane przez cron lub admin sync.
- Kursy BSD publicznie pokazywane jako realne musza miec `source = 'bsd'` i `pricing_method = 'bsd_market_normalized'`.
- Wlasny model moze zapisywac tylko osobne kursy `source = 'internal_model'` i `pricing_method = 'internal_model_fallback'`.
- Nie przywracamy `bsd_model_derived`.

## Najwazniejsze obszary bazy

- `matches` - mecze z BSD, `raw_bsd`, identyfikatory providera i status.
- `odds` - kursy realne BSD oraz audytowalne kursy modelowe.
- `match_pricing_features` - snapshot wejsc pod pricing i predykcje.
- `bsd_event_features` - cechy wydarzenia z BSD.
- `team_stat_snapshots` - statystyki druzynowe uzywane przez fallback odds i porownanie.
- `internal_odds_model_runs` - audyt uruchomien modelu.
- `event_predictions` - pelne predykcje/insighty.
- `icons_leagues` i `icons_teams` - docelowe zrodlo ikon lig oraz druzyn.
- `bsd_realtime_frames` - surowy bufor WebSocket BSD v2.

## Przydatne zapytania kontrolne

```sql
select source, pricing_method, count(*) as rows
from public.odds
group by source, pricing_method
order by rows desc;
```

```sql
select count(*) as model_derived_rows
from public.odds
where pricing_method = 'bsd_model_derived';
```

```sql
select count(*) as rows, count(distinct team_id) as teams
from public.team_stat_snapshots;
```

## Praca z migracjami

Po dodaniu migracji uruchom ja na Supabase i sprawdz, czy endpointy API nadal widza zmieniony schemat. Dla funkcji RPC warto po zmianie wykonac:

```sql
select pg_notify('pgrst', 'reload schema');
```
