// app/api/match-center/table/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MatchRow = {
  id: number | string;
  competition_id: string;
  competition_name: string | null;
  season: string | null;
  matchday: number | null;
  home_team: string;
  away_team: string;
  home_team_id: number | null;
  away_team_id: number | null;
};

type StandingRow = {
  competition_id: string;
  competition_name: string | null;
  season: string;
  matchday: number | null;
  position: number;
  team_id: number;
  team_name: string;
  played: number | null;
  won: number | null;
  draw: number | null;
  lost: number | null;
  goals_for: number | null;
  goals_against: number | null;
  goal_diff: number | null;
  points: number | null;
};

type TableResponseRow = {
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

export async function GET(request: NextRequest) {
  try {
    const matchIdRaw = request.nextUrl.searchParams.get("matchId");
    const matchId = safeNumber(matchIdRaw);

    if (matchId == null) {
      return NextResponse.json(
        { error: "Missing or invalid matchId" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("matches")
      .select(
        "id, competition_id, competition_name, season, matchday, home_team, away_team, home_team_id, away_team_id"
      )
      .eq("id", matchId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: `Failed to load match: ${error.message}` },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const match = data as MatchRow;

    const competitionId = safeString(match.competition_id);
    const competitionName = safeNullableString(match.competition_name);
    const season = safeNullableString(match.season);
    const matchday = safeNumber(match.matchday);

    const homeTeamId = safeNumber(match.home_team_id);
    const awayTeamId = safeNumber(match.away_team_id);
    const homeTeamName = safeString(match.home_team, "Home");
    const awayTeamName = safeString(match.away_team, "Away");

    let standingsQuery = sb
      .from("standings")
      .select(
        "competition_id, competition_name, season, matchday, position, team_id, team_name, played, won, draw, lost, goals_for, goals_against, goal_diff, points"
      )
      .eq("competition_id", competitionId)
      .order("position", { ascending: true });

    if (season) {
      standingsQuery = standingsQuery.eq("season", season);
    }

    const { data: standingsData, error: standingsError } = await standingsQuery;

    if (standingsError) {
      return NextResponse.json(
        { error: `Failed to load standings: ${standingsError.message}` },
        { status: 500 }
      );
    }

    const standingsRows = (standingsData ?? []) as StandingRow[];

    const rows: TableResponseRow[] = standingsRows.map((row) => ({
      position: safeNumber(row.position) ?? 0,
      teamId: safeNumber(row.team_id),
      teamName: safeString(row.team_name, "Unknown team"),
      played: safeNumber(row.played),
      won: safeNumber(row.won),
      draw: safeNumber(row.draw),
      lost: safeNumber(row.lost),
      goalsFor: safeNumber(row.goals_for),
      goalsAgainst: safeNumber(row.goals_against),
      goalDiff: safeNumber(row.goal_diff),
      points: safeNumber(row.points),
    }));

    const resolvedCompetitionName =
      safeNullableString(standingsRows[0]?.competition_name) ?? competitionName;

    const resolvedSeason =
      safeNullableString(standingsRows[0]?.season) ?? season;

    const resolvedMatchday =
      safeNumber(standingsRows[0]?.matchday) ?? matchday;

    const available = rows.length > 0;

    return NextResponse.json(
      {
        matchId: safeNumber(match.id),
        available,
        reason: available ? null : "NO_STANDINGS_ROWS",
        message: available
          ? null
          : "Brak wierszy standings dla competition_id i season przypisanych do tego meczu.",
        competition: {
          id: competitionId,
          name: resolvedCompetitionName,
          season: resolvedSeason,
          matchday: resolvedMatchday,
        },
        home: {
          teamId: homeTeamId,
          teamName: homeTeamName,
        },
        away: {
          teamId: awayTeamId,
          teamName: awayTeamName,
        },
        highlightTeamIds: [homeTeamId, awayTeamId].filter(
          (value): value is number => value !== null
        ),
        rows,
        updatedAt: null as string | null,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json(
      { error: `Unexpected error: ${message}` },
      { status: 500 }
    );
  }
}