import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MatchRow = {
  id: number;
  utc_date: string;
  status: string;
  competition_name: string | null;
  home_team: string;
  away_team: string;
  home_team_id: number | null;
  away_team_id: number | null;
  home_score: number | null;
  away_score: number | null;
  last_sync_at: string | null;
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

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Brak konfiguracji SUPABASE dla route h2h.");
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

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function safeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function emptyResponse(
  matchId: number | null,
  updatedAt: string | null = null
): H2HResponse {
  return {
    matchId,
    summary: null,
    matches: [],
    updatedAt,
  };
}

function normalizeMatchRow(input: unknown): MatchRow {
  const row =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  return {
    id: safeNumber(row.id) ?? 0,
    utc_date: safeString(row.utc_date),
    status: safeString(row.status),
    competition_name: safeNullableString(row.competition_name),
    home_team: safeString(row.home_team, "Gospodarze"),
    away_team: safeString(row.away_team, "Goście"),
    home_team_id: safeNumber(row.home_team_id),
    away_team_id: safeNumber(row.away_team_id),
    home_score: safeNumber(row.home_score),
    away_score: safeNumber(row.away_score),
    last_sync_at: safeNullableString(row.last_sync_at),
  };
}

function byUtcDateDesc(a: MatchRow, b: MatchRow) {
  const aTs = Date.parse(a.utc_date);
  const bTs = Date.parse(b.utc_date);

  if (Number.isFinite(aTs) && Number.isFinite(bTs)) {
    return bTs - aTs;
  }

  return String(b.utc_date).localeCompare(String(a.utc_date));
}

function dedupeMatches(matches: MatchRow[]) {
  const map = new Map<number, MatchRow>();

  for (const match of matches.sort(byUtcDateDesc)) {
    if (!map.has(match.id)) {
      map.set(match.id, match);
    }
  }

  return Array.from(map.values());
}

async function loadH2HByIds(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  currentMatch: MatchRow
): Promise<MatchRow[]> {
  if (
    currentMatch.home_team_id === null ||
    currentMatch.away_team_id === null
  ) {
    return [];
  }

  let query = supabase
    .from("matches")
    .select(
      "id, utc_date, status, competition_name, home_team, away_team, home_team_id, away_team_id, home_score, away_score, last_sync_at"
    )
    .eq("status", "FINISHED")
    .neq("id", currentMatch.id)
    .or(
      `and(home_team_id.eq.${currentMatch.home_team_id},away_team_id.eq.${currentMatch.away_team_id}),and(home_team_id.eq.${currentMatch.away_team_id},away_team_id.eq.${currentMatch.home_team_id})`
    )
    .order("utc_date", { ascending: false })
    .limit(10);

  if (currentMatch.utc_date) {
    query = query.lt("utc_date", currentMatch.utc_date);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Nie udało się pobrać meczów H2H po team_id: ${error.message}`);
  }

  return ((data ?? []) as unknown[]).map(normalizeMatchRow);
}

async function loadH2HByNames(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  currentMatch: MatchRow
): Promise<MatchRow[]> {
  const homeName = currentMatch.home_team.trim();
  const awayName = currentMatch.away_team.trim();

  if (!homeName || !awayName) {
    return [];
  }

  let directQuery = supabase
    .from("matches")
    .select(
      "id, utc_date, status, competition_name, home_team, away_team, home_team_id, away_team_id, home_score, away_score, last_sync_at"
    )
    .eq("status", "FINISHED")
    .neq("id", currentMatch.id)
    .or(
      `and(home_team.eq.${homeName},away_team.eq.${awayName}),and(home_team.eq.${awayName},away_team.eq.${homeName})`
    )
    .order("utc_date", { ascending: false })
    .limit(10);

  if (currentMatch.utc_date) {
    directQuery = directQuery.lt("utc_date", currentMatch.utc_date);
  }

  const { data, error } = await directQuery;

  if (error) {
    throw new Error(`Nie udało się pobrać meczów H2H po nazwach: ${error.message}`);
  }

  return ((data ?? []) as unknown[]).map(normalizeMatchRow);
}

function buildSummaryFromMatches(
  matches: MatchRow[],
  currentHomeTeamId: number | null,
  currentAwayTeamId: number | null,
  currentHomeTeam: string,
  currentAwayTeam: string
): H2HSummary {
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let totalMatches = 0;
  let homeGoals = 0;
  let awayGoals = 0;
  let bttsCount = 0;
  let over25Count = 0;

  for (const match of matches) {
    if (match.home_score === null || match.away_score === null) continue;

    let isSameOrientation = false;
    let isReversedOrientation = false;

    if (currentHomeTeamId !== null && currentAwayTeamId !== null) {
      isSameOrientation =
        match.home_team_id === currentHomeTeamId &&
        match.away_team_id === currentAwayTeamId;

      isReversedOrientation =
        match.home_team_id === currentAwayTeamId &&
        match.away_team_id === currentHomeTeamId;
    } else {
      isSameOrientation =
        match.home_team === currentHomeTeam &&
        match.away_team === currentAwayTeam;

      isReversedOrientation =
        match.home_team === currentAwayTeam &&
        match.away_team === currentHomeTeam;
    }

    if (!isSameOrientation && !isReversedOrientation) {
      continue;
    }

    const currentHomeScore = isSameOrientation
      ? match.home_score
      : match.away_score;

    const currentAwayScore = isSameOrientation
      ? match.away_score
      : match.home_score;

    totalMatches += 1;
    homeGoals += currentHomeScore;
    awayGoals += currentAwayScore;

    if (currentHomeScore > currentAwayScore) {
      homeWins += 1;
    } else if (currentHomeScore < currentAwayScore) {
      awayWins += 1;
    } else {
      draws += 1;
    }

    if (currentHomeScore > 0 && currentAwayScore > 0) {
      bttsCount += 1;
    }

    if (currentHomeScore + currentAwayScore > 2.5) {
      over25Count += 1;
    }
  }

  return {
    homeWins,
    draws,
    awayWins,
    totalMatches,
    homeGoals,
    awayGoals,
    bttsCount,
    over25Count,
  };
}

function buildH2HMatchList(matches: MatchRow[]): H2HMatch[] {
  return matches.map((match) => ({
    id: String(match.id),
    date: safeNullableString(match.utc_date),
    competition: match.competition_name,
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    homeScore: match.home_score,
    awayScore: match.away_score,
  }));
}

function resolveUpdatedAt(currentMatch: MatchRow, historicalMatches: MatchRow[]) {
  return (
    currentMatch.last_sync_at ??
    historicalMatches.find((match) => match.last_sync_at)?.last_sync_at ??
    historicalMatches[0]?.utc_date ??
    currentMatch.utc_date ??
    new Date().toISOString()
  );
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

    const { data: currentMatchRaw, error: currentMatchError } = await supabase
      .from("matches")
      .select(
        "id, utc_date, status, competition_name, home_team, away_team, home_team_id, away_team_id, home_score, away_score, last_sync_at"
      )
      .eq("id", matchId)
      .maybeSingle();

    if (currentMatchError) {
      return NextResponse.json(
        { error: `Nie udało się pobrać meczu: ${currentMatchError.message}` },
        { status: 500 }
      );
    }

    if (!currentMatchRaw) {
      return NextResponse.json(
        { error: "Nie znaleziono meczu." },
        { status: 404 }
      );
    }

    const currentMatch = normalizeMatchRow(currentMatchRaw);

    let historicalMatches = await loadH2HByIds(supabase, currentMatch);

    if (historicalMatches.length === 0) {
      historicalMatches = await loadH2HByNames(supabase, currentMatch);
    }

    historicalMatches = dedupeMatches(historicalMatches).slice(0, 10);

    const summary = buildSummaryFromMatches(
      historicalMatches,
      currentMatch.home_team_id,
      currentMatch.away_team_id,
      currentMatch.home_team,
      currentMatch.away_team
    );

    const matches = buildH2HMatchList(historicalMatches);
    const updatedAt = resolveUpdatedAt(currentMatch, historicalMatches);

    return NextResponse.json(
      {
        matchId,
        summary,
        matches,
        updatedAt,
      } satisfies H2HResponse,
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udało się pobrać H2H.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}