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

  const canGoPrevMonth =
    addMonthsYmd(calendarMonth, -1).slice(0, 7) >= horizonStart.slice(0, 7);

  const canGoNextMonth =
    addMonthsYmd(calendarMonth, 1).slice(0, 7) <= horizonEnd.slice(0, 7);

  return (
    <div className="vb-daybar-shell overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950/75">
      <div className="relative h-[92x] min-w-0 overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-8 bg-gradient-to-r from-neutral-950 via-neutral-950/70 to-transparent sm:w-12" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-8 bg-gradient-to-l from-neutral-950 via-neutral-950/70 to-transparent sm:w-12" />

        <div className="no-scrollbar h-full min-w-0 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full w-max min-w-full justify-center px-1">
            {visibleDates.map((item) => {
              const active = item.ymd === value;
              const disabledLook = !item.hasMatches && !active;

              return (
                <button
                  key={item.ymd}
                  ref={(node) => {
                    buttonRefs.current[item.ymd] = node;
                  }}
                  type="button"
                  onClick={() => onChange(item.ymd)}
                  className={cn(
                    "vb-date-item relative h-full border-b-[3px] px-2 text-center outline-none transition duration-200 active:scale-[0.98]",
                    active ? "vb-date-active" : "vb-date-idle",
                    disabledLook && "vb-date-muted"
                  )}
                  title={
                    item.hasMatches
                      ? item.ymd
                      : `${item.ymd} — brak meczów w aktualnej ofercie`
                  }
                >
                  <span className="vb-date-center relative z-10">
                    <span
                      className={cn(
                        "block text-[10px] font-black uppercase leading-none tracking-[0.2em] sm:text-[11px]",
                        active
                          ? "text-cyan-50"
                          : disabledLook
                            ? "text-neutral-600"
                            : "text-neutral-500"
                      )}
                    >
                      {item.dayLabel}
                    </span>

                    <span
                      className={cn(
                        "mt-1 block text-lg font-black leading-none tracking-tight sm:text-xl",
                        active
                          ? "text-white"
                          : disabledLook
                            ? "text-neutral-500"
                            : "text-neutral-300"
                      )}
                    >
                      {item.dateLabel}
                    </span>
                  </span>

                  {disabledLook ? (
                    <span className="pointer-events-none absolute bottom-2 left-1/2 z-10 h-1 w-5 -translate-x-1/2 rounded-full bg-neutral-800/90" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {showCalendarInline ? (
        <div className="border-t border-neutral-800/80 p-3">
          <button
            type="button"
            onClick={() => setCalendarOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-left outline-none transition hover:border-cyan-400/40 hover:bg-neutral-900"
          >
            <span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.22em] text-neutral-500">
                Kalendarz
              </span>
              <span className="mt-1 block text-sm font-semibold text-white">
                {value}
              </span>
            </span>

            <span className="rounded-full border border-amber-400/20 bg-amber-400/5 px-3 py-1 text-xs font-semibold text-amber-200">
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
                    "rounded-xl border px-3 py-2 text-sm font-semibold outline-none transition",
                    canGoPrevMonth
                      ? "border-neutral-800 bg-neutral-950 text-neutral-200 hover:border-cyan-400/40 hover:bg-neutral-900"
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
                    "rounded-xl border px-3 py-2 text-sm font-semibold outline-none transition",
                    canGoNextMonth
                      ? "border-neutral-800 bg-neutral-950 text-neutral-200 hover:border-cyan-400/40 hover:bg-neutral-900"
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
                        "relative flex h-9 items-center justify-center rounded-xl border text-xs font-semibold outline-none transition",
                        active
                          ? "border-cyan-300 bg-cyan-400 text-black shadow-[0_0_22px_rgba(34,211,238,0.22)]"
                          : "border-neutral-900 bg-neutral-950 text-neutral-300 hover:border-cyan-400/40 hover:bg-neutral-900",
                        !inMonth && "text-neutral-700",
                        !hasMatches && inHorizon && "opacity-45",
                        disabled && "cursor-not-allowed opacity-20"
                      )}
                    >
                      {Number(ymd.slice(8, 10))}

                      {hasMatches && inHorizon ? (
                        <span className="absolute bottom-1 h-1 w-1 rounded-full bg-amber-300" />
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

        .vb-daybar-shell {
          position: relative;
          background:
            radial-gradient(
              circle at 7% 10%,
              rgba(34, 211, 238, 0.14),
              transparent 30%
            ),
            radial-gradient(
              circle at 94% 12%,
              rgba(245, 158, 11, 0.12),
              transparent 30%
            ),
            linear-gradient(
              180deg,
              rgba(255, 255, 255, 0.04),
              rgba(255, 255, 255, 0.012)
            ),
            rgba(10, 10, 10, 0.9);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.055),
            inset 0 -1px 0 rgba(255, 255, 255, 0.025),
            0 18px 70px rgba(0, 0, 0, 0.36);
        }

        .vb-daybar-shell::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(
              90deg,
              transparent,
              rgba(255, 255, 255, 0.07),
              transparent
            );
          opacity: 0.22;
          transform: translateX(-100%);
          animation: vb-shell-sheen 7s ease-in-out infinite;
        }

        @keyframes vb-shell-sheen {
          0%,
          34% {
            transform: translateX(-100%);
          }
          62%,
          100% {
            transform: translateX(100%);
          }
        }

        .vb-date-item {
          position: relative;
          display: flex;
          flex: 0 0 86px;
          width: 86px;
          min-width: 86px;
          max-width: 86px;
          align-items: center;
          justify-content: center;
          border-bottom-color: transparent;
        }

        .vb-date-center {
          display: flex;
          width: 100%;
          min-width: 0;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          pointer-events: none;
          transform: none;
        }

        .vb-date-item::before {
          content: "";
          position: absolute;
          inset: 8px 5px;
          border-radius: 18px;
          opacity: 0;
          background:
            radial-gradient(
              circle at 50% 0%,
              rgba(34, 211, 238, 0.16),
              transparent 60%
            ),
            linear-gradient(
              180deg,
              rgba(255, 255, 255, 0.055),
              rgba(255, 255, 255, 0.01)
            );
          transition:
            opacity 180ms ease,
            transform 180ms ease;
          transform: translateY(2px);
          pointer-events: none;
        }

        .vb-date-item:hover::before {
          opacity: 1;
          transform: translateY(0);
        }

        .vb-date-active {
          border-bottom-color: rgb(34, 211, 238);
          text-shadow:
            0 0 12px rgba(34, 211, 238, 0.22),
            0 0 20px rgba(245, 158, 11, 0.1);
        }

        .vb-date-active::before {
          opacity: 1;
          transform: translateY(0);
          background:
            radial-gradient(
              circle at 50% 12%,
              rgba(34, 211, 238, 0.27),
              transparent 58%
            ),
            radial-gradient(
              circle at 50% 100%,
              rgba(245, 158, 11, 0.13),
              transparent 55%
            ),
            linear-gradient(
              180deg,
              rgba(255, 255, 255, 0.08),
              rgba(255, 255, 255, 0.014)
            );
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.055),
            0 0 22px rgba(34, 211, 238, 0.1);
        }

        .vb-date-active::after {
          content: "";
          position: absolute;
          left: 15px;
          right: 15px;
          bottom: 0;
          height: 3px;
          border-radius: 999px;
          background:
            linear-gradient(
              90deg,
              rgba(245, 158, 11, 0),
              rgba(245, 158, 11, 0.95),
              rgba(34, 211, 238, 1),
              rgba(245, 158, 11, 0.95),
              rgba(245, 158, 11, 0)
            );
          box-shadow:
            0 0 14px rgba(34, 211, 238, 0.52),
            0 0 20px rgba(245, 158, 11, 0.22);
        }

        .vb-date-idle:hover {
          border-bottom-color: rgba(245, 158, 11, 0.42);
        }

        .vb-date-muted::before {
          background:
            linear-gradient(
              180deg,
              rgba(255, 255, 255, 0.025),
              rgba(255, 255, 255, 0.006)
            );
        }

        .vb-date-muted:hover {
          border-bottom-color: rgba(115, 115, 115, 0.4);
        }

        @media (min-width: 640px) {
          .vb-date-item {
            flex-basis: 90px;
            width: 90px;
            min-width: 90px;
            max-width: 90px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .vb-daybar-shell::before {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}