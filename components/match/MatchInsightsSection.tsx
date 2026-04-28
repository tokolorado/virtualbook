// components/match/MatchInsightsSection.tsx
"use client";

import SofaScoreEventWidget from "@/components/sofascore/SofaScoreEventWidget";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  getTableLegendZones,
  getTableZone,
  zoneLegendLabel,
  type TableZone,
} from "@/lib/matchCenter/tableZones";

type MatchInsightsSectionProps = {
  matchId: string | number;
  homeTeam: string;
  awayTeam: string;
  competitionCode?: string | null;
  matchStatus?: string | null;
  isLive?: boolean;
  isFinished?: boolean;
};

type TabKey =
  | "lineups"
  | "comparison"
  | "h2h"
  | "table"
  | "playoff"
  | "liveStats"
  | "momentum"
  | "timeline";

type LineupPlayer = {
  id: string;
  name: string;
  number: number | null;
  position: string | null;
  captain: boolean;
};

type LineupSide = {
  teamName: string;
  formation: string | null;
  status: string | null;
  coach: string | null;
  starters: LineupPlayer[];
  bench: LineupPlayer[];
};

type LineupsResponse = {
  home: LineupSide | null;
  away: LineupSide | null;
};

type StatLikeItem = {
  key: string;
  label: string;
  homeValue: string;
  awayValue: string;
  homeNumeric: number | null;
  awayNumeric: number | null;
  suffix: string;
};

type StatsSide = {
  teamId: number | null;
  teamName: string;
  stats: Record<string, number | null>;
};

type StatsResponse = {
  matchId: number | null;
  home: StatsSide | null;
  away: StatsSide | null;
  items: StatLikeItem[];
  updatedAt: string | null;
  source: string | null;
  upstreamStatus: number | null;
  message: string | null;
};

type ComparisonResponse = {
  matchId: number | null;
  items: StatLikeItem[];
  updatedAt: string | null;
};

type H2HSummary = {
  homeWins: number;
  draws: number;
  awayWins: number;
  totalMatches: number;
  homeGoals: number;
  awayGoals: number;
  bttsCount: number;
  over25Count: number;
};

type H2HMatch = {
  id: string;
  date: string | null;
  competition: string | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
};

type H2HResponse = {
  matchId: number | null;
  summary: H2HSummary | null;
  matches: H2HMatch[];
  updatedAt: string | null;
};

type TableCompetition = {
  id: string;
  name: string | null;
  season: string | null;
  matchday: number | null;
};

type TableTeam = {
  teamId: number | null;
  teamName: string;
};

type TableRow = {
  position: number;
  teamId: number | null;
  teamName: string;
  played: number | null;
  won: number | null;
  draw: number | null;
  lost: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  goalDiff: number | null;
  points: number | null;
};

type TableResponse = {
  matchId: number | null;
  available: boolean;
  reason: string | null;
  message: string | null;
  competition: TableCompetition | null;
  home: TableTeam | null;
  away: TableTeam | null;
  highlightTeamIds: number[];
  rows: TableRow[];
  updatedAt: string | null;
};

type TimelineItem = {
  id: string;
  minute: number | null;
  extraMinute: number | null;
  teamId: number | null;
  playerName: string | null;
  eventType: string;
  detail: string | null;
};

type TimelineResponse = {
  matchId: number | null;
  sofascoreEventId: number | null;
  externalUrl: string | null;
  items: TimelineItem[];
  updatedAt: string | null;
  source: string | null;
  message: string | null;
};

const AUTO_REFRESH_MS = 20_000;
const CHAMPIONS_LEAGUE_STANDINGS_URL =
  "https://widgets.sofascore.com/pl/embed/tournament/138314/season/76953/standings/UEFA%20Champions%20League%2025%2F26?widgetTitle=UEFA%20Champions%20League%2025%2F26&showCompetitionLogo=true&widgetTheme=dark";
const CHAMPIONS_LEAGUE_PLAYOFF_URL =
  "https://widgets.sofascore.com/pl/embed/unique-tournament/7/season/76953/cuptree/10850333?widgetTitle=UEFA Champions League 25/26, Knockout stage&showCompetitionLogo=true&widgetTheme=dark";

function normalizeMatchStatus(status?: string | null) {
  return String(status ?? "").toUpperCase();
}

function isChampionsLeagueCompetition(competitionCode?: string | null) {
  const normalized = String(competitionCode ?? "").trim().toUpperCase();

  return (
    normalized === "CL" ||
    normalized.includes("CHAMPIONS LEAGUE") ||
    normalized.includes("LIGA MISTRZ")
  );
}

function isPreMatchState(
  status?: string | null,
  isLive?: boolean,
  isFinished?: boolean
) {
  if (isLive) return false;
  if (isFinished) return false;

  const s = normalizeMatchStatus(status);

  if (!s) return true;

  return (
    s === "SCHEDULED" ||
    s === "TIMED" ||
    s === "NOT_STARTED" ||
    s === "PRE_MATCH"
  );
}

function canRenderLiveWidgets(
  status?: string | null,
  isLive?: boolean,
  isFinished?: boolean
) {
  if (isLive) return true;
  if (isFinished) return true;

  const s = normalizeMatchStatus(status);

  return (
    s === "LIVE" ||
    s === "IN_PLAY" ||
    s === "PAUSED" ||
    s === "HT" ||
    s === "2H" ||
    s === "EXTRA_TIME" ||
    s === "AET" ||
    s === "PENALTIES" ||
    s === "FINISHED"
  );
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function safeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeBoolean(value: unknown): boolean {
  return value === true;
}

function safeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => safeNumber(item))
    .filter((item): item is number => item !== null);
}

function formatDateTime(value: string | null): string {
  if (!value) return "Brak czasu aktualizacji";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleString();
}

function formatShortDate(value: string | null): string {
  if (!value) return "Brak daty";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleDateString();
}

function zonePalette(zone: TableZone) {
  if (zone === "champions") {
    return {
      border: "#4ade80",
      rowBg: "rgba(34, 197, 94, 0.16)",
      chipBg: "rgba(34, 197, 94, 0.14)",
      chipText: "#dcfce7",
      bubbleBg: "#4ade80",
      bubbleText: "#052e16",
    };
  }

  if (zone === "champions_qual") {
    return {
      border: "#22c55e",
      rowBg: "rgba(22, 163, 74, 0.16)",
      chipBg: "rgba(22, 163, 74, 0.14)",
      chipText: "#dcfce7",
      bubbleBg: "#22c55e",
      bubbleText: "#052e16",
    };
  }

  if (zone === "europa") {
    return {
      border: "#38bdf8",
      rowBg: "rgba(14, 165, 233, 0.16)",
      chipBg: "rgba(14, 165, 233, 0.14)",
      chipText: "#e0f2fe",
      bubbleBg: "#38bdf8",
      bubbleText: "#082f49",
    };
  }

  if (zone === "conference") {
    return {
      border: "#22d3ee",
      rowBg: "rgba(6, 182, 212, 0.16)",
      chipBg: "rgba(6, 182, 212, 0.14)",
      chipText: "#cffafe",
      bubbleBg: "#22d3ee",
      bubbleText: "#083344",
    };
  }

  if (zone === "relegation") {
    return {
      border: "#f87171",
      rowBg: "rgba(239, 68, 68, 0.16)",
      chipBg: "rgba(239, 68, 68, 0.14)",
      chipText: "#fee2e2",
      bubbleBg: "#f87171",
      bubbleText: "#450a0a",
    };
  }

  return null;
}

function zoneLegendStyle(zone: TableZone): CSSProperties {
  const palette = zonePalette(zone);

  if (!palette) {
    return {
      borderColor: "rgba(82, 82, 91, 1)",
      backgroundColor: "rgba(23, 23, 23, 0.45)",
      color: "#d4d4d8",
    };
  }

  return {
    borderColor: palette.border,
    backgroundColor: palette.chipBg,
    color: palette.chipText,
  };
}

function zonePositionStyle(zone: TableZone): CSSProperties {
  const palette = zonePalette(zone);

  if (!palette) {
    return {
      borderColor: "rgba(63, 63, 70, 1)",
      backgroundColor: "#0a0a0a",
      color: "#ffffff",
    };
  }

  return {
    borderColor: palette.border,
    backgroundColor: palette.bubbleBg,
    color: palette.bubbleText,
  };
}

function zoneRowStyle(zone: TableZone): CSSProperties {
  const palette = zonePalette(zone);

  if (!palette) return {};

  return {
    backgroundColor: palette.rowBg,
    boxShadow: `inset 4px 0 0 0 ${palette.border}`,
  };
}

function normalizePlayer(input: unknown, index: number): LineupPlayer {
  const row =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  return {
    id: safeString(row.id, `player-${index}`),
    name: safeString(row.name, "Nieznany zawodnik"),
    number: safeNumber(row.number),
    position: safeNullableString(row.position),
    captain: safeBoolean(row.captain),
  };
}

function normalizePlayers(input: unknown): LineupPlayer[] {
  if (!Array.isArray(input)) return [];
  return input.map((item, index) => normalizePlayer(item, index));
}

function normalizeSide(
  input: unknown,
  fallbackTeamName: string
): LineupSide | null {
  if (typeof input !== "object" || input === null) return null;

  const row = input as Record<string, unknown>;

  return {
    teamName: safeString(row.teamName, fallbackTeamName),
    formation: safeNullableString(row.formation),
    status: safeNullableString(row.status),
    coach: safeNullableString(row.coach),
    starters: normalizePlayers(row.starters),
    bench: normalizePlayers(row.bench),
  };
}

function normalizeLineupsResponse(
  input: unknown,
  homeTeam: string,
  awayTeam: string
): LineupsResponse {
  const row =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  return {
    home: normalizeSide(row.home, homeTeam),
    away: normalizeSide(row.away, awayTeam),
  };
}

function normalizeStatsSide(
  input: unknown,
  fallbackTeamName: string
): StatsSide | null {
  if (typeof input !== "object" || input === null) return null;

  const row = input as Record<string, unknown>;
  const statsRaw =
    typeof row.stats === "object" && row.stats !== null
      ? (row.stats as Record<string, unknown>)
      : {};

  const stats: Record<string, number | null> = {};

  for (const [key, value] of Object.entries(statsRaw)) {
    stats[key] = safeNumber(value);
  }

  return {
    teamId: safeNumber(row.teamId),
    teamName: safeString(row.teamName, fallbackTeamName),
    stats,
  };
}

function normalizeStatLikeItem(input: unknown): StatLikeItem {
  const row =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  const homeNumeric = safeNumber(row.homeNumeric);
  const awayNumeric = safeNumber(row.awayNumeric);
  const suffix = safeString(row.suffix);

  return {
    key: safeString(row.key, "unknown"),
    label: safeString(row.label, "Statystyka"),
    homeValue:
      safeString(row.homeValue) ||
      (homeNumeric !== null ? `${homeNumeric}${suffix}` : "—"),
    awayValue:
      safeString(row.awayValue) ||
      (awayNumeric !== null ? `${awayNumeric}${suffix}` : "—"),
    homeNumeric,
    awayNumeric,
    suffix,
  };
}

function normalizeStatsResponse(
  input: unknown,
  homeTeam: string,
  awayTeam: string
): StatsResponse {
  const row =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  return {
    matchId: safeNumber(row.matchId),
    home: normalizeStatsSide(row.home, homeTeam),
    away: normalizeStatsSide(row.away, awayTeam),
    items: Array.isArray(row.items) ? row.items.map(normalizeStatLikeItem) : [],
    updatedAt: safeNullableString(row.updatedAt),
    source: safeNullableString(row.source),
    upstreamStatus: safeNumber(row.upstreamStatus),
    message: safeNullableString(row.message),
  };
}

function normalizeComparisonResponse(input: unknown): ComparisonResponse {
  const row =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  return {
    matchId: safeNumber(row.matchId),
    items: Array.isArray(row.items) ? row.items.map(normalizeStatLikeItem) : [],
    updatedAt: safeNullableString(row.updatedAt),
  };
}

function normalizeH2HSummary(input: unknown): H2HSummary | null {
  if (typeof input !== "object" || input === null) return null;

  const row = input as Record<string, unknown>;

  return {
    homeWins: safeNumber(row.homeWins) ?? 0,
    draws: safeNumber(row.draws) ?? 0,
    awayWins: safeNumber(row.awayWins) ?? 0,
    totalMatches: safeNumber(row.totalMatches) ?? 0,
    homeGoals: safeNumber(row.homeGoals) ?? 0,
    awayGoals: safeNumber(row.awayGoals) ?? 0,
    bttsCount: safeNumber(row.bttsCount) ?? 0,
    over25Count: safeNumber(row.over25Count) ?? 0,
  };
}

function normalizeH2HMatch(input: unknown, index: number): H2HMatch {
  const row =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  return {
    id: safeString(row.id, `h2h-${index}`),
    date: safeNullableString(row.date),
    competition: safeNullableString(row.competition),
    homeTeam: safeString(row.homeTeam, "Gospodarze"),
    awayTeam: safeString(row.awayTeam, "Goście"),
    homeScore: safeNumber(row.homeScore),
    awayScore: safeNumber(row.awayScore),
  };
}

function normalizeH2HResponse(input: unknown): H2HResponse {
  const row =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  return {
    matchId: safeNumber(row.matchId),
    summary: normalizeH2HSummary(row.summary),
    matches: Array.isArray(row.matches)
      ? row.matches.map(normalizeH2HMatch)
      : [],
    updatedAt: safeNullableString(row.updatedAt),
  };
}

function normalizeTableCompetition(input: unknown): TableCompetition | null {
  if (typeof input !== "object" || input === null) return null;

  const row = input as Record<string, unknown>;

  return {
    id: safeString(row.id),
    name: safeNullableString(row.name),
    season: safeNullableString(row.season),
    matchday: safeNumber(row.matchday),
  };
}

function normalizeTableTeam(
  input: unknown,
  fallbackTeamName: string
): TableTeam | null {
  if (typeof input !== "object" || input === null) return null;

  const row = input as Record<string, unknown>;

  return {
    teamId: safeNumber(row.teamId),
    teamName: safeString(row.teamName, fallbackTeamName),
  };
}

function normalizeTableRow(input: unknown): TableRow {
  const row =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  return {
    position: safeNumber(row.position) ?? 0,
    teamId: safeNumber(row.teamId),
    teamName: safeString(row.teamName, "Nieznana drużyna"),
    played: safeNumber(row.played),
    won: safeNumber(row.won),
    draw: safeNumber(row.draw),
    lost: safeNumber(row.lost),
    goalsFor: safeNumber(row.goalsFor),
    goalsAgainst: safeNumber(row.goalsAgainst),
    goalDiff: safeNumber(row.goalDiff),
    points: safeNumber(row.points),
  };
}

function normalizeTableResponse(
  input: unknown,
  homeTeam: string,
  awayTeam: string
): TableResponse {
  const row =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  return {
    matchId: safeNumber(row.matchId),
    available: safeBoolean(row.available),
    reason: safeNullableString(row.reason),
    message: safeNullableString(row.message),
    competition: normalizeTableCompetition(row.competition),
    home: normalizeTableTeam(row.home, homeTeam),
    away: normalizeTableTeam(row.away, awayTeam),
    highlightTeamIds: safeNumberArray(row.highlightTeamIds),
    rows: Array.isArray(row.rows) ? row.rows.map(normalizeTableRow) : [],
    updatedAt: safeNullableString(row.updatedAt),
  };
}

function normalizeTimelineItem(input: unknown, index: number): TimelineItem {
  const row =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  return {
    id: safeString(row.id, `timeline-${index}`),
    minute: safeNumber(row.minute),
    extraMinute: safeNumber(row.extraMinute),
    teamId: safeNumber(row.teamId),
    playerName: safeNullableString(row.playerName),
    eventType: safeString(row.eventType, "event"),
    detail: safeNullableString(row.detail),
  };
}

function normalizeTimelineResponse(input: unknown): TimelineResponse {
  const row =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  return {
    matchId: safeNumber(row.matchId),
    sofascoreEventId: safeNumber(row.sofascoreEventId),
    externalUrl: safeNullableString(row.externalUrl),
    items: Array.isArray(row.items) ? row.items.map(normalizeTimelineItem) : [],
    updatedAt: safeNullableString(row.updatedAt),
    source: safeNullableString(row.source),
    message: safeNullableString(row.message),
  };
}

function statusLabel(status: string | null): string {
  const value = (status ?? "").toLowerCase();

  if (value === "confirmed") return "Potwierdzony";
  if (value === "predicted") return "Przewidywany";
  if (value === "available") return "Dostępny";

  return status ?? "Brak statusu";
}

function positionLabel(position: string | null): string {
  if (!position) return "—";
  return position.toUpperCase();
}

function numberDisplay(value: number | null): string {
  return value === null ? "—" : String(value);
}

function formatTimelineMinute(item: TimelineItem) {
  if (item.minute === null) return "—";
  if (item.extraMinute !== null && item.extraMinute > 0) {
    return `${item.minute}+${item.extraMinute}'`;
  }
  return `${item.minute}'`;
}

function timelineEventLabel(eventType: string) {
  const key = eventType.trim().toLowerCase();

  if (key === "goal") return "Gol";
  if (key === "card" || key === "yellow_card") return "Kartka";
  if (key === "red_card") return "Czerwona kartka";
  if (key === "substitution") return "Zmiana";
  if (key === "period") return "Faza meczu";
  if (key === "var") return "VAR";

  return eventType || "Zdarzenie";
}

function Surface({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-neutral-800 bg-neutral-900/40",
        className
      )}
    >
      {children}
    </div>
  );
}

function StatusChip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "red" | "green" | "yellow";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
        tone === "neutral" &&
          "border-neutral-800 bg-neutral-950 text-neutral-300",
        tone === "blue" && "border-sky-500/30 bg-sky-500/10 text-sky-300",
        tone === "red" && "border-red-500/30 bg-red-500/10 text-red-300",
        tone === "green" &&
          "border-green-500/30 bg-green-500/10 text-green-300",
        tone === "yellow" &&
          "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
      )}
    >
      {children}
    </span>
  );
}

function StateBox({
  title,
  description,
  tone = "neutral",
  action,
}: {
  title: string;
  description: string;
  tone?: "neutral" | "error";
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-6 py-8 text-sm",
        tone === "error"
          ? "border-red-500/20 bg-red-500/10 text-red-200"
          : "border-neutral-800 bg-neutral-950 text-neutral-400"
      )}
    >
      <div className="font-medium">{title}</div>
      <div className="mt-2">{description}</div>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function SofaScoreStaticWidget({
  title,
  src,
  height,
  cropBottomPx = 0,
  scrolling,
}: {
  title: string;
  src: string;
  height: number;
  cropBottomPx?: number;
  scrolling: "yes" | "no";
}) {
  const visibleHeight = Math.max(height - cropBottomPx, 120);
  const frameStyle: CSSProperties = {
    height: visibleHeight,
  };

  return (
    <div className="space-y-2">
      <div
        className="w-full overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950"
        style={frameStyle}
      >
        <iframe
          id={title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
          title={title}
          src={src}
          width="100%"
          height={height}
          frameBorder="0"
          scrolling={scrolling}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    </div>
  );
}

function InlineWarning({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
      {message}
    </div>
  );
}

function WidgetTroubleshooting({
  title = "Skład się nie wyświetla?",
}: {
  title?: string;
}) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-neutral-900 [&::-webkit-details-marker]:hidden">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-neutral-700 text-[11px] font-bold text-neutral-300">
          i
        </span>
        <span>{title}</span>
      </summary>

      <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-4 text-sm text-neutral-400">
        <div className="font-medium text-white">Najczęstsze przyczyny:</div>

        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li>SofaScore nie opublikował jeszcze składu albo widżetu dla tego meczu.</li>
          <li>Masz włączony VPN, proxy, AdBlock albo restrykcyjną ochronę prywatności.</li>
          <li>Widżet został chwilowo ograniczony lub nie załadował się po stronie zewnętrznej.</li>
        </ul>

        <div className="mt-3">
          Spróbuj wyłączyć VPN lub proxy, odświeżyć stronę, sprawdzić inną sieć
          albo wrócić bliżej rozpoczęcia meczu.
        </div>
      </div>
    </details>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-2xl border px-4 py-2.5 text-sm font-semibold transition",
        active
          ? "border-sky-500 bg-sky-500/15 text-sky-300"
          : "border-neutral-800 bg-neutral-950 text-white hover:bg-neutral-900"
      )}
    >
      {label}
    </button>
  );
}

function PlayerRow({ player }: { player: LineupPlayer }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 px-3 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-white">
          {player.name}
          {player.captain ? (
            <span className="ml-2 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-semibold text-yellow-300">
              C
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-xs text-neutral-400">
          {positionLabel(player.position)}
        </div>
      </div>

      <div className="shrink-0 rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs font-semibold text-neutral-300">
        {player.number ?? "—"}
      </div>
    </div>
  );
}

function PlayersBlock({
  title,
  players,
  emptyLabel,
}: {
  title: string;
  players: LineupPlayer[];
  emptyLabel: string;
}) {
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-white">{title}</div>

      {players.length > 0 ? (
        <div className="space-y-2">
          {players.map((player) => (
            <PlayerRow key={player.id} player={player} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950 px-4 py-4 text-sm text-neutral-500">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}

function SideCard({
  side,
  fallbackTeamName,
}: {
  side: LineupSide | null;
  fallbackTeamName: string;
}) {
  const teamName = side?.teamName ?? fallbackTeamName;

  return (
    <Surface className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold text-white">{teamName}</div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <StatusChip>
              Ustawienie:{" "}
              <span className="ml-1 font-semibold text-white">
                {side?.formation ?? "—"}
              </span>
            </StatusChip>

            <StatusChip>
              Status:{" "}
              <span className="ml-1 font-semibold text-white">
                {statusLabel(side?.status ?? null)}
              </span>
            </StatusChip>

            <StatusChip>
              Trener:{" "}
              <span className="ml-1 font-semibold text-white">
                {side?.coach ?? "—"}
              </span>
            </StatusChip>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <PlayersBlock
          title="Wyjściowa jedenastka"
          players={side?.starters ?? []}
          emptyLabel="Brak zapisanych zawodników w pierwszym składzie."
        />

        <PlayersBlock
          title="Ławka"
          players={side?.bench ?? []}
          emptyLabel="Brak zapisanych zawodników na ławce."
        />
      </div>
    </Surface>
  );
}

function normalizeFormString(value: string) {
  return value.replace(/[^A-Za-z]/g, "").toUpperCase();
}

function isFormComparisonItem(item: StatLikeItem) {
  const key = item.key.toLowerCase();
  const label = item.label.toLowerCase();

  const homeForm = normalizeFormString(item.homeValue);
  const awayForm = normalizeFormString(item.awayValue);

  const bothLookLikeForm =
    homeForm.length > 0 &&
    awayForm.length > 0 &&
    /^[WDLRP]+$/.test(homeForm) &&
    /^[WDLRP]+$/.test(awayForm);

  return (
    key.includes("form") ||
    label.includes("forma") ||
    label.includes("form") ||
    bothLookLikeForm
  );
}

function formScore(value: string): number | null {
  const normalized = normalizeFormString(value);

  if (!normalized || !/^[WDLRP]+$/.test(normalized)) {
    return null;
  }

  return normalized.split("").reduce((sum, char) => {
    if (char === "W") return sum + 3;
    if (char === "D" || char === "R") return sum + 1;
    if (char === "L" || char === "P") return sum;
    return sum;
  }, 0);
}

function readComparableNumber(
  numericValue: number | null,
  displayValue: string
): number | null {
  if (numericValue !== null && Number.isFinite(numericValue)) {
    return numericValue;
  }

  const normalized = displayValue.replace(/\s+/g, "").replace(",", ".");
  const match = normalized.match(/[+-]?\d+(?:\.\d+)?/);

  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitMetricPercentages(homeValue: number, awayValue: number) {
  if (homeValue === awayValue) {
    return {
      homePercent: 50,
      awayPercent: 50,
    };
  }

  const minValue = Math.min(homeValue, awayValue);

  if (minValue < 0) {
    const shift = Math.abs(minValue);
    const homeScore = homeValue + shift;
    const awayScore = awayValue + shift;
    const total = homeScore + awayScore;

    if (total > 0) {
      return {
        homePercent: (homeScore / total) * 100,
        awayPercent: (awayScore / total) * 100,
      };
    }

    return homeValue > awayValue
      ? { homePercent: 100, awayPercent: 0 }
      : { homePercent: 0, awayPercent: 100 };
  }

  const total = homeValue + awayValue;

  if (total > 0) {
    return {
      homePercent: (homeValue / total) * 100,
      awayPercent: (awayValue / total) * 100,
    };
  }

  return homeValue > awayValue
    ? { homePercent: 100, awayPercent: 0 }
    : { homePercent: 0, awayPercent: 100 };
}

function resolveStatBarPercentages(item: StatLikeItem) {
  if (isFormComparisonItem(item)) {
    const homeFormScore = formScore(item.homeValue);
    const awayFormScore = formScore(item.awayValue);

    if (homeFormScore !== null && awayFormScore !== null) {
      return splitMetricPercentages(homeFormScore, awayFormScore);
    }
  }

  const homeValue = readComparableNumber(item.homeNumeric, item.homeValue);
  const awayValue = readComparableNumber(item.awayNumeric, item.awayValue);

  if (homeValue !== null && awayValue !== null) {
    return splitMetricPercentages(homeValue, awayValue);
  }

  return {
    homePercent: 50,
    awayPercent: 50,
  };
}

function StatBarRow({ item }: { item: StatLikeItem }) {
  const { homePercent, awayPercent } = resolveStatBarPercentages(item);

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-base font-semibold text-white">{item.homeValue}</div>
        <div className="text-center text-xs font-medium uppercase tracking-wide text-neutral-400">
          {item.label}
        </div>
        <div className="text-base font-semibold text-white">{item.awayValue}</div>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="h-3 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="h-full rounded-full bg-sky-500"
            style={{ width: `${homePercent}%` }}
          />
        </div>

        <div className="text-xs font-semibold text-neutral-500">
          {Math.round(homePercent)}% / {Math.round(awayPercent)}%
        </div>

        <div className="h-3 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="ml-auto h-full rounded-full bg-neutral-200"
            style={{ width: `${awayPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function H2HSummaryCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function H2HMatchRow({ match }: { match: H2HMatch }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="text-sm text-neutral-500">
            {match.competition ?? "H2H"} • {formatShortDate(match.date)}
          </div>
          <div className="mt-1 text-sm font-medium text-white">
            {match.homeTeam} vs {match.awayTeam}
          </div>
        </div>

        <div className="shrink-0 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm font-semibold text-white">
          {numberDisplay(match.homeScore)} : {numberDisplay(match.awayScore)}
        </div>
      </div>
    </div>
  );
}

function TableRowHighlightBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
      {label}
    </span>
  );
}

function TableLegendChip({ zone }: { zone: Exclude<TableZone, null> }) {
  return (
    <span
      className="rounded-full border px-3 py-1 text-xs font-semibold"
      style={zoneLegendStyle(zone)}
    >
      {zoneLegendLabel(zone)}
    </span>
  );
}

export default function MatchInsightsSection({
  matchId,
  homeTeam,
  awayTeam,
  competitionCode,
  matchStatus,
  isLive,
  isFinished,
}: MatchInsightsSectionProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("lineups");
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const [lineupsWidgetMapped, setLineupsWidgetMapped] = useState<boolean | null>(
    null
  );
  const [lineupsWidgetLoaded, setLineupsWidgetLoaded] = useState(false);

  const [lineupsLoading, setLineupsLoading] = useState(true);
  const [lineupsError, setLineupsError] = useState<string | null>(null);
  const [lineups, setLineups] = useState<LineupsResponse | null>(null);

  const [liveStatsLoading, setLiveStatsLoading] = useState(true);
  const [liveStatsError, setLiveStatsError] = useState<string | null>(null);
  const [liveStats, setLiveStats] = useState<StatsResponse | null>(null);

  const [comparisonLoading, setComparisonLoading] = useState(true);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null);

  const [h2hLoading, setH2HLoading] = useState(true);
  const [h2hError, setH2HError] = useState<string | null>(null);
  const [h2h, setH2H] = useState<H2HResponse | null>(null);

  const [tableLoading, setTableLoading] = useState(true);
  const [tableError, setTableError] = useState<string | null>(null);
  const [table, setTable] = useState<TableResponse | null>(null);

  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);

  const subtitle = useMemo(() => {
    const league = competitionCode?.trim() ? ` • ${competitionCode}` : "";
    return `Sekcja informacyjna dla meczu ${homeTeam} vs ${awayTeam}${league}.`;
  }, [competitionCode, homeTeam, awayTeam]);

  const isPreMatch = useMemo(() => {
    return isPreMatchState(matchStatus, isLive, isFinished);
  }, [matchStatus, isLive, isFinished]);

  const liveWidgetsAvailable = useMemo(() => {
    return canRenderLiveWidgets(matchStatus, isLive, isFinished);
  }, [matchStatus, isLive, isFinished]);

  const championsLeague = useMemo(() => {
    return isChampionsLeagueCompetition(competitionCode);
  }, [competitionCode]);

  const visibleTabs = useMemo(() => {
    const withChampionsLeagueTabs = <
      T extends Array<{ key: TabKey; label: string }>,
    >(
      tabs: T
    ) => {
      if (!championsLeague) return tabs;

      const tableIndex = tabs.findIndex((tab) => tab.key === "table");
      if (tableIndex === -1) {
        return [...tabs, { key: "playoff" as const, label: "Play-off" }];
      }

      return [
        ...tabs.slice(0, tableIndex + 1),
        { key: "playoff" as const, label: "Play-off" },
        ...tabs.slice(tableIndex + 1),
      ];
    };

    if (isPreMatch) {
      return withChampionsLeagueTabs([
        { key: "lineups" as const, label: "Składy" },
        { key: "comparison" as const, label: "Porównanie" },
        { key: "h2h" as const, label: "H2H" },
        { key: "table" as const, label: "Tabela" },
      ]);
    }

    if (isLive) {
      return withChampionsLeagueTabs([
        { key: "lineups" as const, label: "Składy" },
        { key: "liveStats" as const, label: "Statystyki" },
        { key: "table" as const, label: "Tabela" },
        { key: "momentum" as const, label: "Momentum" },
        { key: "timeline" as const, label: "Timeline" },
      ]);
    }

    return withChampionsLeagueTabs([
      { key: "lineups" as const, label: "Składy" },
      { key: "liveStats" as const, label: "Statystyki" },
      { key: "table" as const, label: "Tabela" },
      { key: "timeline" as const, label: "Timeline" },
    ]);
  }, [isPreMatch, isLive, championsLeague]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      setRefreshTick((v) => v + 1);
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(id);
  }, [matchId]);

  useEffect(() => {
    setLineupsWidgetMapped(null);
    setLineupsWidgetLoaded(false);
  }, [matchId]);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(visibleTabs[0].key);
    }
  }, [activeTab, visibleTabs]);

  useEffect(() => {
    const controller = new AbortController();
    const isBackgroundRefresh = refreshTick > 0;

    const loadLineups = async () => {
      if (!isBackgroundRefresh || !lineups) {
        setLineupsLoading(true);
      }

      setLineupsError(null);

      if (!isBackgroundRefresh) {
        setLineups(null);
      }

      try {
        const response = await fetch(
          `/api/match-center/lineups?matchId=${encodeURIComponent(String(matchId))}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Lineups fetch failed: ${response.status}`);
        }

        const json: unknown = await response.json();
        const normalized = normalizeLineupsResponse(json, homeTeam, awayTeam);

        if (!controller.signal.aborted) {
          setLineups(normalized);
        }
      } catch (error) {
        if (controller.signal.aborted) return;

        const message =
          error instanceof Error ? error.message : "Błąd ładowania składów.";

        setLineupsError(message);
      } finally {
        if (!controller.signal.aborted) {
          setLineupsLoading(false);
        }
      }
    };

    const loadLiveStats = async () => {
      if (isPreMatch) {
        setLiveStats(null);
        setLiveStatsError(null);
        setLiveStatsLoading(false);
        return;
      }

      if (!isBackgroundRefresh || !liveStats) {
        setLiveStatsLoading(true);
      }

      setLiveStatsError(null);

      if (!isBackgroundRefresh) {
        setLiveStats(null);
      }

      try {
        const response = await fetch(
          `/api/match-center/stats?matchId=${encodeURIComponent(String(matchId))}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Stats fetch failed: ${response.status}`);
        }

        const json: unknown = await response.json();
        const normalized = normalizeStatsResponse(json, homeTeam, awayTeam);

        if (!controller.signal.aborted) {
          setLiveStats(normalized);
        }
      } catch (error) {
        if (controller.signal.aborted) return;

        const message =
          error instanceof Error ? error.message : "Błąd ładowania statystyk.";

        setLiveStatsError(message);
      } finally {
        if (!controller.signal.aborted) {
          setLiveStatsLoading(false);
        }
      }
    };

    const loadComparison = async () => {
      if (!isPreMatch) {
        setComparison(null);
        setComparisonError(null);
        setComparisonLoading(false);
        return;
      }

      if (!isBackgroundRefresh || !comparison) {
        setComparisonLoading(true);
      }

      setComparisonError(null);

      if (!isBackgroundRefresh) {
        setComparison(null);
      }

      try {
        const response = await fetch(
          `/api/match-center/comparison?matchId=${encodeURIComponent(String(matchId))}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Comparison fetch failed: ${response.status}`);
        }

        const json: unknown = await response.json();
        const normalized = normalizeComparisonResponse(json);

        if (!controller.signal.aborted) {
          setComparison(normalized);
        }
      } catch (error) {
        if (controller.signal.aborted) return;

        const message =
          error instanceof Error ? error.message : "Błąd ładowania porównania.";

        setComparisonError(message);
      } finally {
        if (!controller.signal.aborted) {
          setComparisonLoading(false);
        }
      }
    };

    const loadH2H = async () => {
      if (!isPreMatch) {
        setH2H(null);
        setH2HError(null);
        setH2HLoading(false);
        return;
      }

      if (!isBackgroundRefresh || !h2h) {
        setH2HLoading(true);
      }

      setH2HError(null);

      if (!isBackgroundRefresh) {
        setH2H(null);
      }

      try {
        const response = await fetch(
          `/api/match-center/h2h?matchId=${encodeURIComponent(String(matchId))}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`H2H fetch failed: ${response.status}`);
        }

        const json: unknown = await response.json();
        const normalized = normalizeH2HResponse(json);

        if (!controller.signal.aborted) {
          setH2H(normalized);
        }
      } catch (error) {
        if (controller.signal.aborted) return;

        const message =
          error instanceof Error ? error.message : "Błąd ładowania H2H.";

        setH2HError(message);
      } finally {
        if (!controller.signal.aborted) {
          setH2HLoading(false);
        }
      }
    };

    const loadTable = async () => {
      if (championsLeague) {
        setTable(null);
        setTableError(null);
        setTableLoading(false);
        return;
      }

      if (!isBackgroundRefresh || !table) {
        setTableLoading(true);
      }

      setTableError(null);

      if (!isBackgroundRefresh) {
        setTable(null);
      }

      try {
        const response = await fetch(
          `/api/match-center/table?matchId=${encodeURIComponent(String(matchId))}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Table fetch failed: ${response.status}`);
        }

        const json: unknown = await response.json();
        const normalized = normalizeTableResponse(json, homeTeam, awayTeam);

        if (!controller.signal.aborted) {
          setTable(normalized);
        }
      } catch (error) {
        if (controller.signal.aborted) return;

        const message =
          error instanceof Error ? error.message : "Błąd ładowania tabeli.";

        setTableError(message);
      } finally {
        if (!controller.signal.aborted) {
          setTableLoading(false);
        }
      }
    };

    const loadTimeline = async () => {
      if (isPreMatch) {
        setTimeline(null);
        setTimelineError(null);
        setTimelineLoading(false);
        return;
      }

      if (!isBackgroundRefresh || !timeline) {
        setTimelineLoading(true);
      }

      setTimelineError(null);

      if (!isBackgroundRefresh) {
        setTimeline(null);
      }

      try {
        const response = await fetch(
          `/api/match-center/timeline?matchId=${encodeURIComponent(String(matchId))}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Timeline fetch failed: ${response.status}`);
        }

        const json: unknown = await response.json();
        const normalized = normalizeTimelineResponse(json);

        if (!controller.signal.aborted) {
          setTimeline(normalized);
        }
      } catch (error) {
        if (controller.signal.aborted) return;

        const message =
          error instanceof Error ? error.message : "Błąd ładowania timeline.";

        setTimelineError(message);
      } finally {
        if (!controller.signal.aborted) {
          setTimelineLoading(false);
        }
      }
    };

    void Promise.all([
      loadLineups(),
      loadLiveStats(),
      loadComparison(),
      loadH2H(),
      loadTable(),
      loadTimeline(),
    ]).then(() => {
      if (!controller.signal.aborted) {
        setLastRefreshedAt(new Date().toISOString());
      }
    });

    return () => {
      controller.abort();
    };
    // Background refresh intentionally uses the current data snapshot
    // without retriggering the whole fetch cycle after every response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, homeTeam, awayTeam, refreshTick, isPreMatch, championsLeague]);

  const sortedTableRows = useMemo(() => {
    return [...(table?.rows ?? [])].sort((a, b) => a.position - b.position);
  }, [table]);

  const highlightSet = useMemo(() => {
    return new Set(table?.highlightTeamIds ?? []);
  }, [table]);

  const tableLegendZones = useMemo(() => {
    return getTableLegendZones(
      table?.competition?.id ?? null,
      table?.competition?.season ?? null
    );
  }, [table]);

  const isRefreshing =
    (lineupsLoading && !!lineups) ||
    (liveStatsLoading && !!liveStats) ||
    (comparisonLoading && !!comparison) ||
    (h2hLoading && !!h2h) ||
    (tableLoading && !!table) ||
    (timelineLoading && !!timeline);

  const meaningfulLiveStatsItems = useMemo(() => {
    return (liveStats?.items ?? []).filter((item) => {
      const hasNumeric =
        (item.homeNumeric !== null && item.homeNumeric > 0) ||
        (item.awayNumeric !== null && item.awayNumeric > 0);

      const hasDisplayValue = item.homeValue !== "—" || item.awayValue !== "—";

      return hasNumeric || hasDisplayValue;
    });
  }, [liveStats]);

  const meaningfulComparisonItems = useMemo(() => {
    return (comparison?.items ?? []).filter((item) => {
      const hasNumeric = item.homeNumeric !== null || item.awayNumeric !== null;

      const hasDisplayValue = item.homeValue !== "—" || item.awayValue !== "—";

      return hasNumeric || hasDisplayValue;
    });
  }, [comparison]);

  const renderLineups = () => {
    const hasData = !!lineups?.home || !!lineups?.away;
    const showWidgetFallback = !hasData;
    const showLineupsInfoBox =
      showWidgetFallback &&
      lineupsWidgetLoaded !== true &&
      lineupsWidgetMapped !== true;

    if (lineupsLoading && !hasData) {
      return (
        <StateBox
          title="Ładowanie składów..."
          description="Pobieramy aktualne informacje o wyjściowych składach i ławkach rezerwowych."
        />
      );
    }

    if (showWidgetFallback) {
      return (
        <div className="space-y-4">
          {showLineupsInfoBox ? (
            lineupsError ? (
              <InlineWarning message="Nie udało się pobrać składów z naszej bazy. Próbujemy załadować widget SofaScore." />
            ) : (
              <StateBox
                title="Brak danych o składach w naszej bazie"
                description={
                  isPreMatch
                    ? "Przed meczem próbujemy załadować przewidywane albo oficjalne składy bezpośrednio z widgetu SofaScore."
                    : "Poniżej próbujemy załadować skład bezpośrednio z widgetu SofaScore."
                }
              />
            )
          ) : null}

          <SofaScoreEventWidget
            matchId={matchId}
            mode="lineups"
            height={786}
            theme="dark"
            cropInternalFooter
            cropBottomPx={120}
            hideExternalLink
            onMappingResolved={setLineupsWidgetMapped}
            onLoaded={setLineupsWidgetLoaded}
          />

          {!lineupsWidgetLoaded ? (
            <WidgetTroubleshooting title="Skład się nie wyświetla?" />
          ) : null}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {lineupsError ? (
          <InlineWarning message="Nie udało się odświeżyć składów. Pokazujemy ostatnio pobrane dane." />
        ) : null}

        <div className="grid gap-4 xl:grid-cols-2">
          <SideCard side={lineups?.home ?? null} fallbackTeamName={homeTeam} />
          <SideCard side={lineups?.away ?? null} fallbackTeamName={awayTeam} />
        </div>
      </div>
    );
  };

  const renderComparison = () => {
    const hasData = meaningfulComparisonItems.length > 0;

    if (comparisonLoading && !hasData) {
      return (
        <StateBox
          title="Ładowanie porównania..."
          description="Pobieramy przedmeczowe porównanie obu drużyn."
        />
      );
    }

    if (!hasData && comparisonError) {
      return (
        <StateBox
          title="Nie udało się załadować porównania"
          description={comparisonError}
          tone="error"
        />
      );
    }

    if (!hasData) {
      return (
        <StateBox
          title="Brak danych porównawczych"
          description="Dla tego meczu nie ma jeszcze dostępnego porównania przedmeczowego."
        />
      );
    }

    return (
      <div className="space-y-4">
        {comparisonError ? (
          <InlineWarning message="Nie udało się odświeżyć porównania. Pokazujemy ostatnio pobrane dane." />
        ) : null}

        <Surface className="px-4 py-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-neutral-400">
              Porównanie:{" "}
              <span className="font-semibold text-white">{homeTeam}</span> vs{" "}
              <span className="font-semibold text-white">{awayTeam}</span>
            </div>

            <div className="text-xs text-neutral-500">
              {formatDateTime(comparison?.updatedAt ?? null)}
            </div>
          </div>
        </Surface>

        <div className="space-y-3">
          {meaningfulComparisonItems.map((item) => (
            <StatBarRow key={item.key} item={item} />
          ))}
        </div>
      </div>
    );
  };

  const renderH2H = () => {
    const hasData =
      (h2h?.matches?.length ?? 0) > 0 || (h2h?.summary?.totalMatches ?? 0) > 0;

    if (h2hLoading && !hasData) {
      return (
        <StateBox
          title="Ładowanie H2H..."
          description="Pobieramy ostatnie bezpośrednie mecze i bilans obu drużyn."
        />
      );
    }

    if (!hasData && h2hError) {
      return (
        <StateBox
          title="Nie udało się załadować H2H"
          description={h2hError}
          tone="error"
        />
      );
    }

    if (!hasData) {
      return (
        <StateBox
          title="Brak danych H2H"
          description="Dla tego meczu nie ma obecnie dostępnych danych head-to-head."
        />
      );
    }

    return (
      <div className="space-y-4">
        {h2hError ? (
          <InlineWarning message="Nie udało się odświeżyć H2H. Pokazujemy ostatnio pobrane dane." />
        ) : null}

        {(h2h?.summary?.totalMatches ?? 0) > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <H2HSummaryCard
              label={`${homeTeam} wygrane`}
              value={h2h?.summary?.homeWins ?? 0}
            />
            <H2HSummaryCard label="Remisy" value={h2h?.summary?.draws ?? 0} />
            <H2HSummaryCard
              label={`${awayTeam} wygrane`}
              value={h2h?.summary?.awayWins ?? 0}
            />
            <H2HSummaryCard
              label="Liczba meczów"
              value={h2h?.summary?.totalMatches ?? 0}
            />
            <H2HSummaryCard
              label="Bramki łącznie"
              value={`${h2h?.summary?.homeGoals ?? 0}:${h2h?.summary?.awayGoals ?? 0}`}
            />
            <H2HSummaryCard label="BTTS" value={h2h?.summary?.bttsCount ?? 0} />
            <H2HSummaryCard
              label="Over 2.5"
              value={h2h?.summary?.over25Count ?? 0}
            />
            <H2HSummaryCard
              label="Aktualizacja"
              value={formatDateTime(h2h?.updatedAt ?? null)}
            />
          </div>
        ) : null}

        {(h2h?.matches?.length ?? 0) > 0 ? (
          <Surface className="p-4">
            <div className="text-lg font-semibold text-white">
              Ostatnie mecze H2H
            </div>
            <div className="mt-4 space-y-3">
              {h2h?.matches.map((match) => (
                <H2HMatchRow key={match.id} match={match} />
              ))}
            </div>
          </Surface>
        ) : null}
      </div>
    );
  };

  const renderLiveStats = () => {
    const hasData = meaningfulLiveStatsItems.length > 0;

    if (liveStatsLoading && !hasData) {
      return (
        <StateBox
          title="Ładowanie statystyk..."
          description="Pobieramy najważniejsze liczby meczowe dla obu drużyn."
        />
      );
    }

    if (!hasData && liveStatsError) {
      return (
        <StateBox
          title="Nie udało się załadować statystyk"
          description={liveStatsError}
          tone="error"
        />
      );
    }

    if (!hasData) {
      return (
        <StateBox
          title="Brak statystyk meczowych"
          description={
            liveStats?.message ??
            "Statystyki meczowe pojawią się, gdy dostawca udostępni dane dla trwającego lub zakończonego spotkania."
          }
        />
      );
    }

    return (
      <div className="space-y-4">
        {liveStatsError ? (
          <InlineWarning message="Nie udało się odświeżyć statystyk. Pokazujemy ostatnio pobrane dane." />
        ) : null}

        <Surface className="px-4 py-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-neutral-400">
              Statystyki:{" "}
              <span className="font-semibold text-white">
                {liveStats?.home?.teamName ?? homeTeam}
              </span>{" "}
              vs{" "}
              <span className="font-semibold text-white">
                {liveStats?.away?.teamName ?? awayTeam}
              </span>
            </div>

            <div className="text-xs text-neutral-500">
              {formatDateTime(liveStats?.updatedAt ?? null)}
            </div>
          </div>
        </Surface>

        <div className="space-y-3">
          {meaningfulLiveStatsItems.map((item) => (
            <StatBarRow key={item.key} item={item} />
          ))}
        </div>
      </div>
    );
  };

  const renderChampionsLeagueStandings = () => {
    return (
      <div className="space-y-4">
        <SofaScoreStaticWidget
          title="UEFA Champions League 25/26 standings"
          src={CHAMPIONS_LEAGUE_STANDINGS_URL}
          height={1763}
          cropBottomPx={156}
          scrolling="no"
        />
      </div>
    );
  };

  const renderChampionsLeaguePlayoff = () => {
    if (!championsLeague) {
      return (
        <StateBox
          title="Play-off dostępny tylko dla Ligi Mistrzów"
          description="Ta zakładka jest ukrywana przy meczach innych rozgrywek."
        />
      );
    }

    return (
      <div className="space-y-4">
        <SofaScoreStaticWidget
          title="UEFA Champions League 25/26 playoff"
          src={CHAMPIONS_LEAGUE_PLAYOFF_URL}
          height={872}
          cropBottomPx={126}
          scrolling="no"
        />
      </div>
    );
  };

  const renderTable = () => {
    if (championsLeague) {
      return renderChampionsLeagueStandings();
    }

    const hasData = !!table;

    if (tableLoading && !hasData) {
      return (
        <StateBox
          title="Ładowanie tabeli..."
          description="Pobieramy aktualną tabelę ligi i strefy kwalifikacyjne / spadkowe."
        />
      );
    }

    if (!hasData && tableError) {
      return (
        <StateBox
          title="Nie udało się załadować tabeli"
          description={tableError}
          tone="error"
        />
      );
    }

    if (!hasData) {
      return (
        <StateBox
          title="Brak danych tabeli"
          description="Nie udało się pobrać danych tabeli dla tego meczu."
        />
      );
    }

    return (
      <div className="space-y-4">
        {tableError ? (
          <InlineWarning message="Nie udało się odświeżyć tabeli. Pokazujemy ostatnio pobrane dane." />
        ) : null}

        <Surface className="p-6">
          <div className="text-lg font-semibold text-white">Tabela ligowa</div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <StatusChip>
              Liga:{" "}
              <span className="ml-1 font-semibold text-white">
                {table?.competition?.name ?? table?.competition?.id ?? "—"}
              </span>
            </StatusChip>

            <StatusChip>
              Sezon:{" "}
              <span className="ml-1 font-semibold text-white">
                {table?.competition?.season ?? "—"}
              </span>
            </StatusChip>

            <StatusChip>
              Kolejka:{" "}
              <span className="ml-1 font-semibold text-white">
                {table?.competition?.matchday ?? "—"}
              </span>
            </StatusChip>

            <StatusChip>
              Aktualizacja: {formatDateTime(table?.updatedAt ?? null)}
            </StatusChip>
          </div>

          {tableLegendZones.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {tableLegendZones.map((zone) => (
                <TableLegendChip key={zone} zone={zone} />
              ))}
            </div>
          ) : null}

          {!table?.available || sortedTableRows.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-neutral-800 bg-neutral-950 px-4 py-4 text-sm text-neutral-400">
              {table?.message ?? "Brak tabeli dla tego meczu."}
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-neutral-800">
              <table className="min-w-full text-sm">
                <thead className="border-b border-neutral-800 bg-neutral-950 text-neutral-400">
                  <tr>
                    <th className="px-3 py-3 text-left">#</th>
                    <th className="px-3 py-3 text-left">Drużyna</th>
                    <th className="px-3 py-3 text-right">M</th>
                    <th className="px-3 py-3 text-right">W</th>
                    <th className="px-3 py-3 text-right">R</th>
                    <th className="px-3 py-3 text-right">P</th>
                    <th className="px-3 py-3 text-right">Bramki</th>
                    <th className="px-3 py-3 text-right">+/-</th>
                    <th className="px-3 py-3 text-right">Pkt</th>
                  </tr>
                </thead>

                <tbody>
                  {sortedTableRows.map((row) => {
                    const zone = getTableZone(
                      table?.competition?.id,
                      table?.competition?.season,
                      row.position,
                      sortedTableRows.length
                    );

                    const isHighlighted =
                      row.teamId !== null && highlightSet.has(row.teamId);
                    const isHome =
                      row.teamId !== null && row.teamId === table?.home?.teamId;
                    const isAway =
                      row.teamId !== null && row.teamId === table?.away?.teamId;

                    return (
                      <tr
                        key={`${row.position}-${row.teamId ?? row.teamName}`}
                        className={cn(
                          "border-b border-neutral-800/70 transition",
                          isHighlighted && "ring-1 ring-inset ring-white/10"
                        )}
                        style={zoneRowStyle(zone)}
                      >
                        <td className="px-3 py-3">
                          <div
                            className="flex h-9 w-9 items-center justify-center rounded-full border text-sm font-extrabold"
                            style={zonePositionStyle(zone)}
                          >
                            {row.position}
                          </div>
                        </td>

                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-white">
                              {row.teamName}
                            </span>
                            {isHome ? <TableRowHighlightBadge label="HOME" /> : null}
                            {isAway ? <TableRowHighlightBadge label="AWAY" /> : null}
                          </div>
                        </td>

                        <td className="px-3 py-3 text-right text-neutral-300">
                          {numberDisplay(row.played)}
                        </td>
                        <td className="px-3 py-3 text-right text-neutral-300">
                          {numberDisplay(row.won)}
                        </td>
                        <td className="px-3 py-3 text-right text-neutral-300">
                          {numberDisplay(row.draw)}
                        </td>
                        <td className="px-3 py-3 text-right text-neutral-300">
                          {numberDisplay(row.lost)}
                        </td>
                        <td className="px-3 py-3 text-right text-neutral-300">
                          {numberDisplay(row.goalsFor)}:
                          {numberDisplay(row.goalsAgainst)}
                        </td>
                        <td className="px-3 py-3 text-right text-neutral-300">
                          {numberDisplay(row.goalDiff)}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-white">
                          {numberDisplay(row.points)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Surface>
      </div>
    );
  };

  const renderMomentum = () => {
    if (!liveWidgetsAvailable) {
      return (
        <StateBox
          title="Attack Momentum niedostępne przed meczem"
          description="Wykres naporu pojawi się automatycznie po rozpoczęciu spotkania. Przed pierwszym gwizdkiem SofaScore zwykle nie zwraca jeszcze danych momentum."
        />
      );
    }

    return (
      <div className="space-y-4">
        <Surface className="p-4">
          <div className="text-sm font-semibold text-white">Attack Momentum</div>
          <div className="mt-2 text-sm text-neutral-400">
            Widżet SofaScore pokazujący przebieg naporu i presji obu drużyn
            podczas meczu.
          </div>
        </Surface>

        <SofaScoreEventWidget
          matchId={matchId}
          mode="attackMomentum"
          height={286}
          theme="dark"
        />
      </div>
    );
  };

  const renderTimeline = () => {
    if (liveWidgetsAvailable) {
      const items = timeline?.items ?? [];

      if (timelineLoading && items.length === 0) {
        return (
          <StateBox
            title="Ładowanie timeline..."
            description="Pobieramy zapisane zdarzenia meczu z naszej bazy."
          />
        );
      }

      if (items.length === 0 && timelineError) {
        return (
          <StateBox
            title="Nie udało się załadować timeline"
            description={timelineError}
            tone="error"
          />
        );
      }

      if (items.length === 0) {
        return (
          <div className="space-y-4">
            <StateBox
              title="Brak osi zdarzeń"
              description={
                timeline?.message ??
                "Dla tego meczu nie mamy jeszcze zapisanych zdarzeń timeline w bazie."
              }
            />

            {timeline?.externalUrl ? (
              <a
                href={timeline.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-900"
              >
                Otwórz mecz w SofaScore
              </a>
            ) : null}
          </div>
        );
      }

      return (
        <div className="space-y-4">
          <Surface className="p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-white">Timeline</div>
                <div className="mt-2 text-sm text-neutral-400">
                  Zapisane zdarzenia meczu: gole, kartki, zmiany i kluczowe
                  incydenty.
                </div>
              </div>

              <div className="text-xs text-neutral-500">
                {formatDateTime(timeline?.updatedAt ?? null)}
              </div>
            </div>
          </Surface>

          {timelineError ? (
            <InlineWarning message="Nie udało się odświeżyć timeline. Pokazujemy ostatnio pobrane dane." />
          ) : null}

          <Surface className="overflow-hidden">
            <div className="divide-y divide-neutral-800">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-3 px-4 py-4 md:grid-cols-[72px_1fr]"
                >
                  <div className="text-sm font-bold tabular-nums text-sky-300">
                    {formatTimelineMinute(item)}
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-white">
                      {timelineEventLabel(item.eventType)}
                    </div>
                    <div className="mt-1 text-sm text-neutral-400">
                      {[item.playerName, item.detail].filter(Boolean).join(" · ") ||
                        "Zdarzenie meczowe"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Surface>

          {timeline?.externalUrl ? (
            <div className="text-xs text-neutral-500">
              Źródło mapowania:{" "}
              <a
                href={timeline.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="text-neutral-300 underline underline-offset-4 hover:text-white"
              >
                SofaScore
              </a>
            </div>
          ) : null}
        </div>
      );
    }

    if (!liveWidgetsAvailable) {
      return (
        <StateBox
          title="Timeline niedostępny przed meczem"
          description="Oś zdarzeń pojawi się automatycznie po rozpoczęciu spotkania. Przed meczem SofaScore zwykle nie zwraca jeszcze incydentów."
        />
      );
    }
  };

  return (
    <section className="min-w-0 rounded-3xl border border-neutral-800 bg-neutral-900/40 p-5 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
            Match Center
          </div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Centrum meczu
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-400">
            {subtitle}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {competitionCode ? (
              <StatusChip tone="blue">{competitionCode}</StatusChip>
            ) : null}

            {lastRefreshedAt ? (
              <StatusChip>
                <span className="whitespace-nowrap tabular-nums">
                  Sprawdzono: {new Date(lastRefreshedAt).toLocaleTimeString()}
                </span>
              </StatusChip>
            ) : null}

            {isRefreshing ? <StatusChip tone="green">Odświeżanie…</StatusChip> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {visibleTabs.map((tab) => (
            <TabButton
              key={tab.key}
              label={tab.label}
              active={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
            />
          ))}
        </div>
      </div>

      <div className="mt-6">
        {activeTab === "lineups"
          ? renderLineups()
          : activeTab === "comparison"
            ? renderComparison()
            : activeTab === "h2h"
              ? renderH2H()
              : activeTab === "liveStats"
                ? renderLiveStats()
                : activeTab === "momentum"
                  ? renderMomentum()
                  : activeTab === "playoff"
                    ? renderChampionsLeaguePlayoff()
                    : activeTab === "timeline"
                      ? renderTimeline()
                      : renderTable()}
      </div>
    </section>
  );
}
