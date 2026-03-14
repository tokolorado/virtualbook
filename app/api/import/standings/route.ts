// app/api/import/standings/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireCronSecret } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";
const DEFAULT_COMPETITIONS = ["CL", "PL", "BL1", "FL1", "SA", "PD", "WC"] as const;

type ImportBody = {
  competitions?: string[];
  season?: string;
};

type JsonObject = Record<string, unknown>;

type StandingRowInsert = {
  competition_id: string;
  competition_name: string | null;
  season: string;
  matchday: number | null;
  team_id: number;
  team_name: string;
  position: number;
  played: number;
  won: number;
  draw: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
  form: string | null;
  source: string;
};

function jsonError(message: string, status = 400, extra?: unknown) {
  return NextResponse.json({ error: message, extra }, { status });
}

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null
    ? (value as JsonObject)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeText(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return fallback;
}

function nullableText(value: unknown): string | null {
  const text = safeText(value, "");
  return text.length > 0 ? text : null;
}

function safeInt(value: unknown, fallback: number | null = null): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

async function fdFetch(path: string): Promise<unknown> {
  const token =
    process.env.FOOTBALL_DATA_TOKEN || process.env.FOOTBALL_DATA_API_KEY;

  if (!token) {
    throw new Error("Missing FOOTBALL_DATA_TOKEN (or FOOTBALL_DATA_API_KEY)");
  }

  const response = await fetch(`${FOOTBALL_DATA_BASE}${path}`, {
    headers: {
      "X-Auth-Token": token,
    },
    cache: "no-store",
  });

  const text = await response.text();

  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    payload = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    const payloadObj = asObject(payload);
    throw new Error(
      safeText(payloadObj.message) ||
        safeText(payloadObj.error) ||
        `football-data error (HTTP ${response.status})`
    );
  }

  return payload;
}

function pickTable(payload: unknown): JsonObject[] {
  const root = asObject(payload);
  const standings = asArray(root.standings);

  const preferred =
    standings.find((entry) => {
      const row = asObject(entry);
      return safeText(row.type) === "TOTAL" && Array.isArray(row.table);
    }) ??
    standings.find((entry) => {
      const row = asObject(entry);
      return Array.isArray(row.table);
    }) ??
    null;

  const preferredObj = asObject(preferred);
  return asArray(preferredObj.table).map((entry) => asObject(entry));
}

function resolveSeasonLabel(seasonValue: string | null, seasonObj: JsonObject): string {
  if (seasonValue) return seasonValue;

  const startDate = safeText(seasonObj.startDate);
  if (startDate.length >= 4) {
    return startDate.slice(0, 4);
  }

  return String(new Date().getUTCFullYear());
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

    const competitionsSource =
      Array.isArray(body.competitions) && body.competitions.length > 0
        ? body.competitions
        : [...DEFAULT_COMPETITIONS];

    const competitions = Array.from(
      new Set(
        competitionsSource
          .map((value) => safeText(value).toUpperCase())
          .filter((value) => value.length > 0)
      )
    );

    if (competitions.length === 0) {
      return jsonError("No competitions provided", 400);
    }

    const requestedSeason =
      typeof body.season === "string" && body.season.trim().length > 0
        ? body.season.trim()
        : null;

    const sb = supabaseAdmin();

    const results: Array<{
      competition: string;
      competitionName: string;
      season: string;
      rows: number;
      ok: boolean;
      note?: string;
    }> = [];

    let competitionsUpserted = 0;
    let standingsRowsUpserted = 0;

    for (const code of competitions) {
      const path = requestedSeason
        ? `/competitions/${encodeURIComponent(code)}/standings?season=${encodeURIComponent(
            requestedSeason
          )}`
        : `/competitions/${encodeURIComponent(code)}/standings`;

      const payload = await fdFetch(path);
      const root = asObject(payload);

      const competition = asObject(root.competition);
      const seasonObj = asObject(root.season);
      const table = pickTable(payload);

      const competitionId = safeText(competition.code, code).toUpperCase();
      const competitionName = safeText(competition.name, competitionId);
      const seasonLabel = resolveSeasonLabel(requestedSeason, seasonObj);
      const currentMatchday = safeInt(seasonObj.currentMatchday, null);

      if (table.length === 0) {
        results.push({
          competition: competitionId,
          competitionName,
          season: seasonLabel,
          rows: 0,
          ok: true,
          note: "No standings rows returned",
        });
        continue;
      }

      const rows: StandingRowInsert[] = table
        .map<StandingRowInsert | null>((entry) => {
          const team = asObject(entry.team);
          const teamId = safeInt(team.id, null);

          if (teamId == null) return null;

          return {
            competition_id: competitionId,
            competition_name: competitionName || null,
            season: seasonLabel,
            matchday: currentMatchday,
            team_id: teamId,
            team_name: safeText(team.name, `Team ${teamId}`),
            position: safeInt(entry.position, 0) ?? 0,
            played: safeInt(entry.playedGames, 0) ?? 0,
            won: safeInt(entry.won, 0) ?? 0,
            draw: safeInt(entry.draw, 0) ?? 0,
            lost: safeInt(entry.lost, 0) ?? 0,
            goals_for: safeInt(entry.goalsFor, 0) ?? 0,
            goals_against: safeInt(entry.goalsAgainst, 0) ?? 0,
            goal_diff: safeInt(entry.goalDifference, 0) ?? 0,
            points: safeInt(entry.points, 0) ?? 0,
            form: nullableText(entry.form),
            source: "football-data",
          };
        })
        .filter((row): row is StandingRowInsert => row !== null);

      if (rows.length === 0) {
        results.push({
          competition: competitionId,
          competitionName,
          season: seasonLabel,
          rows: 0,
          ok: true,
          note: "No valid standings rows after normalization",
        });
        continue;
      }

      const { error: standingsErr } = await sb.from("standings").upsert(rows, {
        onConflict: "competition_id,season,team_id",
      });

      if (standingsErr) {
        throw new Error(
          `standings upsert failed (${competitionId}): ${standingsErr.message}`
        );
      }

      competitionsUpserted += 1;
      standingsRowsUpserted += rows.length;

      results.push({
        competition: competitionId,
        competitionName,
        season: seasonLabel,
        rows: rows.length,
        ok: true,
      });
    }

    return NextResponse.json({
      ok: true,
      competitions,
      requestedSeason,
      competitionsUpserted,
      standingsRowsUpserted,
      results,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Server error";

    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 }
    );
  }
}