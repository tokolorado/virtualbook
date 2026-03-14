// app/api/import/match-center/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireCronSecret } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";

type ImportBody = {
  matchId?: number | string;
};

type MatchExistsRow = {
  id: number;
};

type FdTeamNormalized = {
  id: number | null;
  name: string;
  formation: string | null;
  coachName: string | null;
  status: string | null;
  lineup: unknown[];
  bench: unknown[];
  statistics: Record<string, unknown> | null;
};

type LineupHeaderUpsert = {
  match_id: number;
  home_team_name: string;
  away_team_name: string;
  home_formation: string | null;
  away_formation: string | null;
  home_status: string | null;
  away_status: string | null;
  home_coach: string | null;
  away_coach: string | null;
};

type LineupPlayerInsert = {
  match_id: number;
  side: "home" | "away";
  bucket: "starter" | "bench";
  player_name: string;
  shirt_number: number | null;
  position: string | null;
  captain: boolean;
};

type TeamStatsInsert = {
  match_id: number;
  team_id: number;
  shots: number | null;
  shots_on_target: number | null;
  possession: number | null;
  corners: number | null;
  fouls: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
};

function jsonError(message: string, status = 400, extra?: unknown) {
  return NextResponse.json({ error: message, extra }, { status });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

async function fdFetch(path: string) {
  const token =
    process.env.FOOTBALL_DATA_TOKEN || process.env.FOOTBALL_DATA_API_KEY;

  if (!token) {
    throw new Error("Missing FOOTBALL_DATA_TOKEN (or FOOTBALL_DATA_API_KEY)");
  }

  const response = await fetch(`${FOOTBALL_DATA_BASE}${path}`, {
    method: "GET",
    headers: {
      "X-Auth-Token": token,
    },
    cache: "no-store",
  });

  const text = await response.text();

  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    const errorObj = asRecord(payload);
    throw new Error(
      safeString(errorObj?.message) ||
        safeString(errorObj?.error) ||
        `football-data error (HTTP ${response.status})`
    );
  }

  return payload;
}

function normalizeTeamNode(input: unknown, fallbackName: string): FdTeamNormalized {
  const row = asRecord(input) ?? {};
  const coach = asRecord(row.coach);
  const lineup = asArray(row.lineup);
  const bench = asArray(row.bench);
  const statistics = asRecord(row.statistics);

  let status: string | null = null;
  if (lineup.length > 0 || bench.length > 0) {
    status = "confirmed";
  }

  return {
    id: safeNumber(row.id),
    name: safeString(row.name, fallbackName),
    formation: safeNullableString(row.formation),
    coachName: safeNullableString(coach?.name),
    status,
    lineup,
    bench,
    statistics,
  };
}

function toPlayerRows(
  matchId: number,
  side: "home" | "away",
  bucket: "starter" | "bench",
  players: unknown[]
): LineupPlayerInsert[] {
  return players.map((player, index) => {
    const row = asRecord(player) ?? {};

    return {
      match_id: matchId,
      side,
      bucket,
      player_name: safeString(row.name, `${side}-${bucket}-${index + 1}`),
      shirt_number: safeNumber(row.shirtNumber),
      position: safeNullableString(row.position),
      captain: safeBoolean(row.captain),
    };
  });
}

function toStatsRow(
  matchId: number,
  teamId: number | null,
  statistics: Record<string, unknown> | null
): TeamStatsInsert | null {
  if (teamId == null) return null;

  const stats = statistics ?? {};

  return {
    match_id: matchId,
    team_id: teamId,
    shots: safeNumber(stats.shots),
    shots_on_target: safeNumber(stats.shots_on_goal),
    possession: safeNumber(stats.ball_possession),
    corners: safeNumber(stats.corner_kicks),
    fouls: safeNumber(stats.fouls),
    yellow_cards: safeNumber(stats.yellow_cards),
    red_cards: safeNumber(stats.red_cards),
  };
}

export async function POST(req: Request) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const raw = await req.text();

    let body: ImportBody = {};
    try {
      body = raw ? (JSON.parse(raw) as ImportBody) : {};
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const matchId = safeNumber(body.matchId);

    if (matchId == null) {
      return jsonError("Missing or invalid matchId", 400);
    }

    const sb = supabaseAdmin();

    const { data: existingMatch, error: existingMatchError } = await sb
      .from("matches")
      .select("id")
      .eq("id", matchId)
      .maybeSingle();

    if (existingMatchError) {
      return jsonError(
        `Failed to verify match in database: ${existingMatchError.message}`,
        500
      );
    }

    if (!existingMatch) {
      return jsonError(
        "Match does not exist in public.matches. Import it into matches first.",
        404
      );
    }

    const payload = (await fdFetch(`/matches/${matchId}`)) as unknown;
    const root = asRecord(payload);

    if (!root) {
      return jsonError("football-data returned invalid payload", 500);
    }

    const competition = asRecord(root.competition);
    const homeTeamRaw = asRecord(root.homeTeam);
    const awayTeamRaw = asRecord(root.awayTeam);

    const homeTeam = normalizeTeamNode(homeTeamRaw, "Home");
    const awayTeam = normalizeTeamNode(awayTeamRaw, "Away");

    const headerRow: LineupHeaderUpsert = {
      match_id: matchId,
      home_team_name: homeTeam.name,
      away_team_name: awayTeam.name,
      home_formation: homeTeam.formation,
      away_formation: awayTeam.formation,
      home_status: homeTeam.status,
      away_status: awayTeam.status,
      home_coach: homeTeam.coachName,
      away_coach: awayTeam.coachName,
    };

    const playerRows: LineupPlayerInsert[] = [
      ...toPlayerRows(matchId, "home", "starter", homeTeam.lineup),
      ...toPlayerRows(matchId, "home", "bench", homeTeam.bench),
      ...toPlayerRows(matchId, "away", "starter", awayTeam.lineup),
      ...toPlayerRows(matchId, "away", "bench", awayTeam.bench),
    ];

    const statsRows = [
      toStatsRow(matchId, homeTeam.id, homeTeam.statistics),
      toStatsRow(matchId, awayTeam.id, awayTeam.statistics),
    ].filter((row): row is TeamStatsInsert => row !== null);

    const { error: matchPatchError } = await sb
      .from("matches")
      .update({
        competition_name:
          safeNullableString(competition?.name) ?? undefined,
        home_team: homeTeam.name,
        away_team: awayTeam.name,
        home_team_id: homeTeam.id,
        away_team_id: awayTeam.id,
      })
      .eq("id", matchId);

    if (matchPatchError) {
      return jsonError(
        `Failed to patch matches row: ${matchPatchError.message}`,
        500
      );
    }

    const { error: lineupHeaderError } = await sb
      .from("match_lineups")
      .upsert(headerRow, { onConflict: "match_id" });

    if (lineupHeaderError) {
      return jsonError(
        `Failed to upsert match_lineups: ${lineupHeaderError.message}`,
        500
      );
    }

    const { error: deletePlayersError } = await sb
      .from("match_lineup_players")
      .delete()
      .eq("match_id", matchId);

    if (deletePlayersError) {
      return jsonError(
        `Failed to clear old match_lineup_players: ${deletePlayersError.message}`,
        500
      );
    }

    if (playerRows.length > 0) {
      const { error: insertPlayersError } = await sb
        .from("match_lineup_players")
        .insert(playerRows);

      if (insertPlayersError) {
        return jsonError(
          `Failed to insert match_lineup_players: ${insertPlayersError.message}`,
          500
        );
      }
    }

    const { error: deleteStatsError } = await sb
      .from("match_team_stats")
      .delete()
      .eq("match_id", matchId);

    if (deleteStatsError) {
      return jsonError(
        `Failed to clear old match_team_stats: ${deleteStatsError.message}`,
        500
      );
    }

    if (statsRows.length > 0) {
      const { error: insertStatsError } = await sb
        .from("match_team_stats")
        .insert(statsRows);

      if (insertStatsError) {
        return jsonError(
          `Failed to insert match_team_stats: ${insertStatsError.message}`,
          500
        );
      }
    }

    return NextResponse.json({
      ok: true,
      matchId,
      competition: {
        code: safeNullableString(competition?.code),
        name: safeNullableString(competition?.name),
      },
      status: safeNullableString(root.status),
      footballDataLastUpdated: safeNullableString(root.lastUpdated),
      home: {
        teamId: homeTeam.id,
        teamName: homeTeam.name,
        formation: homeTeam.formation,
        coach: homeTeam.coachName,
        status: homeTeam.status,
        lineupCount: homeTeam.lineup.length,
        benchCount: homeTeam.bench.length,
        hasStats: homeTeam.statistics !== null,
      },
      away: {
        teamId: awayTeam.id,
        teamName: awayTeam.name,
        formation: awayTeam.formation,
        coach: awayTeam.coachName,
        status: awayTeam.status,
        lineupCount: awayTeam.lineup.length,
        benchCount: awayTeam.bench.length,
        hasStats: awayTeam.statistics !== null,
      },
      hasLineups: playerRows.length > 0,
      hasStats: statsRows.length > 0,
      playersInserted: playerRows.length,
      statsInserted: statsRows.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json(
      { error: `Unexpected error: ${message}` },
      { status: 500 }
    );
  }
}
