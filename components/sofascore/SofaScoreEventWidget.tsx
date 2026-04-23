"use client";

import { useEffect, useMemo, useState } from "react";

type SofaScoreWidgetMode = "lineups" | "attackMomentum";

type MappingResponse = {
  matchId?: number | string;
  sofascoreEventId?: number | string | null;
  mapped?: boolean;
};

type SofaScoreEventWidgetProps = {
  matchId: string | number;
  mode: SofaScoreWidgetMode;
  height?: number;
  locale?: string;
  theme?: "light" | "dark";
  className?: string;
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function toEventId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return null;
}

export default function SofaScoreEventWidget({
  matchId,
  mode,
  height,
  locale = "pl",
  theme = "light",
  className,
}: SofaScoreEventWidgetProps) {
  const [loading, setLoading] = useState(true);
  const [eventId, setEventId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      setEventId(null);

      try {
        const response = await fetch(
          `/api/sofascore/mapping?matchId=${encodeURIComponent(String(matchId))}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

        const text = await response.text();
        let json: MappingResponse | null = null;

        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }

        if (!response.ok) {
          throw new Error(
            (json as any)?.error || `Mapping fetch failed (${response.status})`
          );
        }

        const nextEventId = toEventId(json?.sofascoreEventId);

        if (!cancelled) {
          setEventId(nextEventId);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Błąd ładowania widgetu.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const resolvedHeight = useMemo(() => {
    if (typeof height === "number" && height > 0) return height;
    if (mode === "lineups") return 786;
    return 286;
  }, [height, mode]);

  const src = useMemo(() => {
    if (!eventId) return null;

    return `https://widgets.sofascore.com/${locale}/embed/${mode}?id=${encodeURIComponent(
      eventId
    )}&widgetTheme=${encodeURIComponent(theme)}`;
  }, [eventId, locale, mode, theme]);

  if (loading) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-4 text-sm text-neutral-400",
          className
        )}
      >
        Ładowanie widgetu SofaScore...
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-4 text-sm text-yellow-200",
          className
        )}
      >
        Nie udało się załadować widgetu SofaScore: {error}
      </div>
    );
  }

  if (!src) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-4 text-sm text-neutral-500",
          className
        )}
      >
        Brak mapowania SofaScore dla tego meczu.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-neutral-800 bg-white",
        className
      )}
    >
      <iframe
        title={`SofaScore ${mode} ${eventId}`}
        src={src}
        width="100%"
        height={resolvedHeight}
        frameBorder="0"
        scrolling="no"
        loading="lazy"
        style={{
          border: 0,
          width: "100%",
          height: `${resolvedHeight}px`,
          display: "block",
          background: "#ffffff",
        }}
      />
    </div>
  );
}