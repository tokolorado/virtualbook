import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { addDaysLocal, todayLocalYYYYMMDD } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DAYS = 30;
const DEFAULT_DAYS = 14;
const DISPLAYABLE_BSD_PRICING_METHOD = "bsd_market_normalized";
const INTERNAL_FALLBACK_PRICING_METHOD = "internal_model_fallback";

type MatchRow = {
  id: number;
  utc_date: string;
  competition_id: string | null;
  competition_name: string | null;
  home_team: string | null;
  away_team: string | null;
};

type MatchIdRow = {
  match_id: number | string | null;
};

function isYYYYMMDD(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
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

function safePositiveInt(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.trunc(n), MAX_DAYS);
}

function pct(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function sampleMissing(matches: MatchRow[], present: Set<number>) {
  return matches
    .filter((match) => !present.has(Number(match.id)))
    .slice(0, 8)
    .map((match) => ({
      id: Number(match.id),
      utcDate: match.utc_date,
      league: match.competition_name ?? match.competition_id ?? "OTHER",
      homeTeam: match.home_team,
      awayTeam: match.away_team,
    }));
}

async function readOddsIdSet(
  matchIds: number[],
  source: string,
  pricingMethod: string
) {
  const set = new Set<number>();
  if (!matchIds.length) return set;

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("odds")
    .select("match_id")
    .in("match_id", matchIds)
    .eq("market_id", "1x2")
    .eq("source", source)
    .eq("pricing_method", pricingMethod);

  if (error) {
    throw new Error(`odds coverage read failed: ${error.message}`);
  }

  for (const row of (data ?? []) as MatchIdRow[]) {
    const id = Number(row.match_id);
    if (Number.isFinite(id)) set.add(id);
  }

  return set;
}

async function readPredictionIdSet(matchIds: number[]) {
  const set = new Set<number>();
  if (!matchIds.length) return set;

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("event_predictions")
    .select("match_id")
    .in("match_id", matchIds)
    .eq("source", "bsd");

  if (error) {
    throw new Error(`event_predictions coverage read failed: ${error.message}`);
  }

  for (const row of (data ?? []) as MatchIdRow[]) {
    const id = Number(row.match_id);
    if (Number.isFinite(id)) set.add(id);
  }

  return set;
}

async function readFeaturesIdSet(matchIds: number[]) {
  const set = new Set<number>();
  if (!matchIds.length) return set;

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("bsd_event_features")
    .select("match_id")
    .in("match_id", matchIds);

  if (error) {
    throw new Error(`bsd_event_features coverage read failed: ${error.message}`);
  }

  for (const row of (data ?? []) as MatchIdRow[]) {
    const id = Number(row.match_id);
    if (Number.isFinite(id)) set.add(id);
  }

  return set;
}

export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return NextResponse.json(
      { ok: false, error: guard.error },
      { status: guard.status }
    );
  }

  const url = new URL(req.url);
  const rawFrom = url.searchParams.get("from");
  const from = isYYYYMMDD(rawFrom) ? rawFrom : todayLocalYYYYMMDD();
  const days = safePositiveInt(url.searchParams.get("days"), DEFAULT_DAYS);
  const to = addDaysLocal(from, days);
  const rangeStart = isoStartOfUtcDay(from);
  const rangeEnd = isoStartOfNextUtcDay(to);
  const sb = supabaseAdmin();

  try {
    const { data, error } = await sb
      .from("matches")
      .select(
        "id, utc_date, competition_id, competition_name, home_team, away_team"
      )
      .eq("source", "bsd")
      .gte("utc_date", rangeStart)
      .lt("utc_date", rangeEnd)
      .order("utc_date", { ascending: true });

    if (error) {
      throw new Error(`matches coverage read failed: ${error.message}`);
    }

    const matches = (data ?? []) as MatchRow[];
    const matchIds = matches
      .map((match) => Number(match.id))
      .filter((id) => Number.isFinite(id));

    const [realOddsIds, fallbackOddsIds, predictionIds, featureIds] =
      await Promise.all([
        readOddsIdSet(
          matchIds,
          "bsd",
          DISPLAYABLE_BSD_PRICING_METHOD
        ),
        readOddsIdSet(
          matchIds,
          "internal_model",
          INTERNAL_FALLBACK_PRICING_METHOD
        ),
        readPredictionIdSet(matchIds),
        readFeaturesIdSet(matchIds),
      ]);

    const totalMatches = matches.length;

    return NextResponse.json({
      ok: true,
      from,
      to,
      days,
      generatedAt: new Date().toISOString(),
      counts: {
        matches: totalMatches,
        realBsdOdds: realOddsIds.size,
        internalFallbackOdds: fallbackOddsIds.size,
        bsdPredictions: predictionIds.size,
        bsdFeatures: featureIds.size,
        noRealOdds: totalMatches - realOddsIds.size,
      },
      rates: {
        realBsdOdds: pct(realOddsIds.size, totalMatches),
        internalFallbackOdds: pct(fallbackOddsIds.size, totalMatches),
        bsdPredictions: pct(predictionIds.size, totalMatches),
        bsdFeatures: pct(featureIds.size, totalMatches),
      },
      missingSamples: {
        realBsdOdds: sampleMissing(matches, realOddsIds),
        bsdPredictions: sampleMissing(matches, predictionIds),
        bsdFeatures: sampleMissing(matches, featureIds),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Coverage read failed",
      },
      { status: 500 }
    );
  }
}
