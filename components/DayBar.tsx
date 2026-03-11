//components/DayBar.tsx
"use client";

import React, { useMemo, useState } from "react";
import MonthCalendar from "@/components/MonthCalendar";
import { addDaysLocal, todayLocalYYYYMMDD } from "@/lib/date";

type Props = {
  value: string; // YYYY-MM-DD
  onChange: (v: string) => void;
  enabledDates?: string[];
  enabledDatesLoaded?: boolean;
};

function weekdayShortPL(d: Date) {
  return d.toLocaleDateString("pl-PL", { weekday: "short" });
}

function monthShortPL(d: Date) {
  return d.toLocaleDateString("pl-PL", { month: "short" });
}

function parseLocalYYYYMMDD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export default function DayBar({
  value,
  onChange,
  enabledDates = [],
  enabledDatesLoaded = false,
}: Props) {
  const [open, setOpen] = useState(false);

  const enabledSet = useMemo(() => new Set(enabledDates), [enabledDates]);

  const label = useMemo(() => {
    const today = todayLocalYYYYMMDD();
    const tomorrow = addDaysLocal(today, 1);
    const yesterday = addDaysLocal(today, -1);

    if (value === today) return "Dzisiaj";
    if (value === tomorrow) return "Jutro";
    if (value === yesterday) return "Wczoraj";

    const d = parseLocalYYYYMMDD(value);
    const dd = String(d.getDate()).padStart(2, "0");
    return `${weekdayShortPL(d)} ${dd} ${monthShortPL(d)} ${d.getFullYear()}`;
  }, [value]);

  const canGoPrev =
    enabledDates.length === 0 || enabledSet.has(addDaysLocal(value, -1));
  const canGoNext =
    enabledDates.length === 0 || enabledSet.has(addDaysLocal(value, 1));

  return (
    <>
      <div className="flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        <button
          onClick={() => {
            if (canGoPrev) onChange(addDaysLocal(value, -1));
          }}
          disabled={!canGoPrev}
          className={[
            "rounded-xl border px-3 py-2 text-sm transition",
            canGoPrev
              ? "border-neutral-800 bg-neutral-950 hover:bg-neutral-800"
              : "border-neutral-900 bg-neutral-950/40 text-neutral-600 cursor-not-allowed",
          ].join(" ")}
          aria-label="Poprzedni dzień"
        >
          ←
        </button>

        <button
          onClick={() => setOpen(true)}
          className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm hover:bg-neutral-800 transition"
          title="Wybierz dzień"
        >
          {label}
        </button>

        <button
          onClick={() => {
            if (canGoNext) onChange(addDaysLocal(value, +1));
          }}
          disabled={!canGoNext}
          className={[
            "rounded-xl border px-3 py-2 text-sm transition",
            canGoNext
              ? "border-neutral-800 bg-neutral-950 hover:bg-neutral-800"
              : "border-neutral-900 bg-neutral-950/40 text-neutral-600 cursor-not-allowed",
          ].join(" ")}
          aria-label="Następny dzień"
        >
          →
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onMouseDown={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <MonthCalendar
              value={value}
              enabledDates={enabledDates}
              enabledDatesLoaded={enabledDatesLoaded}
              onChange={(v) => {
                onChange(v);
                setOpen(false);
              }}
            />

            <button
              onClick={() => {
                onChange(todayLocalYYYYMMDD());
                setOpen(false);
              }}
              className="mt-3 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm hover:bg-neutral-800 transition"
            >
              Dzisiaj
            </button>
          </div>
        </div>
      )}
    </>
  );
}