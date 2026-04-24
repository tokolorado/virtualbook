// app/api/match-center/comparison/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveSofaScoreEventId } from "@/lib/sofascore/resolveEventId";

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

type ComparisonItem = {
  key: string;
  label: string;
  homeValue: string;
  awayValue: string;
  homeNumeric: number | null;
  awayNumeric: number | null;
  suffix: string;
};

type ComparisonResponse = {
  matchId: number | null;
  items: ComparisonItem[];
  updatedAt: string | null;
};

type TeamRecentSummary = {
  played: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  cleanSheets: number;
  failedToScore: number;
  bttsCount: number;
  over25Count: number;
  form: Array<"W" | "D" | "L">;
};

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Brak konfiguracji SUPABASE dla route comparison.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdmin>;

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
): ComparisonResponse {
  return {
    matchId,
    items: [],
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

async function loadRecentTeamMatchesById(
  supabase: SupabaseAdminClient,
  teamId: number,
  currentMatchId: number,
  beforeUtcDate: string | null
): Promise<MatchRow[]> {
  let query = supabase
    .from("matches")
    .select(
      "id, utc_date, status, competition_name, home_team, away_team, home_team_id, away_team_id, home_score, away_score, last_sync_at"
    )
    .eq("status", "FINISHED")
    .neq("id", currentMatchId)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order("utc_date", { ascending: false })
    .limit(5);

  if (beforeUtcDate) {
    query = query.lt("utc_date", beforeUtcDate);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Nie udało się pobrać formy drużyny: ${error.message}`);
  }

  return ((data ?? []) as unknown[]).map(normalizeMatchRow);
}

async function loadRecentTeamMatchesByName(
  supabase: SupabaseAdminClient,
  teamName: string,
  currentMatchId: number,
  beforeUtcDate: string | null
): Promise<MatchRow[]> {
  let homeQuery = supabase
    .from("matches")
    .select(
      "id, utc_date, status, competition_name, home_team, away_team, home_team_id, away_team_id, home_score, away_score, last_sync_at"
    )
    .eq("status", "FINISHED")
    .neq("id", currentMatchId)
    .eq("home_team", teamName)
    .order("utc_date", { ascending: false })
    .limit(5);

  let awayQuery = supabase
    .from("matches")
    .select(
      "id, utc_date, status, competition_name, home_team, away_team, home_team_id, away_team_id, home_score, away_score, last_sync_at"
    )
    .eq("status", "FINISHED")
    .neq("id", currentMatchId)
    .eq("away_team", teamName)
    .order("utc_date", { ascending: false })
    .limit(5);

  if (beforeUtcDate) {
    homeQuery = homeQuery.lt("utc_date", beforeUtcDate);
    awayQuery = awayQuery.lt("utc_date", beforeUtcDate);
  }

  const [
    { data: homeData, error: homeError },
    { data: awayData, error: awayError },
  ] = await Promise.all([homeQuery, awayQuery]);

  if (homeError) {
    throw new Error(`Nie udało się pobrać formy drużyny (home): ${homeError.message}`);
  }

  if (awayError) {
    throw new Error(`Nie udało się pobrać formy drużyny (away): ${awayError.message}`);
  }

  const merged = [...(homeData ?? []), ...(awayData ?? [])]
    .map(normalizeMatchRow)
    .sort(byUtcDateDesc);

  const deduped = new Map<number, MatchRow>();

  for (const match of merged) {
    if (!deduped.has(match.id)) {
      deduped.set(match.id, match);
    }
  }

  return Array.from(deduped.values()).slice(0, 5);
}

async function loadRecentTeamMatches(
  supabase: SupabaseAdminClient,
  teamId: number | null,
  teamName: string,
  currentMatchId: number,
  beforeUtcDate: string | null
): Promise<MatchRow[]> {
  if (teamId !== null) {
    return loadRecentTeamMatchesById(
      supabase,
      teamId,
      currentMatchId,
      beforeUtcDate
    );
  }

  if (!teamName.trim()) {
    return [];
  }

  return loadRecentTeamMatchesByName(
    supabase,
    teamName,
    currentMatchId,
    beforeUtcDate
  );
}

function getPerspectiveScores(
  match: MatchRow,
  teamId: number | null,
  teamName: string
): { goalsFor: number; goalsAgainst: number; result: "W" | "D" | "L" } | null {
  if (match.home_score === null || match.away_score === null) {
    return null;
  }

  let isHomeSide: boolean | null = null;

  if (teamId !== null) {
    if (match.home_team_id === teamId) {
      isHomeSide = true;
    } else if (match.away_team_id === teamId) {
      isHomeSide = false;
    }
  } else {
    if (match.home_team === teamName) {
      isHomeSide = true;
    } else if (match.away_team === teamName) {
      isHomeSide = false;
    }
  }

  if (isHomeSide === null) {
    return null;
  }

  const goalsFor = isHomeSide ? match.home_score : match.away_score;
  const goalsAgainst = isHomeSide ? match.away_score : match.home_score;

  let result: "W" | "D" | "L" = "D";

  if (goalsFor > goalsAgainst) {
    result = "W";
  } else if (goalsFor < goalsAgainst) {
    result = "L";
  }

  return {
    goalsFor,
    goalsAgainst,
    result,
  };
}

function buildTeamRecentSummary(
  matches: MatchRow[],
  teamId: number | null,
  teamName: string
): TeamRecentSummary {
  const summary: TeamRecentSummary = {
    played: 0,
    points: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    cleanSheets: 0,
    failedToScore: 0,
    bttsCount: 0,
    over25Count: 0,
    form: [],
  };

  for (const match of matches) {
    const perspective = getPerspectiveScores(match, teamId, teamName);
    if (!perspective) continue;

    summary.played += 1;
    summary.goalsFor += perspective.goalsFor;
    summary.goalsAgainst += perspective.goalsAgainst;
    summary.form.push(perspective.result);

    if (perspective.result === "W") {
      summary.wins += 1;
      summary.points += 3;
    } else if (perspective.result === "D") {
      summary.draws += 1;
      summary.points += 1;
    } else {
      summary.losses += 1;
    }

    if (perspective.goalsAgainst === 0) {
      summary.cleanSheets += 1;
    }

    if (perspective.goalsFor === 0) {
      summary.failedToScore += 1;
    }

    if (perspective.goalsFor > 0 && perspective.goalsAgainst > 0) {
      summary.bttsCount += 1;
    }

    if (perspective.goalsFor + perspective.goalsAgainst > 2.5) {
      summary.over25Count += 1;
    }
  }

  summary.goalDiff = summary.goalsFor - summary.goalsAgainst;

  return summary;
}

function buildComparisonItems(
  home: TeamRecentSummary,
  away: TeamRecentSummary
): ComparisonItem[] {
  const formHome = home.form.length > 0 ? home.form.join(" ") : "—";
  const formAway = away.form.length > 0 ? away.form.join(" ") : "—";

  return [
    {
      key: "recent_form",
      label: "Forma (ostatnie 5)",
      homeValue: formHome,
      awayValue: formAway,
      homeNumeric: null,
      awayNumeric: null,
      suffix: "",
    },
    {
      key: "points",
      label: "Punkty",
      homeValue: String(home.points),
      awayValue: String(away.points),
      homeNumeric: home.points,
      awayNumeric: away.points,
      suffix: "",
    },
    {
      key: "wins",
      label: "Wygrane",
      homeValue: String(home.wins),
      awayValue: String(away.wins),
      homeNumeric: home.wins,
      awayNumeric: away.wins,
      suffix: "",
    },
    {
      key: "draws",
      label: "Remisy",
      homeValue: String(home.draws),
      awayValue: String(away.draws),
      homeNumeric: home.draws,
      awayNumeric: away.draws,
      suffix: "",
    },
    {
      key: "losses",
      label: "Porażki",
      homeValue: String(home.losses),
      awayValue: String(away.losses),
      homeNumeric: home.losses,
      awayNumeric: away.losses,
      suffix: "",
    },
    {
      key: "goals_for",
      label: "Gole strzelone",
      homeValue: String(home.goalsFor),
      awayValue: String(away.goalsFor),
      homeNumeric: home.goalsFor,
      awayNumeric: away.goalsFor,
      suffix: "",
    },
    {
      key: "goals_against",
      label: "Gole stracone",
      homeValue: String(home.goalsAgainst),
      awayValue: String(away.goalsAgainst),
      homeNumeric: home.goalsAgainst,
      awayNumeric: away.goalsAgainst,
      suffix: "",
    },
    {
      key: "goal_diff",
      label: "Bilans bramkowy",
      homeValue: String(home.goalDiff),
      awayValue: String(away.goalDiff),
      homeNumeric: home.goalDiff,
      awayNumeric: away.goalDiff,
      suffix: "",
    },
    {
      key: "clean_sheets",
      label: "Czyste konta",
      homeValue: String(home.cleanSheets),
      awayValue: String(away.cleanSheets),
      homeNumeric: home.cleanSheets,
      awayNumeric: away.cleanSheets,
      suffix: "",
    },
    {
      key: "failed_to_score",
      label: "Mecze bez gola",
      homeValue: String(home.failedToScore),
      awayValue: String(away.failedToScore),
      homeNumeric: home.failedToScore,
      awayNumeric: away.failedToScore,
      suffix: "",
    },
    {
      key: "btts",
      label: "BTTS",
      homeValue: String(home.bttsCount),
      awayValue: String(away.bttsCount),
      homeNumeric: home.bttsCount,
      awayNumeric: away.bttsCount,
      suffix: "",
    },
    {
      key: "over_2_5",
      label: "Over 2.5",
      homeValue: String(home.over25Count),
      awayValue: String(away.over25Count),
      homeNumeric: home.over25Count,
      awayNumeric: away.over25Count,
      suffix: "",
    },
  ];
}

function resolveUpdatedAt(
  currentMatch: MatchRow,
  homeMatches: MatchRow[],
  awayMatches: MatchRow[]
) {
  return (
    currentMatch.last_sync_at ??
    homeMatches.find((match) => match.last_sync_at)?.last_sync_at ??
    awayMatches.find((match) => match.last_sync_at)?.last_sync_at ??
    homeMatches[0]?.utc_date ??
    awayMatches[0]?.utc_date ??
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

    const [homeRecentMatches, awayRecentMatches] = await Promise.all([
      loadRecentTeamMatches(
        supabase,
        currentMatch.home_team_id,
        currentMatch.home_team,
        currentMatch.id,
        currentMatch.utc_date || null
      ),
      loadRecentTeamMatches(
        supabase,
        currentMatch.away_team_id,
        currentMatch.away_team,
        currentMatch.id,
        currentMatch.utc_date || null
      ),
    ]);

    const homeSummary = buildTeamRecentSummary(
      homeRecentMatches,
      currentMatch.home_team_id,
      currentMatch.home_team
    );

    const awaySummary = buildTeamRecentSummary(
      awayRecentMatches,
      currentMatch.away_team_id,
      currentMatch.away_team
    );

    const items = buildComparisonItems(homeSummary, awaySummary);
    const updatedAt = resolveUpdatedAt(
      currentMatch,
      homeRecentMatches,
      awayRecentMatches
    );

    const hasAnyData =
      homeSummary.played > 0 ||
      awaySummary.played > 0 ||
      homeRecentMatches.length > 0 ||
      awayRecentMatches.length > 0;

    if (!hasAnyData) {
      return NextResponse.json(
        emptyResponse(matchId, updatedAt),
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        matchId,
        items,
        updatedAt,
      } satisfies ComparisonResponse,
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Nie udało się pobrać porównania.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}