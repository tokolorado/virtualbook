// app/api/match-center/comparison/route.ts
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

type TeamFormMetrics = {
  teamId: number | null;
  teamName: string;
  matchesCount: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goalsScored: number;
  goalsConceded: number;
  avgGoalsScored: number;
  avgGoalsConceded: number;
  winRate: number;
  bttsCount: number;
  over25Count: number;
  cleanSheets: number;
  form: string;
};

type TableSnapshot = {
  totalRows: number;
  updatedAt: string | null;
  homePosition: number | null;
  awayPosition: number | null;
  homePoints: number | null;
  awayPoints: number | null;
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

function emptyResponse(matchId: number | null): ComparisonResponse {
  return {
    matchId,
    items: [],
    updatedAt: null,
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

function formatAvg(value: number): string {
  return value.toFixed(1);
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function loadResultSymbol(teamGoals: number, opponentGoals: number): "W" | "D" | "L" {
  if (teamGoals > opponentGoals) return "W";
  if (teamGoals < opponentGoals) return "L";
  return "D";
}

function buildTeamFormMetrics(
  teamId: number | null,
  teamName: string,
  matches: MatchRow[]
): TeamFormMetrics {
  if (teamId === null || matches.length === 0) {
    return {
      teamId,
      teamName,
      matchesCount: 0,
      points: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsScored: 0,
      goalsConceded: 0,
      avgGoalsScored: 0,
      avgGoalsConceded: 0,
      winRate: 0,
      bttsCount: 0,
      over25Count: 0,
      cleanSheets: 0,
      form: "—",
    };
  }

  const chronological = [...matches].reverse();

  let points = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsScored = 0;
  let goalsConceded = 0;
  let bttsCount = 0;
  let over25Count = 0;
  let cleanSheets = 0;

  const symbols: string[] = [];

  for (const match of chronological) {
    const isHome = match.home_team_id === teamId;
    const isAway = match.away_team_id === teamId;

    if (!isHome && !isAway) continue;
    if (match.home_score === null || match.away_score === null) continue;

    const teamGoals = isHome ? match.home_score : match.away_score;
    const opponentGoals = isHome ? match.away_score : match.home_score;

    goalsScored += teamGoals;
    goalsConceded += opponentGoals;

    if (opponentGoals === 0) {
      cleanSheets += 1;
    }

    if (teamGoals > 0 && opponentGoals > 0) {
      bttsCount += 1;
    }

    if (teamGoals + opponentGoals > 2) {
      over25Count += 1;
    }

    const symbol = loadResultSymbol(teamGoals, opponentGoals);
    symbols.push(symbol);

    if (symbol === "W") {
      wins += 1;
      points += 3;
    } else if (symbol === "D") {
      draws += 1;
      points += 1;
    } else {
      losses += 1;
    }
  }

  const matchesCount = symbols.length;

  return {
    teamId,
    teamName,
    matchesCount,
    points,
    wins,
    draws,
    losses,
    goalsScored,
    goalsConceded,
    avgGoalsScored: matchesCount > 0 ? goalsScored / matchesCount : 0,
    avgGoalsConceded: matchesCount > 0 ? goalsConceded / matchesCount : 0,
    winRate: matchesCount > 0 ? (wins / matchesCount) * 100 : 0,
    bttsCount,
    over25Count,
    cleanSheets,
    form: matchesCount > 0 ? symbols.join("-") : "—",
  };
}

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdmin>;

async function loadRecentTeamMatches(
  supabase: SupabaseAdminClient,
  teamId: number | null,
  beforeUtcDate: string | null
): Promise<MatchRow[]> {
  if (teamId === null) return [];

  let query = supabase
    .from("matches")
    .select(
      "id, utc_date, status, competition_name, home_team, away_team, home_team_id, away_team_id, home_score, away_score, last_sync_at"
    )
    .eq("status", "FINISHED")
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

function normalizeTableSnapshot(input: unknown): TableSnapshot | null {
  if (typeof input !== "object" || input === null) return null;

  const row = input as Record<string, unknown>;

  const homeRaw =
    typeof row.home === "object" && row.home !== null
      ? (row.home as Record<string, unknown>)
      : {};

  const awayRaw =
    typeof row.away === "object" && row.away !== null
      ? (row.away as Record<string, unknown>)
      : {};

  const homeTeamId = safeNumber(homeRaw.teamId);
  const awayTeamId = safeNumber(awayRaw.teamId);

  const rows = Array.isArray(row.rows) ? row.rows : [];

  let homePosition: number | null = null;
  let awayPosition: number | null = null;
  let homePoints: number | null = null;
  let awayPoints: number | null = null;

  for (const entry of rows) {
    if (typeof entry !== "object" || entry === null) continue;

    const tableRow = entry as Record<string, unknown>;
    const teamId = safeNumber(tableRow.teamId);
    const position = safeNumber(tableRow.position);
    const points = safeNumber(tableRow.points);

    if (teamId !== null && homeTeamId !== null && teamId === homeTeamId) {
      homePosition = position;
      homePoints = points;
    }

    if (teamId !== null && awayTeamId !== null && teamId === awayTeamId) {
      awayPosition = position;
      awayPoints = points;
    }
  }

  return {
    totalRows: rows.length,
    updatedAt: safeNullableString(row.updatedAt),
    homePosition,
    awayPosition,
    homePoints,
    awayPoints,
  };
}

async function loadTableSnapshot(
  request: NextRequest,
  matchId: number
): Promise<TableSnapshot | null> {
  try {
    const url = new URL("/api/match-center/table", request.nextUrl.origin);
    url.searchParams.set("matchId", String(matchId));

    const response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const json: unknown = await response.json();
    return normalizeTableSnapshot(json);
  } catch {
    return null;
  }
}

function buildComparisonItems(
  homeMetrics: TeamFormMetrics,
  awayMetrics: TeamFormMetrics,
  tableSnapshot: TableSnapshot | null
): ComparisonItem[] {
  const items: ComparisonItem[] = [];

  if (
    tableSnapshot &&
    tableSnapshot.homePosition !== null &&
    tableSnapshot.awayPosition !== null
  ) {
    const totalTeams =
      tableSnapshot.totalRows > 0
        ? tableSnapshot.totalRows
        : Math.max(tableSnapshot.homePosition, tableSnapshot.awayPosition);

    items.push({
      key: "table_position",
      label: "Pozycja ligowa",
      homeValue: `#${tableSnapshot.homePosition}`,
      awayValue: `#${tableSnapshot.awayPosition}`,
      homeNumeric: totalTeams + 1 - tableSnapshot.homePosition,
      awayNumeric: totalTeams + 1 - tableSnapshot.awayPosition,
      suffix: "",
    });
  }

  if (
    tableSnapshot &&
    tableSnapshot.homePoints !== null &&
    tableSnapshot.awayPoints !== null
  ) {
    items.push({
      key: "table_points",
      label: "Punkty w tabeli",
      homeValue: String(tableSnapshot.homePoints),
      awayValue: String(tableSnapshot.awayPoints),
      homeNumeric: tableSnapshot.homePoints,
      awayNumeric: tableSnapshot.awayPoints,
      suffix: "",
    });
  }

  items.push({
    key: "form_last5",
    label: "Forma (5)",
    homeValue:
      homeMetrics.matchesCount > 0
        ? `${homeMetrics.form} • ${homeMetrics.points} pkt`
        : "—",
    awayValue:
      awayMetrics.matchesCount > 0
        ? `${awayMetrics.form} • ${awayMetrics.points} pkt`
        : "—",
    homeNumeric: homeMetrics.points,
    awayNumeric: awayMetrics.points,
    suffix: "",
  });

  items.push({
    key: "wins_last5",
    label: "Wygrane (5)",
    homeValue: String(homeMetrics.wins),
    awayValue: String(awayMetrics.wins),
    homeNumeric: homeMetrics.wins,
    awayNumeric: awayMetrics.wins,
    suffix: "",
  });

  items.push({
    key: "win_rate_last5",
    label: "Win rate",
    homeValue: formatPercent(homeMetrics.winRate),
    awayValue: formatPercent(awayMetrics.winRate),
    homeNumeric: homeMetrics.winRate,
    awayNumeric: awayMetrics.winRate,
    suffix: "%",
  });

  items.push({
    key: "avg_goals_scored_last5",
    label: "Śr. gole strzelone",
    homeValue: formatAvg(homeMetrics.avgGoalsScored),
    awayValue: formatAvg(awayMetrics.avgGoalsScored),
    homeNumeric: homeMetrics.avgGoalsScored,
    awayNumeric: awayMetrics.avgGoalsScored,
    suffix: "",
  });

  items.push({
    key: "avg_goals_conceded_last5",
    label: "Śr. gole stracone",
    homeValue: formatAvg(homeMetrics.avgGoalsConceded),
    awayValue: formatAvg(awayMetrics.avgGoalsConceded),
    homeNumeric: homeMetrics.avgGoalsConceded,
    awayNumeric: awayMetrics.avgGoalsConceded,
    suffix: "",
  });

  items.push({
    key: "btts_last5",
    label: "BTTS (5)",
    homeValue: String(homeMetrics.bttsCount),
    awayValue: String(awayMetrics.bttsCount),
    homeNumeric: homeMetrics.bttsCount,
    awayNumeric: awayMetrics.bttsCount,
    suffix: "",
  });

  items.push({
    key: "over25_last5",
    label: "Over 2.5 (5)",
    homeValue: String(homeMetrics.over25Count),
    awayValue: String(awayMetrics.over25Count),
    homeNumeric: homeMetrics.over25Count,
    awayNumeric: awayMetrics.over25Count,
    suffix: "",
  });

  items.push({
    key: "clean_sheets_last5",
    label: "Czyste konta (5)",
    homeValue: String(homeMetrics.cleanSheets),
    awayValue: String(awayMetrics.cleanSheets),
    homeNumeric: homeMetrics.cleanSheets,
    awayNumeric: awayMetrics.cleanSheets,
    suffix: "",
  });

  return items;
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

    const [homeRecentMatches, awayRecentMatches, tableSnapshot] =
      await Promise.all([
        loadRecentTeamMatches(
          supabase,
          currentMatch.home_team_id,
          safeNullableString(currentMatch.utc_date)
        ),
        loadRecentTeamMatches(
          supabase,
          currentMatch.away_team_id,
          safeNullableString(currentMatch.utc_date)
        ),
        loadTableSnapshot(request, matchId),
      ]);

    const homeMetrics = buildTeamFormMetrics(
      currentMatch.home_team_id,
      currentMatch.home_team,
      homeRecentMatches
    );

    const awayMetrics = buildTeamFormMetrics(
      currentMatch.away_team_id,
      currentMatch.away_team,
      awayRecentMatches
    );

    const items = buildComparisonItems(homeMetrics, awayMetrics, tableSnapshot);

    const updatedAt =
      currentMatch.last_sync_at ??
      tableSnapshot?.updatedAt ??
      homeRecentMatches[0]?.last_sync_at ??
      awayRecentMatches[0]?.last_sync_at ??
      currentMatch.utc_date ??
      new Date().toISOString();

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