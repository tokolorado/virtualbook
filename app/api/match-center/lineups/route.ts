// app/api/match-center/lineups/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { resolveSofaScoreEventId } from "@/lib/sofascore/resolveEventId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Side = "home" | "away";
type Bucket = "starter" | "bench";

type LineupPlayerRow = {
  id: string;
  match_id: number;
  side: Side;
  bucket: Bucket;
  player_name: string;
  shirt_number: number | null;
  position: string | null;
  captain: boolean | null;
  sort_order: number | null;
};

type LineupMetaRow = {
  match_id: number;
  home_team_name: string | null;
  away_team_name: string | null;
  home_formation: string | null;
  away_formation: string | null;
  home_status: string | null;
  away_status: string | null;
  home_coach: string | null;
  away_coach: string | null;
};

type LineupPlayer = {
  id: string;
  name: string;
  number?: number | null;
  position?: string | null;
  captain?: boolean | null;
};

type LineupTeam = {
  teamName: string;
  formation?: string | null;
  status?: string | null;
  coach?: string | null;
  starters: LineupPlayer[];
  bench: LineupPlayer[];
};

type LineupsResponse = {
  matchId: number;
  sofascoreEventId: number | null;
  needsMapping: boolean;
  home: LineupTeam | null;
  away: LineupTeam | null;
};

function toMatchId(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizePlayers(
  rows: LineupPlayerRow[],
  side: Side,
  bucket: Bucket
): LineupPlayer[] {
  return rows
    .filter((row) => row.side === side && row.bucket === bucket)
    .sort((a, b) => {
      const aOrder = a.sort_order ?? 9999;
      const bOrder = b.sort_order ?? 9999;

      if (aOrder !== bOrder) return aOrder - bOrder;

      const aNumber = a.shirt_number ?? 999;
      const bNumber = b.shirt_number ?? 999;

      if (aNumber !== bNumber) return aNumber - bNumber;

      return a.player_name.localeCompare(b.player_name);
    })
    .map((row) => ({
      id: row.id,
      name: row.player_name,
      number: row.shirt_number,
      position: row.position,
      captain: row.captain,
    }));
}

function buildTeam(
  meta: LineupMetaRow | null,
  rows: LineupPlayerRow[],
  side: Side
): LineupTeam | null {
  const starters = normalizePlayers(rows, side, "starter");
  const bench = normalizePlayers(rows, side, "bench");

  const hasAnyPlayers = starters.length > 0 || bench.length > 0;
  const hasMeta =
    !!meta &&
    (side === "home"
      ? !!meta.home_team_name ||
        !!meta.home_formation ||
        !!meta.home_status ||
        !!meta.home_coach
      : !!meta.away_team_name ||
        !!meta.away_formation ||
        !!meta.away_status ||
        !!meta.away_coach);

  if (!hasAnyPlayers && !hasMeta) {
    return null;
  }

  if (side === "home") {
    return {
      teamName: meta?.home_team_name || "Gospodarze",
      formation: meta?.home_formation,
      status: meta?.home_status,
      coach: meta?.home_coach,
      starters,
      bench,
    };
  }

  return {
    teamName: meta?.away_team_name || "Goście",
    formation: meta?.away_formation,
    status: meta?.away_status,
    coach: meta?.away_coach,
    starters,
    bench,
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const matchId = toMatchId(url.searchParams.get("matchId"));

    if (!matchId) {
      return NextResponse.json(
        { error: "Missing or invalid matchId" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();
    const sofascoreEventId = await resolveSofaScoreEventId(sb, matchId);

    const [{ data: meta, error: metaError }, { data: players, error: playersError }] =
      await Promise.all([
        sb
          .from("match_lineups")
          .select(
            [
              "match_id",
              "home_team_name",
              "away_team_name",
              "home_formation",
              "away_formation",
              "home_status",
              "away_status",
              "home_coach",
              "away_coach",
            ].join(",")
          )
          .eq("match_id", matchId)
          .maybeSingle<LineupMetaRow>(),
        sb
          .from("match_lineup_players")
          .select(
            [
              "id",
              "match_id",
              "side",
              "bucket",
              "player_name",
              "shirt_number",
              "position",
              "captain",
              "sort_order",
            ].join(",")
          )
          .eq("match_id", matchId)
          .returns<LineupPlayerRow[]>(),
      ]);

    const missingMetaTable =
      typeof metaError?.message === "string" &&
      metaError.message.toLowerCase().includes("relation") &&
      metaError.message.toLowerCase().includes("does not exist");

    const missingPlayersTable =
      typeof playersError?.message === "string" &&
      playersError.message.toLowerCase().includes("relation") &&
      playersError.message.toLowerCase().includes("does not exist");

    if (missingMetaTable || missingPlayersTable) {
      const empty: LineupsResponse = {
        matchId,
        sofascoreEventId,
        needsMapping: !sofascoreEventId,
        home: null,
        away: null,
      };

      return NextResponse.json(empty, { status: 200 });
    }

    if (metaError) {
      return NextResponse.json(
        { error: `match_lineups query failed: ${metaError.message}` },
        { status: 500 }
      );
    }

    if (playersError) {
      return NextResponse.json(
        { error: `match_lineup_players query failed: ${playersError.message}` },
        { status: 500 }
      );
    }

    const safePlayers = players ?? [];

    const response: LineupsResponse = {
      matchId,
      sofascoreEventId,
      needsMapping: !sofascoreEventId,
      home: buildTeam(meta ?? null, safePlayers, "home"),
      away: buildTeam(meta ?? null, safePlayers, "away"),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown lineups endpoint error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}