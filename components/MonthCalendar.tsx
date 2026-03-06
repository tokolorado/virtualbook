// components/MonthCalendar.tsx
"use client";

import React, { useMemo, useState } from "react";
import { formatLocalYYYYMMDD } from "@/lib/date";

type Props = {
  value: string; // YYYY-MM-DD (lokalnie)
  onChange: (next: string) => void;
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
  "Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec",
  "Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"
];

export default function MonthCalendar({ value, onChange }: Props) {
  const selected = useMemo(() => parseLocalYYYYMMDD(value), [value]);
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(selected));

  // jeśli user wybierze dzień z innego miesiąca, przestaw widok
  React.useEffect(() => {
    const sm = startOfMonth(selected);
    if (sm.getFullYear() !== viewMonth.getFullYear() || sm.getMonth() !== viewMonth.getMonth()) {
      setViewMonth(sm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const daysGrid = useMemo(() => {
    const first = startOfMonth(viewMonth);
    // Monday=0 ... Sunday=6
    const firstWeekday = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - firstWeekday);

    const cells: { date: Date; inMonth: boolean; key: string }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const inMonth = d.getMonth() === viewMonth.getMonth();
      cells.push({ date: d, inMonth, key: formatLocalYYYYMMDD(d) });
    }
    return cells;
  }, [viewMonth]);

  const selectedKey = formatLocalYYYYMMDD(selected);
  const todayKey = formatLocalYYYYMMDD(new Date());

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-neutral-400">Kalendarz</div>
          <div className="text-base font-semibold">
            {MONTHS_PL[viewMonth.getMonth()]} {viewMonth.getFullYear()}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setViewMonth(addMonths(viewMonth, -1))}
            className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm hover:bg-neutral-800 transition"
            aria-label="Poprzedni miesiąc"
          >
            ←
          </button>
          <button
            onClick={() => setViewMonth(addMonths(viewMonth, 1))}
            className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm hover:bg-neutral-800 transition"
            aria-label="Następny miesiąc"
          >
            →
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-xs text-neutral-400">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center py-1">{w}</div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {daysGrid.map((cell) => {
          const key = cell.key;
          const isSelected = key === selectedKey;
          const isToday = key === todayKey;

          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              className={[
                "h-10 rounded-xl border text-sm transition flex items-center justify-center",
                cell.inMonth
                  ? "border-neutral-800 bg-neutral-950 hover:bg-neutral-800"
                  : "border-neutral-900 bg-neutral-950/40 text-neutral-600 hover:bg-neutral-900/40",
                isToday ? "ring-1 ring-neutral-500" : "",
                isSelected ? "border-neutral-200 bg-white text-black hover:bg-neutral-200" : "",
              ].join(" ")}
              title={key}
            >
              {cell.date.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-3 text-xs text-neutral-500">
        Wybrany dzień: <span className="text-neutral-200">{value}</span>
      </div>
    </div>
  );
}