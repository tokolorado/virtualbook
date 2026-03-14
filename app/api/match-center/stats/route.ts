// app/api/match-center/stats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MatchRow = {
  id: number | string;
  home_team: string;
  away_team: string;
  home_team_id: number | null;
  away_team_id: number | null;
};

type MatchTeamStatsRow = {
  team_id: number | null;
  shots: number | null;
  shots_on_target: number | null;
  possession: number | string | null;
  corners: number | null;
  fouls: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  created_at: string;
};

type StatsMap = {
  shots: number | null;
  shotsOnTarget: number | null;
  possession: number | null;
  corners: number | null;
  fouls: number | null;
  yellowCards: number | null;
  redCards: number | null;
};

type SidePayload = {
  teamId: number | null;
  teamName: string;
  stats: StatsMap;
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

function safeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function emptyStats(): StatsMap {
  return {
    shots: null,
    shotsOnTarget: null,
    possession: null,
    corners: null,
    fouls: null,
    yellowCards: null,
    redCards: null,
  };
}

function normalizeStatsRow(row: MatchTeamStatsRow | null | undefined): StatsMap {
  if (!row) return emptyStats();

  return {
    shots: safeNumber(row.shots),
    shotsOnTarget: safeNumber(row.shots_on_target),
    possession: safeNumber(row.possession),
    corners: safeNumber(row.corners),
    fouls: safeNumber(row.fouls),
    yellowCards: safeNumber(row.yellow_cards),
    redCards: safeNumber(row.red_cards),
  };
}

function formatStatValue(value: number | null, suffix = ""): string {
  if (value === null) return "—";

  if (suffix === "%") {
    const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1);
    return `${rounded}${suffix}`;
  }

  return `${value}${suffix}`;
}

function buildItem(params: {
  key: string;
  label: string;
  homeNumeric: number | null;
  awayNumeric: number | null;
  suffix?: string;
}): StatsItem {
  const suffix = params.suffix ?? "";

  return {
    key: params.key,
    label: params.label,
    homeValue: formatStatValue(params.homeNumeric, suffix),
    awayValue: formatStatValue(params.awayNumeric, suffix),
    homeNumeric: params.homeNumeric,
    awayNumeric: params.awayNumeric,
    suffix,
  };
}

export async function GET(request: NextRequest) {
  try {
    const matchIdRaw = request.nextUrl.searchParams.get("matchId");
    const matchId = safeNumber(matchIdRaw);

    if (matchId === null) {
      return NextResponse.json(
        { error: "Missing or invalid matchId" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    const { data: matchData, error: matchError } = await sb
      .from("matches")
      .select("id, home_team, away_team, home_team_id, away_team_id")
      .eq("id", matchId)
      .maybeSingle();

    if (matchError) {
      return NextResponse.json(
        { error: `Failed to load match: ${matchError.message}` },
        { status: 500 }
      );
    }

    if (!matchData) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const match = matchData as MatchRow;

    const { data: statsData, error: statsError } = await sb
      .from("match_team_stats")
      .select(
        "team_id, shots, shots_on_target, possession, corners, fouls, yellow_cards, red_cards, created_at"
      )
      .eq("match_id", matchId);

    if (statsError) {
      return NextResponse.json(
        { error: `Failed to load match stats: ${statsError.message}` },
        { status: 500 }
      );
    }

    const rows = (statsData ?? []) as MatchTeamStatsRow[];

    const homeTeamId = safeNumber(match.home_team_id);
    const awayTeamId = safeNumber(match.away_team_id);

    let homeRow: MatchTeamStatsRow | null = null;
    let awayRow: MatchTeamStatsRow | null = null;

    if (homeTeamId !== null) {
      homeRow = rows.find((row) => safeNumber(row.team_id) === homeTeamId) ?? null;
    }

    if (awayTeamId !== null) {
      awayRow = rows.find((row) => safeNumber(row.team_id) === awayTeamId) ?? null;
    }

    if (!homeRow && rows.length > 0) {
      homeRow = rows[0] ?? null;
    }

    if (!awayRow && rows.length > 1) {
      const fallbackAway =
        rows.find((row) => row !== homeRow) ??
        null;
      awayRow = fallbackAway;
    }

    const homeStats = normalizeStatsRow(homeRow);
    const awayStats = normalizeStatsRow(awayRow);

    const items: StatsItem[] = [
      buildItem({
        key: "shots",
        label: "Strzały",
        homeNumeric: homeStats.shots,
        awayNumeric: awayStats.shots,
      }),
      buildItem({
        key: "shots_on_target",
        label: "Strzały celne",
        homeNumeric: homeStats.shotsOnTarget,
        awayNumeric: awayStats.shotsOnTarget,
      }),
      buildItem({
        key: "possession",
        label: "Posiadanie piłki",
        homeNumeric: homeStats.possession,
        awayNumeric: awayStats.possession,
        suffix: "%",
      }),
      buildItem({
        key: "corners",
        label: "Rzuty rożne",
        homeNumeric: homeStats.corners,
        awayNumeric: awayStats.corners,
      }),
      buildItem({
        key: "fouls",
        label: "Faule",
        homeNumeric: homeStats.fouls,
        awayNumeric: awayStats.fouls,
      }),
      buildItem({
        key: "yellow_cards",
        label: "Żółte kartki",
        homeNumeric: homeStats.yellowCards,
        awayNumeric: awayStats.yellowCards,
      }),
      buildItem({
        key: "red_cards",
        label: "Czerwone kartki",
        homeNumeric: homeStats.redCards,
        awayNumeric: awayStats.redCards,
      }),
    ];

    const updatedAt =
      rows
        .map((row) => row.created_at)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

    const homePayload: SidePayload = {
      teamId: homeTeamId,
      teamName: safeString(match.home_team, "Home"),
      stats: homeStats,
    };

    const awayPayload: SidePayload = {
      teamId: awayTeamId,
      teamName: safeString(match.away_team, "Away"),
      stats: awayStats,
    };

    return NextResponse.json(
      {
        matchId,
        home: homePayload,
        away: awayPayload,
        items,
        updatedAt,
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