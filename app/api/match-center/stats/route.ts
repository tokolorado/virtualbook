// app/api/match-center/stats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MappingRow = {
  sofascore_event_id: number | null;
};

type SofaScoreStatisticsItem = {
  key?: string | null;
  name?: string | null;
  home?: string | null;
  away?: string | null;
  homeValue?: number | null;
  awayValue?: number | null;
  valueType?: string | null;
};

type SofaScoreStatisticsGroup = {
  groupName?: string | null;
  statisticsItems?: SofaScoreStatisticsItem[] | null;
};

type SofaScoreStatisticsPeriod = {
  period?: string | null;
  groups?: SofaScoreStatisticsGroup[] | null;
};

type SofaScoreStatisticsResponse = {
  statistics?: SofaScoreStatisticsPeriod[] | null;
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
  source?: "sofascore" | "cache" | "empty";
  upstreamStatus?: number | null;
  message?: string | null;
};

type MatchRow = {
  id: number;
  home_team: string;
  away_team: string;
  home_team_id: number | null;
  away_team_id: number | null;
  last_sync_at: string | null;
};

type MatchTeamStatsRow = {
  match_id: number;
  team_id: number;
  shots: number | null;
  shots_on_target: number | null;
  possession: number | null;
  corners: number | null;
  fouls: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  created_at: string | null;
};

const STAT_DEFS: Array<{
  label: string;
  keys: string[];
  names: string[];
}> = [
  {
    label: "Strzały",
    keys: ["totalShots", "shots"],
    names: ["Shots", "Total shots", "Total Shots"],
  },
  {
    label: "Strzały celne",
    keys: ["shotsOnTarget"],
    names: ["Shots on target", "Shots On Target"],
  },
  {
    label: "Posiadanie piłki",
    keys: ["ballPossession"],
    names: ["Ball possession", "Possession"],
  },
  {
    label: "Rzuty rożne",
    keys: ["cornerKicks"],
    names: ["Corner kicks", "Corners"],
  },
  {
    label: "Faule",
    keys: ["fouls"],
    names: ["Fouls"],
  },
  {
    label: "Żółte kartki",
    keys: ["yellowCards"],
    names: ["Yellow cards", "Yellow Cards"],
  },
  {
    label: "Czerwone kartki",
    keys: ["redCards"],
    names: ["Red cards", "Red Cards"],
  },
  {
    label: "Spalone",
    keys: ["offsides"],
    names: ["Offsides"],
  },
  {
    label: "xG",
    keys: ["expectedGoals"],
    names: ["Expected goals", "Expected Goals", "xG"],
  },
];

const CACHE_STAT_DEFS: Array<{
  key: keyof Pick<
    MatchTeamStatsRow,
    | "shots"
    | "shots_on_target"
    | "possession"
    | "corners"
    | "fouls"
    | "yellow_cards"
    | "red_cards"
  >;
  label: string;
  suffix: string;
}> = [
  { key: "shots", label: "Strzały", suffix: "" },
  { key: "shots_on_target", label: "Strzały celne", suffix: "" },
  { key: "possession", label: "Posiadanie piłki", suffix: "%" },
  { key: "corners", label: "Rzuty rożne", suffix: "" },
  { key: "fouls", label: "Faule", suffix: "" },
  { key: "yellow_cards", label: "Żółte kartki", suffix: "" },
  { key: "red_cards", label: "Czerwone kartki", suffix: "" },
];

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Brak konfiguracji SUPABASE dla route stats.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function safeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function parseNumberish(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.replace(",", ".").replace("%", "").trim();
  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : null;
}

function inferSuffix(home: string | null, away: string | null): string {
  if ((home ?? "").includes("%") || (away ?? "").includes("%")) {
    return "%";
  }

  return "";
}

function normalizeDisplayValue(
  rawText: string | null,
  numeric: number | null,
  suffix: string
): string {
  if (rawText && rawText.trim().length > 0) {
    return rawText.trim();
  }

  if (numeric === null) {
    return "—";
  }

  return suffix ? `${numeric}${suffix}` : String(numeric);
}

function normalizeStatItem(
  raw: SofaScoreStatisticsItem,
  labelOverride?: string
): StatsItem {
  const rawHome = safeNullableString(raw.home);
  const rawAway = safeNullableString(raw.away);

  const homeNumeric = raw.homeValue ?? parseNumberish(raw.home);
  const awayNumeric = raw.awayValue ?? parseNumberish(raw.away);

  const suffix = inferSuffix(rawHome, rawAway);

  return {
    key: safeNullableString(raw.key) ?? safeNullableString(raw.name) ?? "unknown",
    label: labelOverride ?? safeNullableString(raw.name) ?? "Statystyka",
    homeValue: normalizeDisplayValue(rawHome, homeNumeric, suffix),
    awayValue: normalizeDisplayValue(rawAway, awayNumeric, suffix),
    homeNumeric,
    awayNumeric,
    suffix,
  };
}

function flattenStatistics(
  payload: SofaScoreStatisticsResponse
): SofaScoreStatisticsItem[] {
  const periods = Array.isArray(payload.statistics) ? payload.statistics : [];

  const allPeriod =
    periods.find(
      (period) => String(period?.period ?? "").toUpperCase() === "ALL"
    ) ?? periods[0];

  const groups = Array.isArray(allPeriod?.groups) ? allPeriod.groups : [];

  return groups.flatMap((group) =>
    Array.isArray(group.statisticsItems) ? group.statisticsItems : []
  );
}

function normalizeKey(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function pickPreferredStats(rawItems: SofaScoreStatisticsItem[]): StatsItem[] {
  const used = new Set<string>();
  const result: StatsItem[] = [];

  for (const def of STAT_DEFS) {
    const found = rawItems.find((item) => {
      const key = normalizeKey(item.key);
      const name = normalizeKey(item.name);

      const keyMatch = def.keys.some((candidate) => normalizeKey(candidate) === key);
      const nameMatch = def.names.some(
        (candidate) => normalizeKey(candidate) === name
      );

      return keyMatch || nameMatch;
    });

    if (!found) continue;

    const uniqueId =
      safeNullableString(found.key) ??
      safeNullableString(found.name) ??
      def.label;

    if (used.has(uniqueId)) continue;
    used.add(uniqueId);

    const normalized = normalizeStatItem(found, def.label);

    const hasAnyValue =
      normalized.homeNumeric !== null ||
      normalized.awayNumeric !== null ||
      normalized.homeValue !== "—" ||
      normalized.awayValue !== "—";

    if (hasAnyValue) {
      result.push(normalized);
    }
  }

  return result;
}

function emptyResponse(matchId: number | null): StatsResponse {
  return {
    matchId,
    home: null,
    away: null,
    items: [],
    updatedAt: null,
    source: "empty",
  };
}

function formatCachedValue(value: number | null, suffix: string) {
  if (value === null) return "—";
  return suffix ? `${value}${suffix}` : String(value);
}

function buildStatsSide(
  row: MatchTeamStatsRow | null,
  teamId: number | null,
  teamName: string
): StatsSide | null {
  if (!row && teamId === null && !teamName.trim()) return null;

  const stats: Record<string, number | null> = {};

  for (const def of CACHE_STAT_DEFS) {
    stats[def.key] = row ? safeNumber(row[def.key]) : null;
  }

  return {
    teamId,
    teamName,
    stats,
  };
}

function buildCachedItems(
  homeRow: MatchTeamStatsRow | null,
  awayRow: MatchTeamStatsRow | null
): StatsItem[] {
  return CACHE_STAT_DEFS.map((def) => {
    const homeNumeric = homeRow ? safeNumber(homeRow[def.key]) : null;
    const awayNumeric = awayRow ? safeNumber(awayRow[def.key]) : null;

    return {
      key: def.key,
      label: def.label,
      homeValue: formatCachedValue(homeNumeric, def.suffix),
      awayValue: formatCachedValue(awayNumeric, def.suffix),
      homeNumeric,
      awayNumeric,
      suffix: def.suffix,
    };
  }).filter((item) => item.homeNumeric !== null || item.awayNumeric !== null);
}

function maxIso(values: Array<string | null | undefined>) {
  let max: number | null = null;

  for (const value of values) {
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) continue;
    if (max === null || timestamp > max) max = timestamp;
  }

  return max === null ? null : new Date(max).toISOString();
}

async function loadCachedStatsResponse(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  matchId: number,
  upstreamStatus: number | null,
  upstreamMessage: string | null
): Promise<StatsResponse> {
  const [{ data: matchRaw, error: matchError }, { data: statsRaw, error: statsError }] =
    await Promise.all([
      supabase
        .from("matches")
        .select("id, home_team, away_team, home_team_id, away_team_id, last_sync_at")
        .eq("id", matchId)
        .maybeSingle(),
      supabase
        .from("match_team_stats")
        .select(
          "match_id, team_id, shots, shots_on_target, possession, corners, fouls, yellow_cards, red_cards, created_at"
        )
        .eq("match_id", matchId),
    ]);

  if (matchError) {
    throw new Error(`Nie udało się pobrać meczu dla statystyk: ${matchError.message}`);
  }

  if (statsError) {
    throw new Error(`Nie udało się pobrać cache statystyk: ${statsError.message}`);
  }

  const match =
    typeof matchRaw === "object" && matchRaw !== null
      ? (matchRaw as Record<string, unknown>)
      : {};

  const currentMatch: MatchRow = {
    id: safeNumber(match.id) ?? matchId,
    home_team: safeString(match.home_team, "Gospodarze"),
    away_team: safeString(match.away_team, "Goście"),
    home_team_id: safeNumber(match.home_team_id),
    away_team_id: safeNumber(match.away_team_id),
    last_sync_at: safeNullableString(match.last_sync_at),
  };

  const statsRows = ((statsRaw ?? []) as unknown[]) as MatchTeamStatsRow[];
  const homeRow =
    statsRows.find((row) => row.team_id === currentMatch.home_team_id) ??
    (currentMatch.home_team_id === null && statsRows.length === 2 ? statsRows[0] : null);

  const awayRow =
    statsRows.find((row) => row.team_id === currentMatch.away_team_id) ??
    (currentMatch.away_team_id === null && statsRows.length === 2 ? statsRows[1] : null);

  const items = buildCachedItems(homeRow, awayRow);
  const updatedAt = maxIso([
    currentMatch.last_sync_at,
    ...statsRows.map((row) => row.created_at),
  ]);

  return {
    matchId,
    home: buildStatsSide(homeRow, currentMatch.home_team_id, currentMatch.home_team),
    away: buildStatsSide(awayRow, currentMatch.away_team_id, currentMatch.away_team),
    items,
    updatedAt,
    source: items.length ? "cache" : "empty",
    upstreamStatus,
    message:
      upstreamMessage ??
      (upstreamStatus
        ? "SofaScore nie udostępnił statystyk; pokazujemy cache, jeśli jest dostępny."
        : null),
  };
}

export async function GET(request: NextRequest) {
  try {
    const matchIdParam = request.nextUrl.searchParams.get("matchId");
    const matchId = safeNumber(matchIdParam);

    if (matchId === null) {
      return NextResponse.json(
        { error: "Nieprawidłowy matchId." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: mapping, error: mappingError } = await supabase
      .from("match_sofascore_map")
      .select("sofascore_event_id")
      .eq("match_id", matchId)
      .maybeSingle<MappingRow>();

    if (mappingError) {
      return NextResponse.json(
        { error: `Błąd odczytu mapowania SofaScore: ${mappingError.message}` },
        { status: 500 }
      );
    }

    const sofascoreEventId = safeNumber(mapping?.sofascore_event_id);

    if (sofascoreEventId === null) {
      return NextResponse.json(emptyResponse(matchId), { status: 200 });
    }

    let sofaResponse: Response;

    try {
      sofaResponse = await fetch(
        `https://api.sofascore.com/api/v1/event/${sofascoreEventId}/statistics`,
        {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            Referer: "https://www.sofascore.com/",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
        }
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "SofaScore stats request failed.";

      const fallback = await loadCachedStatsResponse(
        supabase,
        matchId,
        null,
        message
      );

      return NextResponse.json(fallback, { status: 200 });
    }

    if (!sofaResponse.ok) {
      const fallback = await loadCachedStatsResponse(
        supabase,
        matchId,
        sofaResponse.status,
        `SofaScore stats fetch failed: ${sofaResponse.status}`
      );

      return NextResponse.json(fallback, { status: 200 });
    }

    const payload = (await sofaResponse.json()) as SofaScoreStatisticsResponse;
    const rawItems = flattenStatistics(payload);
    const items = pickPreferredStats(rawItems);

    return NextResponse.json<StatsResponse>(
      {
        matchId,
        home: null,
        away: null,
        items,
        updatedAt: new Date().toISOString(),
        source: "sofascore",
        upstreamStatus: sofaResponse.status,
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udało się pobrać statystyk.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
