// app/api/import/standings/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";
const DEFAULT_COMPETITIONS = ["CL", "PL", "BL1", "FL1", "SA", "PD", "WC"] as const;

type ImportBody = {
  competitions?: string[];
  season?: string;
  snapshotDate?: string; // YYYY-MM-DD
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ error: message, extra }, { status });
}

function isYYYYMMDD(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function fdFetch(path: string) {
  const token =
    process.env.FOOTBALL_DATA_TOKEN || process.env.FOOTBALL_DATA_API_KEY;

  if (!token) {
    throw new Error("Missing FOOTBALL_DATA_TOKEN (or FOOTBALL_DATA_API_KEY)");
  }

  const r = await fetch(`${FOOTBALL_DATA_BASE}${path}`, {
    headers: {
      "X-Auth-Token": token,
    },
    cache: "no-store",
  });

  const text = await r.text();

  let payload: any = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text?.slice(0, 500) || "" };
  }

  if (!r.ok) {
    throw new Error(
      payload?.message ||
        payload?.error ||
        `football-data error (HTTP ${r.status})`
    );
  }

  return payload;
}

function pickTable(standingsJson: any) {
  const standings = Array.isArray(standingsJson?.standings)
    ? standingsJson.standings
    : [];

  const total =
    standings.find((x: any) => x?.type === "TOTAL" && Array.isArray(x?.table)) ??
    standings.find((x: any) => Array.isArray(x?.table)) ??
    null;

  return Array.isArray(total?.table) ? total.table : [];
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    let body: ImportBody = {};

    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const competitions =
      Array.isArray(body.competitions) && body.competitions.length
        ? body.competitions.map(String)
        : [...DEFAULT_COMPETITIONS];

    const snapshotDate = isYYYYMMDD(body.snapshotDate)
      ? body.snapshotDate
      : new Date().toISOString().slice(0, 10);

    const season =
      typeof body.season === "string" && body.season.trim()
        ? body.season.trim()
        : null;

    const sb = supabaseAdmin();

    const results: any[] = [];
    let competitionsUpserted = 0;
    let teamsUpserted = 0;
    let snapshotsUpserted = 0;

    for (const code of competitions) {
      const path = season
        ? `/competitions/${encodeURIComponent(code)}/standings?season=${encodeURIComponent(season)}`
        : `/competitions/${encodeURIComponent(code)}/standings`;

      const standingsJson = await fdFetch(path);

      const competition = standingsJson?.competition ?? {};
      const area = standingsJson?.area ?? {};
      const seasonObj = standingsJson?.season ?? {};
      const table = pickTable(standingsJson);

      if (!table.length) {
        results.push({
          competition: code,
          ok: true,
          rows: 0,
          note: "No standings rows returned",
        });
        continue;
      }

      const competitionId = String(competition?.code || code);
      const competitionName = String(competition?.name || code);
      const competitionType =
        competition?.type != null ? String(competition.type) : null;
      const areaName = area?.name != null ? String(area.name) : null;
      const emblem = competition?.emblem != null ? String(competition.emblem) : null;

      const seasonLabel =
        season ||
        (seasonObj?.startDate
          ? String(seasonObj.startDate).slice(0, 4)
          : new Date().getUTCFullYear().toString());

      const { error: compErr } = await sb.from("competitions").upsert(
        {
          id: competitionId,
          name: competitionName,
          type: competitionType,
          area_name: areaName,
          emblem,
          last_sync_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      if (compErr) {
        throw new Error(`competitions upsert failed (${code}): ${compErr.message}`);
      }

      competitionsUpserted += 1;

      const teamRows = table
        .map((row: any) => {
          const team = row?.team;
          const teamId = Number(team?.id);
          if (!Number.isFinite(teamId)) return null;

          return {
            id: teamId,
            name: String(team?.name || `Team ${teamId}`),
            short_name: team?.shortName != null ? String(team.shortName) : null,
            tla: team?.tla != null ? String(team.tla) : null,
            crest: team?.crest != null ? String(team.crest) : null,
            area_name: areaName,
            last_sync_at: new Date().toISOString(),
          };
        })
        .filter(Boolean);

      if (teamRows.length) {
        const { error: teamErr } = await sb
          .from("teams")
          .upsert(teamRows, { onConflict: "id" });

        if (teamErr) {
          throw new Error(`teams upsert failed (${code}): ${teamErr.message}`);
        }

        teamsUpserted += teamRows.length;
      }

      const snapshotRows = table
        .map((row: any) => {
          const team = row?.team;
          const teamId = Number(team?.id);
          if (!Number.isFinite(teamId)) return null;

          return {
            competition_id: competitionId,
            team_id: teamId,
            season: seasonLabel,
            snapshot_date: snapshotDate,

            position: Number(row?.position ?? 0),
            played_games: Number(row?.playedGames ?? 0),

            won: Number(row?.won ?? 0),
            draw: Number(row?.draw ?? 0),
            lost: Number(row?.lost ?? 0),

            goals_for: Number(row?.goalsFor ?? 0),
            goals_against: Number(row?.goalsAgainst ?? 0),
            goal_difference: Number(row?.goalDifference ?? 0),

            points: Number(row?.points ?? 0),
          };
        })
        .filter(Boolean);

      if (snapshotRows.length) {
        const { error: snapErr } = await sb
          .from("standings_snapshots")
          .upsert(snapshotRows, {
            onConflict: "competition_id,team_id,season,snapshot_date",
          });

        if (snapErr) {
          throw new Error(
            `standings_snapshots upsert failed (${code}): ${snapErr.message}`
          );
        }

        snapshotsUpserted += snapshotRows.length;
      }

      results.push({
        competition: competitionId,
        competitionName,
        season: seasonLabel,
        rows: snapshotRows.length,
        ok: true,
      });
    }

    return NextResponse.json({
      ok: true,
      snapshotDate,
      season,
      competitions,
      competitionsUpserted,
      teamsUpserted,
      snapshotsUpserted,
      results,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || "Server error",
      },
      { status: 500 }
    );
  }
}