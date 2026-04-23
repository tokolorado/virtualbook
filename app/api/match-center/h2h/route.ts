// app/api/match-center/h2h/route.ts
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

function emptySummary(): H2HSummary {
  return {
    homeWins: 0,
    draws: 0,
    awayWins: 0,
    totalMatches: 0,
    homeGoals: 0,
    awayGoals: 0,
    bttsCount: 0,
    over25Count: 0,
  };
}

function emptyResponse(matchId: number | null, updatedAt: string | null): H2HResponse {
  return {
    matchId,
    summary: emptySummary(),
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

function isSamePairByIds(
  match: MatchRow,
  currentHomeTeamId: number,
  currentAwayTeamId: number
) {
  return (
    (match.home_team_id === currentHomeTeamId &&
      match.away_team_id === currentAwayTeamId) ||
    (match.home_team_id === currentAwayTeamId &&
      match.away_team_id === currentHomeTeamId)
  );
}

function isSamePairByNames(
  match: MatchRow,
  currentHomeTeam: string,
  currentAwayTeam: string
) {
  return (
    (match.home_team === currentHomeTeam && match.away_team === currentAwayTeam) ||
    (match.home_team === currentAwayTeam && match.away_team === currentHomeTeam)
  );
}

function buildSummaryFromMatches(
  matches: MatchRow[],
  currentMatch: MatchRow
): H2HSummary {
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let totalMatches = 0;
  let homeGoals = 0;
  let awayGoals = 0;
  let bttsCount = 0;
  let over25Count = 0;

  const hasTeamIds =
    currentMatch.home_team_id !== null && currentMatch.away_team_id !== null;

  for (const match of matches) {
    if (match.home_score === null || match.away_score === null) continue;

    let isSameOrientation = false;
    let isReversedOrientation = false;

    if (hasTeamIds) {
      isSameOrientation =
        match.home_team_id === currentMatch.home_team_id &&
        match.away_team_id === currentMatch.away_team_id;

      isReversedOrientation =
        match.home_team_id === currentMatch.away_team_id &&
        match.away_team_id === currentMatch.home_team_id;
    } else {
      isSameOrientation =
        match.home_team === currentMatch.home_team &&
        match.away_team === currentMatch.away_team;

      isReversedOrientation =
        match.home_team === currentMatch.away_team &&
        match.away_team === currentMatch.home_team;
    }

    if (!isSameOrientation && !isReversedOrientation) continue;

    const currentHomeScore = isSameOrientation ? match.home_score : match.away_score;
    const currentAwayScore = isSameOrientation ? match.away_score : match.home_score;

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

    const hasTeamIds =
      currentMatch.home_team_id !== null && currentMatch.away_team_id !== null;

    let query = supabase
      .from("matches")
      .select(
        "id, utc_date, status, competition_name, home_team, away_team, home_team_id, away_team_id, home_score, away_score, last_sync_at"
      )
      .eq("status", "FINISHED")
      .neq("id", matchId)
      .order("utc_date", { ascending: false })
      .limit(10);

    if (currentMatch.utc_date) {
      query = query.lt("utc_date", currentMatch.utc_date);
    }

    if (hasTeamIds) {
      query = query.or(
        `and(home_team_id.eq.${currentMatch.home_team_id},away_team_id.eq.${currentMatch.away_team_id}),and(home_team_id.eq.${currentMatch.away_team_id},away_team_id.eq.${currentMatch.home_team_id})`
      );
    } else {
      const homeEscaped = currentMatch.home_team.replaceAll(",", "\\,");
      const awayEscaped = currentMatch.away_team.replaceAll(",", "\\,");
      query = query.or(
        `and(home_team.eq.${homeEscaped},away_team.eq.${awayEscaped}),and(home_team.eq.${awayEscaped},away_team.eq.${homeEscaped})`
      );
    }

    const { data: historicalMatchesRaw, error: historicalMatchesError } =
      await query;

    if (historicalMatchesError) {
      return NextResponse.json(
        {
          error: `Nie udało się pobrać meczów H2H: ${historicalMatchesError.message}`,
        },
        { status: 500 }
      );
    }

    const historicalMatches = ((historicalMatchesRaw ?? []) as unknown[])
      .map(normalizeMatchRow)
      .filter((match) => {
        if (hasTeamIds && currentMatch.home_team_id !== null && currentMatch.away_team_id !== null) {
          return isSamePairByIds(
            match,
            currentMatch.home_team_id,
            currentMatch.away_team_id
          );
        }

        return isSamePairByNames(
          match,
          currentMatch.home_team,
          currentMatch.away_team
        );
      });

    if (historicalMatches.length === 0) {
      return NextResponse.json(
        emptyResponse(matchId, currentMatch.last_sync_at ?? currentMatch.utc_date ?? null),
        { status: 200 }
      );
    }

    const summary = buildSummaryFromMatches(historicalMatches, currentMatch);
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