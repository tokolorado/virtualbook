import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { supabaseAdmin } from "@/lib/supabaseServer";
import {
  buildTeamStatSnapshotsFromPricingFeatures,
  type MatchPricingFeatureInputRow,
} from "@/lib/teamStats/snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LOOKBACK_DAYS = 365;
const DEFAULT_AHEAD_DAYS = 30;
const MAX_RANGE_DAYS = 760;
const MAX_SOURCE_ROWS = 10_000;

function isYYYYMMDD(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function utcTodayYYYYMMDD() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysYYYYMMDD(dateYYYYMMDD: string, days: number) {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function isoStartOfUtcDay(dateYYYYMMDD: string) {
  return new Date(`${dateYYYYMMDD}T00:00:00.000Z`).toISOString();
}

function isoStartOfNextUtcDay(dateYYYYMMDD: string) {
  return `${addDaysYYYYMMDD(dateYYYYMMDD, 1)}T00:00:00.000Z`;
}

function safeInt(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function daysBetween(from: string, to: string) {
  const fromTime = new Date(`${from}T00:00:00.000Z`).getTime();
  const toTime = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.round((toTime - fromTime) / 86_400_000);
}

function cronSecretMatches(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const provided =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  return provided === expected;
}

async function authorize(req: Request) {
  if (cronSecretMatches(req)) return null;
  const admin = await requireAdmin(req);
  if (admin.ok) return null;
  return NextResponse.json(
    { ok: false, error: admin.error },
    { status: admin.status }
  );
}

export async function GET(req: Request) {
  const unauthorized = await authorize(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const rawSnapshotDate = url.searchParams.get("snapshotDate");
  const snapshotDate = isYYYYMMDD(rawSnapshotDate)
    ? rawSnapshotDate
    : utcTodayYYYYMMDD();
  const lookbackDays = safeInt(
    url.searchParams.get("lookbackDays"),
    DEFAULT_LOOKBACK_DAYS,
    0,
    MAX_RANGE_DAYS
  );
  const rawFromDate = url.searchParams.get("fromDate");
  const fromDate = isYYYYMMDD(rawFromDate)
    ? rawFromDate
    : addDaysYYYYMMDD(snapshotDate, -lookbackDays);
  const rawThroughDate = url.searchParams.get("throughDate");
  const throughDate = isYYYYMMDD(rawThroughDate)
    ? rawThroughDate
    : addDaysYYYYMMDD(snapshotDate, DEFAULT_AHEAD_DAYS);
  const dryRun = url.searchParams.get("dryRun") === "1";

  if (daysBetween(fromDate, throughDate) < 0) {
    return NextResponse.json(
      { ok: false, error: "fromDate must be before or equal throughDate" },
      { status: 400 }
    );
  }

  if (daysBetween(fromDate, throughDate) > MAX_RANGE_DAYS) {
    return NextResponse.json(
      {
        ok: false,
        error: `Date range too large. Max ${MAX_RANGE_DAYS} days.`,
      },
      { status: 400 }
    );
  }

  try {
    const sb = supabaseAdmin();
    const generatedAt = new Date().toISOString();
    const { data, error } = await sb
      .from("match_pricing_features")
      .select(
        [
          "match_id",
          "source_event_id",
          "competition_id",
          "competition_name",
          "utc_date",
          "status",
          "home_team",
          "away_team",
          "home_team_id",
          "away_team_id",
          "home_score",
          "away_score",
          "expected_home_goals",
          "expected_away_goals",
          "probability_over_15",
          "probability_over_25",
          "probability_over_35",
          "probability_btts_yes",
          "travel_distance_km",
          "raw_features",
        ].join(",")
      )
      .eq("source", "bsd")
      .gte("utc_date", isoStartOfUtcDay(fromDate))
      .lt("utc_date", isoStartOfNextUtcDay(throughDate))
      .order("utc_date", { ascending: true })
      .limit(MAX_SOURCE_ROWS);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: `match_pricing_features read failed: ${error.message}`,
        },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as unknown as MatchPricingFeatureInputRow[];
    const built = buildTeamStatSnapshotsFromPricingFeatures(rows, {
      snapshotDate,
      source: "bsd",
      generatedAt,
      includeAllCompetitions: true,
    });

    if (!dryRun && built.rows.length > 0) {
      const { error: upsertError } = await sb
        .from("team_stat_snapshots")
        .upsert(built.rows, {
          onConflict: "team_id,competition_id,season,snapshot_date,source",
        });

      if (upsertError) {
        return NextResponse.json(
          {
            ok: false,
            error: `team_stat_snapshots upsert failed: ${upsertError.message}`,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      snapshotDate,
      fromDate,
      throughDate,
      generatedAt,
      sourceTable: "match_pricing_features",
      summary: {
        ...built.summary,
        upsertedSnapshots: dryRun ? 0 : built.rows.length,
        limited: rows.length >= MAX_SOURCE_ROWS,
      },
      sample: built.rows.slice(0, 8).map((row) => ({
        teamId: row.team_id,
        teamName: row.team_name,
        competitionId: row.competition_id,
        season: row.season,
        matchesCount: row.matches_count,
        xgForPerGame: row.xg_for_per_game,
        xgAgainstPerGame: row.xg_against_per_game,
        attackStrength: row.attack_strength,
        defenseStrength: row.defense_strength,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "team stat snapshots backfill failed",
      },
      { status: 500 }
    );
  }
}
