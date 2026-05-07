# BSD v2 I Realtime

Stan: 2026-05-07.

BSD ogłosiło v2, ruch kursów co minutę i pełniejsze live stats na WebSocket. To jest ważny kierunek, ale wdrażamy go defensywnie: najpierw audyt ramek, potem bezpieczne mapowanie do tabel publicznych.

## Co Już Jest W Projekcie

- Klient BSD ma helpery v2.
- Sync meczów preferuje v2 odds i dopiero potem używa starej ścieżki jako fallbacku.
- Cron odświeża horyzont kursów częściej dla bliskich meczów.
- Istnieje migracja `bsd_realtime_frames`.
- Istnieje worker `npm run bsd:realtime`, który zapisuje surowe ramki.

## Zasady Bezpieczeństwa

- REST v2 pozostaje podstawą produkcyjnego zapisu kursów.
- WebSocket nie powinien bezpośrednio nadpisywać `odds`, dopóki nie mamy stabilnego parsera.
- Każda ramka realtime musi być audytowalna.
- Kursy realtime muszą przejść te same guardy co REST:
  - brak `null`, `NaN`, `Infinity`,
  - kurs w dozwolonym zakresie,
  - logiczne prawdopodobieństwa rynku,
  - brak nadpisywania realnych danych gorszą próbką.

## Worker

Docelowo worker:

1. Pobiera aktywne mecze BSD z bazy.
2. Subskrybuje tylko ograniczoną liczbę eventów naraz.
3. Zapisuje surowe ramki do `bsd_realtime_frames`.
4. Aktualizuje live status i live stats, gdy payload jest stabilny.
5. Po osobnym przeglądzie mapuje `odds` i `odds_book` do `odds`.

Uruchomienie:

```bash
npm run bsd:realtime
```

Env:

```env
BSD_REALTIME_WS_URL=
BSD_REALTIME_TOKEN=
BSD_REALTIME_POLL_MS=
BSD_REALTIME_MAX_EVENTS=
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

## Następne Kroki

1. Zebrać próbki ramek `odds` i `odds_book` z kilku lig.
2. Porównać wartości realtime z REST v2 dla tych samych eventów.
3. Dodać parser tylko dla potwierdzonych pól.
4. Dodać idempotentny upsert realtime odds z metadanymi źródła.
5. Dodać alarm, gdy BSD pokazuje kursy na stronie, a u nas nie ma ich po 10 minutach.
