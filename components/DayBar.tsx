// components/DayBar.tsx
"use client";

import React, { useMemo, useState } from "react";
import MonthCalendar from "@/components/MonthCalendar";
import { addDaysLocal, todayLocalYYYYMMDD } from "@/lib/date";

type Props = {
  value: string; // YYYY-MM-DD
  onChange: (v: string) => void;
  enabledDates?: string[];
  enabledDatesLoaded?: boolean;
  showCalendarInline?: boolean;
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
  showCalendarInline = false,
}: Props) {
  const [open, setOpen] = useState(false);

  const sortedEnabledDates = useMemo(() => {
    return [...enabledDates].sort();
  }, [enabledDates]);

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

  const previousEnabledDate = useMemo(() => {
    if (!enabledDatesLoaded || sortedEnabledDates.length === 0) return null;

    for (let i = sortedEnabledDates.length - 1; i >= 0; i--) {
      if (sortedEnabledDates[i] < value) {
        return sortedEnabledDates[i];
      }
    }

    return null;
  }, [enabledDatesLoaded, sortedEnabledDates, value]);

  const nextEnabledDate = useMemo(() => {
    if (!enabledDatesLoaded || sortedEnabledDates.length === 0) return null;

    return sortedEnabledDates.find((date) => date > value) ?? null;
  }, [enabledDatesLoaded, sortedEnabledDates, value]);

  const canGoPrev =
    !enabledDatesLoaded || sortedEnabledDates.length === 0 || !!previousEnabledDate;

  const canGoNext =
    !enabledDatesLoaded || sortedEnabledDates.length === 0 || !!nextEnabledDate;

  const handleCenterClick = () => {
    if (showCalendarInline) {
      onChange(todayLocalYYYYMMDD());
      return;
    }

    setOpen(true);
  };

  const goPrev = () => {
    if (!canGoPrev) return;

    if (previousEnabledDate) {
      onChange(previousEnabledDate);
      return;
    }

    onChange(addDaysLocal(value, -1));
  };

  const goNext = () => {
    if (!canGoNext) return;

    if (nextEnabledDate) {
      onChange(nextEnabledDate);
      return;
    }

    onChange(addDaysLocal(value, 1));
  };

  return (
    <>
      <div className={showCalendarInline ? "space-y-3" : ""}>
        <div className="flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3">
          <button
            type="button"
            onClick={goPrev}
            disabled={!canGoPrev}
            className={[
              "rounded-xl border px-2.5 py-1.5 text-sm transition",
              canGoPrev
                ? "border-neutral-800 bg-neutral-950 hover:bg-neutral-800"
                : "cursor-not-allowed border-neutral-900 bg-neutral-950/40 text-neutral-600",
            ].join(" ")}
            aria-label="Poprzedni dzień z meczami"
          >
            ←
          </button>

          <button
            type="button"
            onClick={handleCenterClick}
            className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm transition hover:bg-neutral-800"
            title={showCalendarInline ? "Przejdź do dzisiaj" : "Wybierz dzień"}
          >
            {label}
          </button>

          <button
            type="button"
            onClick={goNext}
            disabled={!canGoNext}
            className={[
              "rounded-xl border px-2.5 py-1.5 text-sm transition",
              canGoNext
                ? "border-neutral-800 bg-neutral-950 hover:bg-neutral-800"
                : "cursor-not-allowed border-neutral-900 bg-neutral-950/40 text-neutral-600",
            ].join(" ")}
            aria-label="Następny dzień z meczami"
          >
            →
          </button>
        </div>

        {showCalendarInline ? (
          <MonthCalendar
            value={value}
            enabledDates={enabledDates}
            enabledDatesLoaded={enabledDatesLoaded}
            onChange={onChange}
            compact
          />
        ) : null}
      </div>

      {!showCalendarInline && open ? (
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
              type="button"
              onClick={() => {
                onChange(todayLocalYYYYMMDD());
                setOpen(false);
              }}
              className="mt-3 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm transition hover:bg-neutral-800"
            >
              Dzisiaj
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}