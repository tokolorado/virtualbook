// components/ResultsTicker.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type ResultTickerItem = {
  id: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  competitionCode: string | null;
  competitionName: string | null;
  utcDate: string;
};

type ResultsTickerResponse = {
  ok: boolean;
  results: ResultTickerItem[];
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function cleanResultName(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  return text || "—";
}

export default function ResultsTicker({ className }: { className?: string }) {
  const [items, setItems] = useState<ResultTickerItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    const load = async () => {
      try {
        const response = await fetch("/api/events/results-ticker?limit=16", {
          cache: "no-store",
        });

        const data = (await response.json().catch(() => null)) as
          | ResultsTickerResponse
          | null;

        if (cancelled) return;

        if (!response.ok || !data?.ok || !Array.isArray(data.results)) {
          setItems([]);
          setLoaded(true);
          return;
        }

        setItems(data.results);
        setLoaded(true);
      } catch {
        if (!cancelled) {
          setItems([]);
          setLoaded(true);
        }
      }
    };

    void load();
    intervalId = window.setInterval(load, 60_000);

    return () => {
      cancelled = true;

      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, []);

  const tickerItems = useMemo(() => {
    if (!items.length) return [];

    // Minimum 3 kopie, żeby animacja działała też na szerokim desktopie,
    // nawet gdy lista wyników jest krótka.
    return [...items, ...items, ...items];
  }, [items]);

  if (!loaded || !items.length) {
    return null;
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950/70",
        className
      )}
    >
      <div className="flex h-11 items-center overflow-hidden bg-white/[0.025]">
        <div className="flex h-full shrink-0 items-center gap-2 border-r border-neutral-800 px-4">
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-neutral-700 text-[10px] text-neutral-500">
            ✓
          </span>
          <span className="text-[10px] font-black uppercase tracking-[0.22em] text-neutral-500">
            Wyniki
          </span>
        </div>

        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div className="vb-results-ticker flex w-max min-w-max whitespace-nowrap pl-6">
            {tickerItems.map((item, index) => (
              <span
                key={`${item.id}-${index}`}
                className="mr-12 inline-flex shrink-0 items-center gap-2 text-xs font-bold text-neutral-300"
              >
                <span className="h-1.5 w-1.5 rounded-full border border-neutral-600" />
                <span className="text-neutral-500">FT</span>
                <span>{cleanResultName(item.home)}</span>
                <span className="text-white">
                  {item.homeScore} - {item.awayScore}
                </span>
                <span>{cleanResultName(item.away)}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes vb-results-ticker {
          from {
            transform: translate3d(0, 0, 0);
          }
          to {
            transform: translate3d(-33.333%, 0, 0);
          }
        }

        .vb-results-ticker {
          animation: vb-results-ticker 38s linear infinite;
          will-change: transform;
        }

        @media (hover: hover) {
          .vb-results-ticker:hover {
            animation-play-state: paused;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .vb-results-ticker {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}