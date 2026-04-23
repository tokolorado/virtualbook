// components/sofascore/SofaScoreEventWidget.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type SofaScoreEventWidgetMode = "lineups" | "attackMomentum" | "incidents";

type SofaScoreEventWidgetProps = {
  matchId: string | number;
  mode: SofaScoreEventWidgetMode;
  height?: number;
  theme?: "light" | "dark";
  locale?: string;
  className?: string;
};

type MappingResponse = {
  matchId?: string | number;
  sofascoreEventId?: string | number | null;
  mapped?: boolean;
  error?: string;
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function buildWidgetPath(mode: SofaScoreEventWidgetMode) {
  if (mode === "lineups") return "lineups";
  if (mode === "attackMomentum") return "attackMomentum";
  return "incidents";
}

function buildDefaultHeight(mode: SofaScoreEventWidgetMode) {
  if (mode === "lineups") return 786;
  if (mode === "attackMomentum") return 286;
  return 620;
}

function safeEventId(value: unknown): string | null {
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
  theme = "light",
  locale = "pl",
  className,
}: SofaScoreEventWidgetProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sofascoreEventId, setSofascoreEventId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      setLoading(true);
      setError(null);
      setSofascoreEventId(null);

      try {
        const response = await fetch(
          `/api/sofascore/mapping?matchId=${encodeURIComponent(String(matchId))}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          }
        );

        let json: MappingResponse | null = null;

        try {
          json = (await response.json()) as MappingResponse;
        } catch {
          json = null;
        }

        if (!response.ok) {
          throw new Error(json?.error || `Mapping fetch failed: ${response.status}`);
        }

        const mappedId = safeEventId(json?.sofascoreEventId);

        if (!json?.mapped || !mappedId) {
          throw new Error("Brak mapowania SofaScore dla tego meczu.");
        }

        if (!controller.signal.aborted) {
          setSofascoreEventId(mappedId);
        }
      } catch (e: unknown) {
        if (controller.signal.aborted) return;

        setError(
          e instanceof Error
            ? e.message
            : "Nie udało się pobrać mapowania SofaScore."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      controller.abort();
    };
  }, [matchId]);

  const widgetPath = buildWidgetPath(mode);
  const iframeHeight = height ?? buildDefaultHeight(mode);

  const src = useMemo(() => {
    if (!sofascoreEventId) return null;

    return `https://widgets.sofascore.com/${encodeURIComponent(
      locale
    )}/embed/${widgetPath}?id=${encodeURIComponent(
      sofascoreEventId
    )}&widgetTheme=${encodeURIComponent(theme)}`;
  }, [locale, sofascoreEventId, theme, widgetPath]);

  const matchUrl = useMemo(() => {
    if (!sofascoreEventId) return null;

    return `https://www.sofascore.com/${encodeURIComponent(
      locale
    )}/football/match/_/_#id:${encodeURIComponent(sofascoreEventId)}`;
  }, [locale, sofascoreEventId]);

  if (loading) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="rounded-3xl border border-neutral-800 bg-neutral-950 px-4 py-6 text-sm text-neutral-400">
          Ładowanie widgetu SofaScore…
        </div>
      </div>
    );
  }

  if (error || !src || !matchUrl) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="rounded-3xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-6 text-sm text-yellow-200">
          {error ?? "Widget SofaScore jest obecnie niedostępny."}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className={cn(
          "overflow-hidden rounded-3xl border border-neutral-800",
          theme === "light" ? "bg-white" : "bg-neutral-950"
        )}
      >
        <iframe
          title={`SofaScore ${mode} ${sofascoreEventId}`}
          src={src}
          width="100%"
          height={iframeHeight}
          frameBorder="0"
          scrolling="no"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>

      <div className="text-xs text-neutral-500">
        Dane osadzone z SofaScore.{" "}
        <a
          href={matchUrl}
          target="_blank"
          rel="noreferrer"
          className="text-neutral-300 underline underline-offset-4 hover:text-white"
        >
          Otwórz mecz w SofaScore
        </a>
      </div>
    </div>
  );
}