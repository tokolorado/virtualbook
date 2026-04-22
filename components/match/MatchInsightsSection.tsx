// components/match/MatchInsightsSection.tsx
"use client";

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
};

type TabKey = "lineups" | "stats" | "table";

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

type StatsItem = {
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
  items: StatsItem[];
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

const AUTO_REFRESH_MS = 20_000;

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

function normalizeStatsItem(input: unknown): StatsItem {
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
    items: Array.isArray(row.items) ? row.items.map(normalizeStatsItem) : [],
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
        tone === "neutral" && "border-neutral-800 bg-neutral-950 text-neutral-300",
        tone === "blue" && "border-sky-500/30 bg-sky-500/10 text-sky-300",
        tone === "red" && "border-red-500/30 bg-red-500/10 text-red-300",
        tone === "green" && "border-green-500/30 bg-green-500/10 text-green-300",
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

function InlineWarning({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
      {message}
    </div>
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

function StatBarRow({ item }: { item: StatsItem }) {
  const hasNumeric =
    item.homeNumeric !== null &&
    item.awayNumeric !== null &&
    item.homeNumeric >= 0 &&
    item.awayNumeric >= 0;

  const homeNum = item.homeNumeric ?? 0;
  const awayNum = item.awayNumeric ?? 0;

  let homePercent = 50;
  let awayPercent = 50;

  if (hasNumeric) {
    const total = homeNum + awayNum;

    if (total > 0) {
      homePercent = (homeNum / total) * 100;
      awayPercent = (awayNum / total) * 100;
    }
  }

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
}: MatchInsightsSectionProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("lineups");
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const [lineupsLoading, setLineupsLoading] = useState(true);
  const [lineupsError, setLineupsError] = useState<string | null>(null);
  const [lineups, setLineups] = useState<LineupsResponse | null>(null);

  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);

  const [tableLoading, setTableLoading] = useState(true);
  const [tableError, setTableError] = useState<string | null>(null);
  const [table, setTable] = useState<TableResponse | null>(null);

  const subtitle = useMemo(() => {
    const league = competitionCode?.trim() ? ` • ${competitionCode}` : "";
    return `Sekcja informacyjna dla meczu ${homeTeam} vs ${awayTeam}${league}.`;
  }, [competitionCode, homeTeam, awayTeam]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      setRefreshTick((v) => v + 1);
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(id);
  }, [matchId]);

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

    const loadStats = async () => {
      if (!isBackgroundRefresh || !stats) {
        setStatsLoading(true);
      }

      setStatsError(null);

      if (!isBackgroundRefresh) {
        setStats(null);
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
          setStats(normalized);
        }
      } catch (error) {
        if (controller.signal.aborted) return;

        const message =
          error instanceof Error ? error.message : "Błąd ładowania statystyk.";

        setStatsError(message);
      } finally {
        if (!controller.signal.aborted) {
          setStatsLoading(false);
        }
      }
    };

    const loadTable = async () => {
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

    void Promise.all([loadLineups(), loadStats(), loadTable()]).then(() => {
      if (!controller.signal.aborted) {
        setLastRefreshedAt(new Date().toISOString());
      }
    });

    return () => {
      controller.abort();
    };
  }, [matchId, homeTeam, awayTeam, refreshTick]);

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
    (statsLoading && !!stats) ||
    (tableLoading && !!table);

  const renderLineups = () => {
    const hasData = !!lineups?.home || !!lineups?.away;

    if (lineupsLoading && !hasData) {
      return (
        <StateBox
          title="Ładowanie składów..."
          description="Pobieramy aktualne informacje o wyjściowych składach i ławkach rezerwowych."
        />
      );
    }

    if (!hasData && lineupsError) {
      return (
        <StateBox
          title="Nie udało się załadować składów"
          description={lineupsError}
          tone="error"
        />
      );
    }

    if (!hasData) {
      return (
        <StateBox
          title="Brak danych o składach"
          description="Dla tego meczu nie ma jeszcze dostępnych lub zapisanych składów."
        />
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

  const renderStats = () => {
    const hasData = !!stats && stats.items.length > 0;

    if (statsLoading && !hasData) {
      return (
        <StateBox
          title="Ładowanie statystyk..."
          description="Pobieramy najważniejsze liczby meczowe dla obu drużyn."
        />
      );
    }

    if (!hasData && statsError) {
      return (
        <StateBox
          title="Nie udało się załadować statystyk"
          description={statsError}
          tone="error"
        />
      );
    }

    if (!hasData) {
      return (
        <StateBox
          title="Brak statystyk"
          description="Dla tego meczu nie ma obecnie dostępnych statystyk."
        />
      );
    }

    return (
      <div className="space-y-4">
        {statsError ? (
          <InlineWarning message="Nie udało się odświeżyć statystyk. Pokazujemy ostatnio pobrane dane." />
        ) : null}

        <Surface className="px-4 py-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-neutral-400">
              Statystyki:{" "}
              <span className="font-semibold text-white">
                {stats?.home?.teamName ?? homeTeam}
              </span>{" "}
              vs{" "}
              <span className="font-semibold text-white">
                {stats?.away?.teamName ?? awayTeam}
              </span>
            </div>

            <div className="text-xs text-neutral-500">
              {formatDateTime(stats?.updatedAt ?? null)}
            </div>
          </div>
        </Surface>

        <div className="space-y-3">
          {stats?.items.map((item) => (
            <StatBarRow key={item.key} item={item} />
          ))}
        </div>
      </div>
    );
  };

  const renderTable = () => {
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
                            {isHome ? (
                              <TableRowHighlightBadge label="HOME" />
                            ) : null}
                            {isAway ? (
                              <TableRowHighlightBadge label="AWAY" />
                            ) : null}
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

            {isRefreshing ? (
              <StatusChip tone="green">Odświeżanie…</StatusChip>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <TabButton
            label="Składy"
            active={activeTab === "lineups"}
            onClick={() => setActiveTab("lineups")}
          />
          <TabButton
            label="Statystyki"
            active={activeTab === "stats"}
            onClick={() => setActiveTab("stats")}
          />
          <TabButton
            label="Tabela"
            active={activeTab === "table"}
            onClick={() => setActiveTab("table")}
          />
          <button
            type="button"
            onClick={() => setRefreshTick((v) => v + 1)}
            className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-900"
          >
            Odśwież
          </button>
        </div>
      </div>

      <div className="mt-6">
        {activeTab === "lineups"
          ? renderLineups()
          : activeTab === "stats"
            ? renderStats()
            : renderTable()}
      </div>
    </section>
  );
}