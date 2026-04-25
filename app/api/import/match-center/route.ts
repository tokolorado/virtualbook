// app/api/import/match-center/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireCronSecret } from "@/lib/requireCronSecret";
import { resolveSofaScoreEventId } from "@/lib/sofascore/resolveEventId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOFASCORE_BASE = "https://broad-cake-65f1.tobiasrottmann.workers.dev";

type ImportBody = {
  matchId?: number | string;
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
  sort_order: number;
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

async function sofaFetch(path: string) {
  const response = await fetch(`${SOFASCORE_BASE}${path}`, {
    method: "GET",
    cache: "no-store",
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9,pl;q=0.8",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      referer: "https://www.sofascore.com/",
      origin: "https://www.sofascore.com",
    },
  });

  const text = await response.text();

  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    throw new Error(`SofaScore fetch failed ${path}: ${response.status}`);
  }

  return payload;
}

function getTeamName(team: Record<string, unknown> | null, fallback: string) {
  return (
    safeNullableString(team?.name) ??
    safeNullableString(team?.shortName) ??
    fallback
  );
}

function getCoachName(teamLineup: Record<string, unknown> | null) {
  const manager = asRecord(teamLineup?.manager);
  return safeNullableString(manager?.name);
}

function getFormation(teamLineup: Record<string, unknown> | null) {
  return safeNullableString(teamLineup?.formation);
}

function toPlayerRows(
  matchId: number,
  side: "home" | "away",
  playersRaw: unknown[]
): LineupPlayerInsert[] {
  return playersRaw.map((item, index) => {
    const row = asRecord(item) ?? {};
    const player = asRecord(row.player) ?? row;

    const isSubstitute =
      safeBoolean(row.substitute) ||
      safeString(row.type).toLowerCase() === "substitute";

    return {
      match_id: matchId,
      side,
      bucket: isSubstitute ? "bench" : "starter",
      player_name:
        safeNullableString(player.name) ??
        safeNullableString(player.shortName) ??
        `${side}-${index + 1}`,
      shirt_number:
        safeNumber(player.jerseyNumber) ??
        safeNumber(player.shirtNumber) ??
        safeNumber(row.jerseyNumber) ??
        safeNumber(row.shirtNumber),
      position:
        safeNullableString(player.position) ??
        safeNullableString(row.position),
      captain: safeBoolean(row.captain),
      sort_order: index,
    };
  });
}

function normalizeStatName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function numberFromStat(value: unknown): number | null {
  if (typeof value === "string") {
    const cleaned = value.replace("%", "").trim();
    return safeNumber(cleaned);
  }

  return safeNumber(value);
}

function emptyStats(matchId: number, teamId: number): TeamStatsInsert {
  return {
    match_id: matchId,
    team_id: teamId,
    shots: null,
    shots_on_target: null,
    possession: null,
    corners: null,
    fouls: null,
    yellow_cards: null,
    red_cards: null,
  };
}

function applyStat(
  target: TeamStatsInsert,
  statName: string,
  value: number | null
) {
  if (value === null) return;

  const key = normalizeStatName(statName);

  if (["total_shots", "shots"].includes(key)) target.shots = value;
  if (["shots_on_target", "shots_on_goal"].includes(key)) {
    target.shots_on_target = value;
  }
  if (["ball_possession", "possession"].includes(key)) target.possession = value;
  if (["corner_kicks", "corners"].includes(key)) target.corners = value;
  if (["fouls"].includes(key)) target.fouls = value;
  if (["yellow_cards"].includes(key)) target.yellow_cards = value;
  if (["red_cards"].includes(key)) target.red_cards = value;
}

function parseStatsRows(
  matchId: number,
  homeTeamId: number | null,
  awayTeamId: number | null,
  statisticsPayload: unknown
): TeamStatsInsert[] {
  if (homeTeamId === null || awayTeamId === null) return [];

  const home = emptyStats(matchId, homeTeamId);
  const away = emptyStats(matchId, awayTeamId);

  const root = asRecord(statisticsPayload);
  const periods = asArray(root?.statistics);

  for (const period of periods) {
    const periodRow = asRecord(period);
    const groups = asArray(periodRow?.groups);

    for (const group of groups) {
      const groupRow = asRecord(group);
      const items = asArray(groupRow?.statisticsItems);

      for (const item of items) {
        const stat = asRecord(item);
        const name = safeString(stat?.name);

        applyStat(home, name, numberFromStat(stat?.homeValue ?? stat?.home));
        applyStat(away, name, numberFromStat(stat?.awayValue ?? stat?.away));
      }
    }
  }

  return [home, away];
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

    const sofascoreEventId = await resolveSofaScoreEventId(sb, matchId);

    if (!sofascoreEventId) {
      return jsonError("Missing SofaScore mapping for this match.", 404, {
        matchId,
        needsMapping: true,
      });
    }

    let eventPayload: unknown;

    try {
      eventPayload = await sofaFetch(`/event/${sofascoreEventId}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "SofaScore event fetch failed";

      return NextResponse.json(
        {
          ok: false,
          matchId,
          sofascoreEventId,
          needsExternalImport: true,
          error: message,
        },
        { status: 202 }
      );
    }

    const [lineupsPayload, statisticsPayload] = await Promise.all([
      sofaFetch(`/lineups/${sofascoreEventId}`).catch((error) => ({
        _error: error instanceof Error ? error.message : "Lineups fetch failed",
      })),
      sofaFetch(`/statistics/${sofascoreEventId}`).catch((error) => ({
        _error:
          error instanceof Error ? error.message : "Statistics fetch failed",
      })),
    ]);

    const eventRoot = asRecord(eventPayload);
    const event = asRecord(eventRoot?.event) ?? eventRoot;

    const homeTeamRaw = asRecord(event?.homeTeam);
    const awayTeamRaw = asRecord(event?.awayTeam);
    const tournament = asRecord(event?.tournament);
    const uniqueTournament = asRecord(tournament?.uniqueTournament);

    const homeTeamId = safeNumber(homeTeamRaw?.id);
    const awayTeamId = safeNumber(awayTeamRaw?.id);

    const homeTeamName = getTeamName(homeTeamRaw, "Home");
    const awayTeamName = getTeamName(awayTeamRaw, "Away");

    const lineupsRoot = asRecord(lineupsPayload);
    const homeLineup = asRecord(lineupsRoot?.home);
    const awayLineup = asRecord(lineupsRoot?.away);

    const homePlayers = asArray(homeLineup?.players);
    const awayPlayers = asArray(awayLineup?.players);

    const headerRow: LineupHeaderUpsert = {
      match_id: matchId,
      home_team_name: homeTeamName,
      away_team_name: awayTeamName,
      home_formation: getFormation(homeLineup),
      away_formation: getFormation(awayLineup),
      home_status: homePlayers.length > 0 ? "confirmed" : null,
      away_status: awayPlayers.length > 0 ? "confirmed" : null,
      home_coach: getCoachName(homeLineup),
      away_coach: getCoachName(awayLineup),
    };

    const playerRows: LineupPlayerInsert[] = [
      ...toPlayerRows(matchId, "home", homePlayers),
      ...toPlayerRows(matchId, "away", awayPlayers),
    ];

    const statsRows = parseStatsRows(
      matchId,
      homeTeamId,
      awayTeamId,
      statisticsPayload
    );

    const { error: matchPatchError } = await sb
      .from("matches")
      .update({
        competition_name:
          safeNullableString(uniqueTournament?.name) ??
          safeNullableString(tournament?.name) ??
          undefined,
        home_team: homeTeamName,
        away_team: awayTeamName,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
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
      sofascoreEventId,
      competition: {
        name:
          safeNullableString(uniqueTournament?.name) ??
          safeNullableString(tournament?.name),
      },
      status: safeNullableString(event?.status),
      home: {
        teamId: homeTeamId,
        teamName: homeTeamName,
        formation: headerRow.home_formation,
        coach: headerRow.home_coach,
        status: headerRow.home_status,
        playersCount: homePlayers.length,
      },
      away: {
        teamId: awayTeamId,
        teamName: awayTeamName,
        formation: headerRow.away_formation,
        coach: headerRow.away_coach,
        status: headerRow.away_status,
        playersCount: awayPlayers.length,
      },
      hasLineups: playerRows.length > 0,
      hasStats: statsRows.length > 0,
      playersInserted: playerRows.length,
      statsInserted: statsRows.length,
      lineupsFetchError: safeNullableString(asRecord(lineupsPayload)?._error),
      statisticsFetchError: safeNullableString(
        asRecord(statisticsPayload)?._error
      ),
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