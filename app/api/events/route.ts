// app/api/events/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { addDaysLocal, todayLocalYYYYMMDD } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARKET_ID_1X2 = "1x2";

type DbMatchRow = {
  id: number;
  utc_date: string;
  status: string | null;
  matchday: number | null;
  season: string | null;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
  minute: number | null;
  injury_time: number | null;
  competition_id: string;
  competition_name: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
};

type OddsRow = {
  match_id: number;
  selection: string;
  book_odds: number | string | null;
};

type PredictionRow = {
  match_id: number;
  source: string | null;
  market: string | null;
  predicted_score: string | null;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_result: string | null;
  predicted_label: string | null;
  expected_home_goals: number | null;
  expected_away_goals: number | null;
  probability_home_win: number | null;
  probability_draw: number | null;
  probability_away_win: number | null;
  probability_over_15: number | null;
  probability_over_25: number | null;
  probability_over_35: number | null;
  probability_btts_yes: number | null;
  confidence: number | null;
  model_version: string | null;
  match_confidence: string | null;
  match_score: number | null;
  source_prediction_id: string | null;
  source_event_id: string | null;
  updated_at: string | null;
};

function jsonError(message: string, status = 500, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { ok: false, error: message, ...(extra ?? {}) },
    { status }
  );
}

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

function safeNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeInt(value: unknown): number | null {
  const n = safeNum(value);
  if (n === null) return null;
  return Math.trunc(n);
}

function cleanString(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  const s = value.trim();
  return s.length ? s : fallback;
}

function normalizeStatus(status: string | null | undefined) {
  const s = String(status ?? "").toUpperCase();

  if (s === "LIVE") return "IN_PLAY";
  if (s === "IN_PLAY") return "IN_PLAY";
  if (s === "PAUSED") return "PAUSED";
  if (s === "FINISHED") return "FINISHED";
  if (s === "CANCELED") return "CANCELED";
  if (s === "CANCELLED") return "CANCELLED";
  if (s === "POSTPONED") return "POSTPONED";
  if (s === "SUSPENDED") return "SUSPENDED";
  if (s === "AWARDED") return "AWARDED";
  if (s === "TIMED") return "TIMED";
  if (s === "SCHEDULED") return "SCHEDULED";
  if (s === "PRE_MATCH") return "TIMED";
  if (s === "NOT_STARTED") return "TIMED";

  return s || "SCHEDULED";
}

function isLiveStatus(status: string | null | undefined) {
  const s = normalizeStatus(status);
  return s === "IN_PLAY" || s === "PAUSED" || s === "LIVE";
}

function isFinishedStatus(status: string | null | undefined) {
  return normalizeStatus(status) === "FINISHED";
}

function hasAnyScore(home: number | null, away: number | null) {
  return home !== null || away !== null;
}

function canExposeDisplayScore(status: string | null | undefined) {
  return isLiveStatus(status) || isFinishedStatus(status);
}

function buildPrediction(row: PredictionRow | null) {
  if (!row) return null;

  return {
    source: row.source,
    market: row.market,
    predictedScore: row.predicted_score,
    predictedHomeScore: safeInt(row.predicted_home_score),
    predictedAwayScore: safeInt(row.predicted_away_score),
    predictedResult: row.predicted_result,
    predictedLabel: row.predicted_label,
    expectedHomeGoals: safeNum(row.expected_home_goals),
    expectedAwayGoals: safeNum(row.expected_away_goals),
    probabilities: {
      homeWin: safeNum(row.probability_home_win),
      draw: safeNum(row.probability_draw),
      awayWin: safeNum(row.probability_away_win),
      over15: safeNum(row.probability_over_15),
      over25: safeNum(row.probability_over_25),
      over35: safeNum(row.probability_over_35),
      bttsYes: safeNum(row.probability_btts_yes),
    },
    confidence: safeNum(row.confidence),
    modelVersion: row.model_version,
    matchConfidence: row.match_confidence,
    matchScore: safeNum(row.match_score),
    sourcePredictionId: row.source_prediction_id,
    sourceEventId: row.source_event_id,
    updatedAt: row.updated_at,
  };
}

async function readOddsMap(matchIds: number[]) {
  const oddsMap = new Map<
    number,
    { "1": number | null; X: number | null; "2": number | null }
  >();

  if (!matchIds.length) return oddsMap;

  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("odds")
    .select("match_id, selection, book_odds")
    .in("match_id", matchIds)
    .eq("market_id", MARKET_ID_1X2)
    .eq("source", "bsd");

  if (error) {
    throw new Error(`DB odds read error: ${error.message}`);
  }

  for (const row of (data ?? []) as OddsRow[]) {
    const matchId = Number(row.match_id);
    const selection = String(row.selection ?? "");
    const odd = safeNum(row.book_odds);

    if (!Number.isFinite(matchId)) continue;
    if (odd === null || odd <= 0) continue;

    const current = oddsMap.get(matchId) ?? {
      "1": null,
      X: null,
      "2": null,
    };

    if (selection === "1") current["1"] = odd;
    if (selection === "X") current.X = odd;
    if (selection === "2") current["2"] = odd;

    oddsMap.set(matchId, current);
  }

  return oddsMap;
}

async function readPredictionsMap(matchIds: number[]) {
  const predictionsMap = new Map<number, PredictionRow>();

  if (!matchIds.length) return predictionsMap;

  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("event_predictions")
    .select(
      "match_id, source, market, predicted_score, predicted_home_score, predicted_away_score, predicted_result, predicted_label, expected_home_goals, expected_away_goals, probability_home_win, probability_draw, probability_away_win, probability_over_15, probability_over_25, probability_over_35, probability_btts_yes, confidence, model_version, match_confidence, match_score, source_prediction_id, source_event_id, updated_at"
    )
    .in("match_id", matchIds)
    .eq("source", "bsd")
    .eq("market", "correct_score")
    .order("updated_at", { ascending: false });

  if (error) {
    return predictionsMap;
  }

  for (const row of (data ?? []) as PredictionRow[]) {
    const matchId = Number(row.match_id);
    if (!Number.isFinite(matchId)) continue;
    if (predictionsMap.has(matchId)) continue;

    predictionsMap.set(matchId, row);
  }

  return predictionsMap;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");

  if (!isYYYYMMDD(date)) {
    return jsonError("Invalid date. Use YYYY-MM-DD", 400);
  }

  const HORIZON_DAYS = 14;
  const horizonToYmd = addDaysLocal(todayLocalYYYYMMDD(), HORIZON_DAYS);
  const isBeyondHorizon = date > horizonToYmd;

  if (isBeyondHorizon) {
    return NextResponse.json({
      date,
      dateFrom: null,
      dateTo: null,
      horizonDays: HORIZON_DAYS,
      horizonTo: horizonToYmd,
      isBeyondHorizon: true,
      liveDetailsRefreshed: [],
      results: [],
      errors: [],
    });
  }

  const rangeStart = isoStartOfUtcDay(date);
  const rangeEnd = isoStartOfNextUtcDay(date);

  const sb = supabaseAdmin();

  const { data: matchesData, error: matchesError } = await sb
    .from("matches")
    .select(
      "id, utc_date, status, matchday, season, home_team, away_team, home_score, away_score, minute, injury_time, competition_id, competition_name, home_team_id, away_team_id"
    )
    .eq("source", "bsd")
    .gte("utc_date", rangeStart)
    .lt("utc_date", rangeEnd)
    .order("utc_date", { ascending: true });

  if (matchesError) {
    return jsonError("DB matches read error", 500, {
      detail: matchesError.message,
      date,
      rangeStart,
      rangeEnd,
    });
  }

  const matches = (matchesData ?? []) as DbMatchRow[];
  const matchIds = matches
    .map((m) => Number(m.id))
    .filter((id) => Number.isFinite(id));

  let oddsMap = new Map<
    number,
    { "1": number | null; X: number | null; "2": number | null }
  >();

  let predictionsMap = new Map<number, PredictionRow>();

  try {
    oddsMap = await readOddsMap(matchIds);
  } catch {
    oddsMap = new Map();
  }

  try {
    predictionsMap = await readPredictionsMap(matchIds);
  } catch {
    predictionsMap = new Map();
  }

  const grouped = new Map<
    string,
    {
      league: { code: string; name: string };
      matches: DbMatchRow[];
    }
  >();

  for (const m of matches) {
    const code = cleanString(m.competition_id, "OTHER");
    const name = cleanString(m.competition_name, code);

    const existing = grouped.get(code);
    if (existing) {
      existing.matches.push(m);
    } else {
      grouped.set(code, {
        league: { code, name },
        matches: [m],
      });
    }
  }

  const results = Array.from(grouped.values())
    .sort((a, b) => a.league.name.localeCompare(b.league.name, "pl"))
    .map((group) => {
      return {
        league: group.league,
        fixtures: {
          competition: {
            name: group.league.name,
            code: group.league.code,
          },
          matches: group.matches.map((m) => {
            const status = normalizeStatus(m.status);
            const isLive = isLiveStatus(status);
            const isFinished = isFinishedStatus(status);

            const homeScore = safeNum(m.home_score);
            const awayScore = safeNum(m.away_score);

            const displayScore =
              canExposeDisplayScore(status) && hasAnyScore(homeScore, awayScore)
                ? {
                    home: homeScore,
                    away: awayScore,
                    status,
                    source: "db",
                    updatedAt: new Date().toISOString(),
                  }
                : null;

            const odds = oddsMap.get(Number(m.id)) ?? {
              "1": null,
              X: null,
              "2": null,
            };

            const prediction = buildPrediction(
              predictionsMap.get(Number(m.id)) ?? null
            );

            return {
              id: m.id,
              utcDate: m.utc_date,
              status,
              live: {
                isLive,
                isFinished,
              },
              minute: isLive ? safeInt(m.minute) : null,
              injuryTime: isLive ? safeInt(m.injury_time) : null,
              matchday: m.matchday,
              season: m.season ? { startDate: `${m.season}-01-01` } : null,
              homeTeam: {
                id: safeInt(m.home_team_id),
                name: cleanString(m.home_team, "Home"),
              },
              awayTeam: {
                id: safeInt(m.away_team_id),
                name: cleanString(m.away_team, "Away"),
              },
              score: {
                fullTime: {
                  home: isFinished ? homeScore : null,
                  away: isFinished ? awayScore : null,
                },
              },
              displayScore,
              odds,
              prediction,
            };
          }),
        },
      };
    });

  return NextResponse.json({
    date,
    dateFrom: date,
    dateTo: date,
    horizonDays: HORIZON_DAYS,
    horizonTo: horizonToYmd,
    isBeyondHorizon: false,
    liveDetailsRefreshed: [],
    results,
    errors: [],
  });
}