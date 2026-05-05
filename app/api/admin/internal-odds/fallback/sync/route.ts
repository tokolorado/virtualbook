import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { supabaseAdmin } from "@/lib/supabaseServer";
import {
  buildInternalFallbackOdds,
  INTERNAL_FALLBACK_MODEL_VERSION,
  INTERNAL_FALLBACK_PRICING_METHOD,
  INTERNAL_FALLBACK_SOURCE,
  type TeamModelSnapshot,
} from "@/lib/odds/internalFallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MatchRow = {
  id: number;
  competition_id: string | null;
  competition_name: string | null;
  utc_date: string;
  home_team: string;
  away_team: string;
  home_team_id: number | null;
  away_team_id: number | null;
  source_event_id: string | null;
  is_neutral_ground: boolean | null;
  is_local_derby: boolean | null;
};

type TeamSnapshotRow = {
  team_id: number | string | null;
  team_name: string | null;
  matches_count: number | string | null;
  goals_for_per_game: number | string | null;
  goals_against_per_game: number | string | null;
  xg_for_per_game: number | string | null;
  xg_against_per_game: number | string | null;
  attack_strength: number | string | null;
  defense_strength: number | string | null;
  rest_days: number | string | null;
};

type OddsAvailabilityRow = {
  match_id: number | string;
};

function isYYYYMMDD(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoStartOfUtcDay(dateYYYYMMDD: string) {
  return new Date(`${dateYYYYMMDD}T00:00:00.000Z`).toISOString();
}

function isoStartOfNextUtcDay(dateYYYYMMDD: string) {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10) + "T00:00:00.000Z";
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
  return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
}

function toTeamModelSnapshot(
  row: TeamSnapshotRow | null,
  fallbackTeamId: number | null,
  fallbackTeamName: string
): TeamModelSnapshot | null {
  if (!row) return null;

  return {
    teamId: toNumber(row.team_id) ?? fallbackTeamId,
    teamName: row.team_name ?? fallbackTeamName,
    matchesCount: Math.trunc(toNumber(row.matches_count) ?? 0),
    goalsForPerGame: toNumber(row.goals_for_per_game),
    goalsAgainstPerGame: toNumber(row.goals_against_per_game),
    xgForPerGame: toNumber(row.xg_for_per_game),
    xgAgainstPerGame: toNumber(row.xg_against_per_game),
    attackStrength: toNumber(row.attack_strength),
    defenseStrength: toNumber(row.defense_strength),
    restDays: toNumber(row.rest_days),
  };
}

async function loadLatestTeamSnapshot(
  supabase: ReturnType<typeof supabaseAdmin>,
  teamId: number | null,
  teamName: string,
  beforeDate: string
) {
  if (teamId === null) return null;

  const { data, error } = await supabase
    .from("team_stat_snapshots")
    .select(
      "team_id, team_name, matches_count, goals_for_per_game, goals_against_per_game, xg_for_per_game, xg_against_per_game, attack_strength, defense_strength, rest_days"
    )
    .eq("team_id", teamId)
    .lte("snapshot_date", beforeDate)
    .order("snapshot_date", { ascending: false })
    .limit(1);

  if (error) throw new Error(`team_stat_snapshots read failed: ${error.message}`);

  return toTeamModelSnapshot(
    Array.isArray(data) ? ((data[0] ?? null) as TeamSnapshotRow | null) : null,
    teamId,
    teamName
  );
}

async function readRealBsdOddsMatchIds(
  supabase: ReturnType<typeof supabaseAdmin>,
  matchIds: number[]
) {
  if (!matchIds.length) return new Set<number>();

  const { data, error } = await supabase
    .from("odds")
    .select("match_id")
    .in("match_id", matchIds)
    .eq("source", "bsd")
    .eq("pricing_method", "bsd_market_normalized");

  if (error) throw new Error(`odds availability read failed: ${error.message}`);

  return new Set(
    ((data ?? []) as OddsAvailabilityRow[])
      .map((row) => Number(row.match_id))
      .filter((id) => Number.isFinite(id))
  );
}

async function readInternalFallbackMatchIds(
  supabase: ReturnType<typeof supabaseAdmin>,
  matchIds: number[]
) {
  if (!matchIds.length) return new Set<number>();

  const { data, error } = await supabase
    .from("odds")
    .select("match_id")
    .in("match_id", matchIds)
    .eq("source", INTERNAL_FALLBACK_SOURCE)
    .eq("pricing_method", INTERNAL_FALLBACK_PRICING_METHOD);

  if (error) throw new Error(`fallback odds read failed: ${error.message}`);

  return new Set(
    ((data ?? []) as OddsAvailabilityRow[])
      .map((row) => Number(row.match_id))
      .filter((id) => Number.isFinite(id))
  );
}

export async function GET(req: Request) {
  const unauthorized = await authorize(req);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const dryRun = searchParams.get("dryRun") === "1";
  const overwrite = searchParams.get("overwrite") === "1";

  if (!isYYYYMMDD(date)) {
    return NextResponse.json(
      { ok: false, error: "Invalid date. Use YYYY-MM-DD" },
      { status: 400 }
    );
  }

  try {
    const supabase = supabaseAdmin();
    const fetchedAt = new Date().toISOString();

    const { data: matchesData, error: matchesError } = await supabase
      .from("matches")
      .select(
        "id, competition_id, competition_name, utc_date, home_team, away_team, home_team_id, away_team_id, source_event_id, is_neutral_ground, is_local_derby"
      )
      .eq("source", "bsd")
      .gte("utc_date", isoStartOfUtcDay(date))
      .lt("utc_date", isoStartOfNextUtcDay(date))
      .order("utc_date", { ascending: true });

    if (matchesError) {
      return NextResponse.json(
        { ok: false, error: `matches read failed: ${matchesError.message}` },
        { status: 500 }
      );
    }

    const matches = (matchesData ?? []) as MatchRow[];
    const matchIds = matches
      .map((match) => Number(match.id))
      .filter((id) => Number.isFinite(id));

    const realBsdOddsMatchIds = await readRealBsdOddsMatchIds(supabase, matchIds);
    const existingFallbackMatchIds = await readInternalFallbackMatchIds(
      supabase,
      matchIds
    );

    const candidates = matches.filter((match) => {
      const id = Number(match.id);
      if (realBsdOddsMatchIds.has(id)) return false;
      if (!overwrite && existingFallbackMatchIds.has(id)) return false;
      return true;
    });

    const oddsRows = [];
    const runs = [];
    const skipped = [];

    for (const match of candidates) {
      const [homeSnapshot, awaySnapshot] = await Promise.all([
        loadLatestTeamSnapshot(
          supabase,
          match.home_team_id,
          match.home_team,
          date
        ),
        loadLatestTeamSnapshot(
          supabase,
          match.away_team_id,
          match.away_team,
          date
        ),
      ]);

      if (!homeSnapshot || !awaySnapshot) {
        skipped.push({
          matchId: match.id,
          reason: "missing_team_stat_snapshot",
          homeTeamId: match.home_team_id,
          awayTeamId: match.away_team_id,
        });
        continue;
      }

      const result = buildInternalFallbackOdds({
        home: homeSnapshot,
        away: awaySnapshot,
        neutralGround: match.is_neutral_ground,
        localDerby: match.is_local_derby,
      });

      if (!result.ok) {
        skipped.push({
          matchId: match.id,
          reason: result.reason,
          diagnostics: result.diagnostics,
        });
        continue;
      }

      runs.push({
        match_id: match.id,
        model_version: result.modelVersion,
        status: "priced",
        confidence: result.confidence,
        lambda_home: result.lambdaHome,
        lambda_away: result.lambdaAway,
        input_snapshot: {
          home: homeSnapshot,
          away: awaySnapshot,
          match: {
            id: match.id,
            competitionId: match.competition_id,
            neutralGround: match.is_neutral_ground,
            localDerby: match.is_local_derby,
          },
        },
        output_snapshot: {
          diagnostics: result.diagnostics,
          rows: result.rows,
        },
        created_at: fetchedAt,
      });

      for (const row of result.rows) {
        oddsRows.push({
          match_id: match.id,
          market_id: row.marketId,
          selection: row.selection,
          fair_prob: row.fairProbability,
          fair_odds: row.fairOdds,
          book_prob: row.bookProbability,
          book_odds: row.bookOdds,
          is_model: true,
          margin: row.margin,
          risk_adjustment: 0,
          implied_probability: 1 / row.bookOdds,
          home_team: match.home_team,
          away_team: match.away_team,
          source: INTERNAL_FALLBACK_SOURCE,
          source_event_id: match.source_event_id,
          pricing_method: INTERNAL_FALLBACK_PRICING_METHOD,
          raw_count: result.rows.length,
          updated_at: fetchedAt,
          provider_fetched_at: fetchedAt,
          raw_source: {
            modelVersion: result.modelVersion,
            confidence: result.confidence,
            lambdaHome: result.lambdaHome,
            lambdaAway: result.lambdaAway,
            diagnostics: result.diagnostics,
          },
        });
      }
    }

    if (!dryRun && oddsRows.length > 0) {
      const { error: oddsError } = await supabase.from("odds").upsert(oddsRows, {
        onConflict: "match_id,market_id,selection",
      });

      if (oddsError) {
        return NextResponse.json(
          { ok: false, error: `fallback odds upsert failed: ${oddsError.message}` },
          { status: 500 }
        );
      }
    }

    if (!dryRun && runs.length > 0) {
      await supabase.from("internal_odds_model_runs").insert(runs);
    }

    return NextResponse.json({
      ok: true,
      source: INTERNAL_FALLBACK_SOURCE,
      pricingMethod: INTERNAL_FALLBACK_PRICING_METHOD,
      modelVersion: INTERNAL_FALLBACK_MODEL_VERSION,
      dryRun,
      overwrite,
      date,
      summary: {
        matchesSeen: matches.length,
        skippedWithRealBsdOdds: realBsdOddsMatchIds.size,
        skippedExistingFallback: overwrite ? 0 : existingFallbackMatchIds.size,
        candidates: candidates.length,
        pricedMatches: runs.length,
        upsertedOddsRows: dryRun ? 0 : oddsRows.length,
        skipped: skipped.length,
      },
      skipped,
      priced: runs.map((run) => ({
        matchId: run.match_id,
        confidence: run.confidence,
        lambdaHome: run.lambda_home,
        lambdaAway: run.lambda_away,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "internal fallback sync failed",
      },
      { status: 500 }
    );
  }
}
