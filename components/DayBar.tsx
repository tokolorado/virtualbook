// components/DayBar.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { todayLocalYYYYMMDD } from "@/lib/date";

type DayBarProps = {
  value: string;
  onChange: (value: string) => void;
  enabledDates?: string[];
  enabledDatesLoaded?: boolean;
  showCalendarInline?: boolean;
  days?: number;
};

type DateItem = {
  ymd: string;
  dayLabel: string;
  dateLabel: string;
  isToday: boolean;
  isTomorrow: boolean;
  hasMatches: boolean;
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function isYYYYMMDD(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseYmdLocal(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function formatYmdLocal(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDaysYmd(ymd: string, days: number) {
  const date = parseYmdLocal(ymd);
  date.setDate(date.getDate() + days);
  return formatYmdLocal(date);
}

function addMonthsYmd(ymd: string, months: number) {
  const date = parseYmdLocal(`${ymd.slice(0, 7)}-01`);
  date.setMonth(date.getMonth() + months);
  return formatYmdLocal(date);
}

function sameMonth(a: string, b: string) {
  return a.slice(0, 7) === b.slice(0, 7);
}

function dateLabel(ymd: string) {
  const date = parseYmdLocal(ymd);
  return `${date.getDate()}.${String(date.getMonth() + 1).padStart(2, "0")}.`;
}

function monthTitle(ymd: string) {
  return parseYmdLocal(ymd).toLocaleDateString("pl-PL", {
    month: "long",
    year: "numeric",
  });
}

function weekdayLabel(ymd: string) {
  const date = parseYmdLocal(ymd);

  return date
    .toLocaleDateString("pl-PL", {
      weekday: "short",
    })
    .replace(".", "")
    .toUpperCase();
}

function buildMonthGrid(monthYmd: string) {
  const firstDay = parseYmdLocal(`${monthYmd.slice(0, 7)}-01`);
  const firstGridDay = new Date(firstDay);
  const mondayOffset = (firstDay.getDay() + 6) % 7;

  firstGridDay.setDate(firstGridDay.getDate() - mondayOffset);

  return Array.from({ length: 42 }).map((_, index) => {
    const date = new Date(firstGridDay);
    date.setDate(firstGridDay.getDate() + index);
    return formatYmdLocal(date);
  });
}

export default function DayBar({
  value,
  onChange,
  enabledDates = [],
  enabledDatesLoaded = false,
  showCalendarInline = false,
  days = 14,
}: DayBarProps) {
  const today = todayLocalYYYYMMDD();
  const tomorrow = addDaysYmd(today, 1);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(
    isYYYYMMDD(value) ? value : today
  );

  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const enabledSet = useMemo(() => new Set(enabledDates), [enabledDates]);

  const visibleDates = useMemo<DateItem[]>(() => {
    return Array.from({ length: days + 1 }).map((_, index) => {
      const ymd = addDaysYmd(today, index);
      const hasMatches = !enabledDatesLoaded || enabledSet.has(ymd);

      return {
        ymd,
        dayLabel:
          ymd === today ? "DZIŚ" : ymd === tomorrow ? "JUTRO" : weekdayLabel(ymd),
        dateLabel: dateLabel(ymd),
        isToday: ymd === today,
        isTomorrow: ymd === tomorrow,
        hasMatches,
      };
    });
  }, [days, enabledDatesLoaded, enabledSet, today, tomorrow]);

  const horizonStart = visibleDates[0]?.ymd ?? today;
  const horizonEnd = visibleDates[visibleDates.length - 1]?.ymd ?? today;

  useEffect(() => {
    if (isYYYYMMDD(value)) {
      setCalendarMonth(value);
    }
  }, [value]);

  useEffect(() => {
    const node = buttonRefs.current[value];

    if (!node) return;

    node.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [value]);

  const monthDays = useMemo(() => buildMonthGrid(calendarMonth), [calendarMonth]);

  const canGoPrevMonth = addMonthsYmd(calendarMonth, -1).slice(0, 7) >= horizonStart.slice(0, 7);
  const canGoNextMonth = addMonthsYmd(calendarMonth, 1).slice(0, 7) <= horizonEnd.slice(0, 7);

  return (
    <div className="overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950/70">
      <div className="border-b border-neutral-800/80 bg-white/[0.025]">
        <div className="no-scrollbar flex snap-x snap-proximity overflow-x-auto overscroll-x-contain px-2">
          {visibleDates.map((item) => {
            const active = item.ymd === value;

            return (
              <button
                key={item.ymd}
                ref={(node) => {
                  buttonRefs.current[item.ymd] = node;
                }}
                type="button"
                onClick={() => onChange(item.ymd)}
                className={cn(
                  "relative flex min-w-[76px] shrink-0 snap-start flex-col items-center gap-1 border-b-[3px] px-2 py-3 text-center transition",
                  active
                    ? "border-red-500"
                    : "border-transparent hover:border-neutral-700",
                  !item.hasMatches && "opacity-45 hover:opacity-70"
                )}
                title={
                  item.hasMatches
                    ? item.ymd
                    : `${item.ymd} — brak meczów w aktualnej ofercie`
                }
              >
                <span
                  className={cn(
                    "text-[10px] font-black uppercase tracking-[0.16em] leading-none",
                    active ? "text-white" : "text-neutral-500"
                  )}
                >
                  {item.dayLabel}
                </span>

                <span
                  className={cn(
                    "text-lg font-black leading-none tracking-tight",
                    active ? "text-white" : "text-neutral-300"
                  )}
                >
                  {item.dateLabel}
                </span>

                {!item.hasMatches ? (
                  <span className="mt-0.5 h-1 w-1 rounded-full bg-neutral-700" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {showCalendarInline ? (
        <div className="p-3">
          <button
            type="button"
            onClick={() => setCalendarOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-left transition hover:border-neutral-700 hover:bg-neutral-900"
          >
            <span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.22em] text-neutral-500">
                Kalendarz
              </span>
              <span className="mt-1 block text-sm font-semibold text-white">
                {value}
              </span>
            </span>

            <span className="rounded-full border border-neutral-800 px-3 py-1 text-xs font-semibold text-neutral-300">
              {calendarOpen ? "Ukryj" : "Pokaż"}
            </span>
          </button>

          {calendarOpen ? (
            <div className="mt-3 rounded-2xl border border-neutral-800 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={!canGoPrevMonth}
                  onClick={() => setCalendarMonth(addMonthsYmd(calendarMonth, -1))}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-sm font-semibold transition",
                    canGoPrevMonth
                      ? "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900"
                      : "cursor-not-allowed border-neutral-900 bg-neutral-950 text-neutral-700"
                  )}
                >
                  ←
                </button>

                <div className="text-sm font-semibold capitalize text-white">
                  {monthTitle(calendarMonth)}
                </div>

                <button
                  type="button"
                  disabled={!canGoNextMonth}
                  onClick={() => setCalendarMonth(addMonthsYmd(calendarMonth, 1))}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-sm font-semibold transition",
                    canGoNextMonth
                      ? "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900"
                      : "cursor-not-allowed border-neutral-900 bg-neutral-950 text-neutral-700"
                  )}
                >
                  →
                </button>
              </div>

              <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-600">
                {["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"].map((day) => (
                  <div key={day}>{day}</div>
                ))}
              </div>

              <div className="mt-2 grid grid-cols-7 gap-1">
                {monthDays.map((ymd) => {
                  const active = ymd === value;
                  const inMonth = sameMonth(ymd, calendarMonth);
                  const inHorizon = ymd >= horizonStart && ymd <= horizonEnd;
                  const hasMatches = !enabledDatesLoaded || enabledSet.has(ymd);
                  const disabled = !inHorizon;

                  return (
                    <button
                      key={ymd}
                      type="button"
                      disabled={disabled}
                      onClick={() => onChange(ymd)}
                      className={cn(
                        "relative flex h-9 items-center justify-center rounded-xl border text-xs font-semibold transition",
                        active
                          ? "border-red-500 bg-red-500 text-white"
                          : "border-neutral-900 bg-neutral-950 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-900",
                        !inMonth && "text-neutral-700",
                        !hasMatches && inHorizon && "opacity-45",
                        disabled && "cursor-not-allowed opacity-20"
                      )}
                    >
                      {Number(ymd.slice(8, 10))}

                      {hasMatches && inHorizon ? (
                        <span className="absolute bottom-1 h-1 w-1 rounded-full bg-yellow-400" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <style jsx>{`
        .no-scrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}