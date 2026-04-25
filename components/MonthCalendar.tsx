// components/MonthCalendar.tsx
"use client";

import React, { useMemo, useState } from "react";
import { formatLocalYYYYMMDD } from "@/lib/date";

type Props = {
  value: string; // YYYY-MM-DD (lokalnie)
  onChange: (next: string) => void;
  enabledDates?: string[]; // dni, w których są mecze
  enabledDatesLoaded?: boolean;
  compact?: boolean;
};

function parseLocalYYYYMMDD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

const WEEKDAYS = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];
const MONTHS_PL = [
  "Styczeń",
  "Luty",
  "Marzec",
  "Kwiecień",
  "Maj",
  "Czerwiec",
  "Lipiec",
  "Sierpień",
  "Wrzesień",
  "Październik",
  "Listopad",
  "Grudzień",
];

export default function MonthCalendar({
  value,
  onChange,
  enabledDates = [],
  enabledDatesLoaded = false,
  compact = false,
}: Props) {
  const selected = useMemo(() => parseLocalYYYYMMDD(value), [value]);
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(selected));

  const enabledSet = useMemo(() => new Set(enabledDates), [enabledDates]);

  React.useEffect(() => {
    const sm = startOfMonth(selected);

    if (
      sm.getFullYear() !== viewMonth.getFullYear() ||
      sm.getMonth() !== viewMonth.getMonth()
    ) {
      setViewMonth(sm);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const daysGrid = useMemo(() => {
    const first = startOfMonth(viewMonth);
    const firstWeekday = (first.getDay() + 6) % 7;
    const start = new Date(first);

    start.setDate(first.getDate() - firstWeekday);

    const cells: { date: Date; inMonth: boolean; key: string }[] = [];

    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);

      const inMonth = d.getMonth() === viewMonth.getMonth();

      cells.push({
        date: d,
        inMonth,
        key: formatLocalYYYYMMDD(d),
      });
    }

    return cells;
  }, [viewMonth]);

  const selectedKey = formatLocalYYYYMMDD(selected);
  const todayKey = formatLocalYYYYMMDD(new Date());

  return (
    <div
      className={[
        "rounded-2xl border border-neutral-800 bg-neutral-900/40",
        compact ? "p-3" : "p-4",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div
            className={
              compact ? "text-xs text-neutral-400" : "text-sm text-neutral-400"
            }
          >
            Kalendarz
          </div>

          <div
            className={
              compact ? "text-sm font-semibold" : "text-base font-semibold"
            }
          >
            {MONTHS_PL[viewMonth.getMonth()]} {viewMonth.getFullYear()}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setViewMonth(addMonths(viewMonth, -1))}
            className={[
              "border border-neutral-800 bg-neutral-950 transition hover:bg-neutral-800",
              compact
                ? "rounded-lg px-2 py-1 text-xs"
                : "rounded-xl px-3 py-2 text-sm",
            ].join(" ")}
            aria-label="Poprzedni miesiąc"
          >
            ←
          </button>

          <button
            type="button"
            onClick={() => setViewMonth(addMonths(viewMonth, 1))}
            className={[
              "border border-neutral-800 bg-neutral-950 transition hover:bg-neutral-800",
              compact
                ? "rounded-lg px-2 py-1 text-xs"
                : "rounded-xl px-3 py-2 text-sm",
            ].join(" ")}
            aria-label="Następny miesiąc"
          >
            →
          </button>
        </div>
      </div>

      <div
        className={[
          "grid grid-cols-7 gap-1 text-xs text-neutral-400",
          compact ? "mt-2" : "mt-3",
        ].join(" ")}
      >
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className={compact ? "py-0.5 text-center" : "py-1 text-center"}
          >
            {w}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {daysGrid.map((cell) => {
          const key = cell.key;
          const isSelected = key === selectedKey;
          const isToday = key === todayKey;
          const isEnabled = enabledDatesLoaded ? enabledSet.has(key) : false;

          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (!isEnabled) return;
                onChange(key);
              }}
              disabled={!isEnabled}
              className={[
                compact
                  ? "relative flex h-8 items-center justify-center rounded-lg border text-xs transition"
                  : "relative flex h-10 items-center justify-center rounded-xl border text-sm transition",
                cell.inMonth
                  ? "border-neutral-800 bg-neutral-950"
                  : "border-neutral-900 bg-neutral-950/30 text-neutral-600",
                cell.inMonth && isEnabled
                  ? "text-neutral-200 hover:bg-neutral-800"
                  : "",
                !isEnabled
                  ? "cursor-not-allowed text-neutral-500 opacity-45"
                  : "",
                isToday ? "ring-1 ring-sky-500/70" : "",
                isSelected
                  ? "border-sky-400/60 bg-neutral-800 text-white ring-1 ring-sky-400/40 hover:bg-neutral-700"
                  : "",
                !isSelected && isEnabled && cell.inMonth
                  ? "shadow-[inset_0_0_0_1px_rgba(250,204,21,0.05)]"
                  : "",
              ].join(" ")}
              title={
                isEnabled
                  ? `${key}${isToday ? " • Dzisiaj" : ""}`
                  : `${key} • Brak meczów`
              }
            >
              <span>{cell.date.getDate()}</span>

              {!isSelected && isEnabled && cell.inMonth ? (
                <span
                  className={
                    compact
                      ? "absolute bottom-0.5 h-1 w-1 rounded-full bg-yellow-400"
                      : "absolute bottom-1 h-1.5 w-1.5 rounded-full bg-yellow-400"
                  }
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        className={[
          "flex flex-wrap items-center text-neutral-500",
          compact
            ? "mt-2 gap-x-3 gap-y-1 text-[11px]"
            : "mt-3 gap-x-4 gap-y-2 text-xs",
        ].join(" ")}
      >
        <div>
          Wybrany dzień: <span className="text-neutral-200">{value}</span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={
              compact
                ? "inline-block h-1.5 w-1.5 rounded-full bg-yellow-400"
                : "inline-block h-2 w-2 rounded-full bg-yellow-400"
            }
          />
          <span>Dzień z meczami</span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={
              compact
                ? "inline-block h-1.5 w-1.5 rounded-full bg-neutral-600"
                : "inline-block h-2 w-2 rounded-full bg-neutral-600"
            }
          />
          <span>Brak meczów</span>
        </div>
      </div>
    </div>
  );
}