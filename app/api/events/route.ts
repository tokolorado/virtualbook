// app/api/events/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { addDaysLocal, todayLocalYYYYMMDD } from "@/lib/date";
import { scoreMatrix } from "@/lib/odds/poisson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARKET_ID_1X2 = "1x2";
const DISPLAYABLE_BSD_PRICING_METHOD = "bsd_market_normalized";

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
  source: string | null;
  pricing_method: string | null;
  updated_at: string | null;
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

type FeaturesRow = {
  match_id: number;
  home_xg: number | string | null;
  away_xg: number | string | null;
  total_xg: number | string | null;
  home_win_prob: number | string | null;
  draw_prob: number | string | null;
  away_win_prob: number | string | null;
  over25_prob: number | string | null;
  btts_prob: number | string | null;
  model_version: string | null;
  updated_at: string | null;
};

type OddsSet = { "1": number | null; X: number | null; "2": number | null };

function jsonError(
  message: string,
  status = 500,
  extra?: Record<string, unknown>
) {
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

function emptyOdds() {
  return {
    "1": null,
    X: null,
    "2": null,
  } satisfies OddsSet;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const n = safeNum(value);
    if (n !== null) return n;
  }

  return null;
}

function parsePredictedScore(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2})\s*[-:]\s*(\d{1,2})$/);

  if (!match) {
    return {
      predictedScore: raw || null,
      predictedHomeScore: null,
      predictedAwayScore: null,
      scoreSource: raw ? ("bsd_prediction" as const) : null,
      scoreProbability: null,
    };
  }

  return {
    predictedScore: `${Number(match[1])}-${Number(match[2])}`,
    predictedHomeScore: Number(match[1]),
    predictedAwayScore: Number(match[2]),
    scoreSource: "bsd_prediction" as const,
    scoreProbability: null,
  };
}

function modelScoreFromXg(homeXg: number | null, awayXg: number | null) {
  if (
    homeXg === null ||
    awayXg === null ||
    !Number.isFinite(homeXg) ||
    !Number.isFinite(awayXg) ||
    homeXg <= 0 ||
    awayXg <= 0
  ) {
    return {
      predictedScore: null,
      predictedHomeScore: null,
      predictedAwayScore: null,
      scoreSource: null,
      scoreProbability: null,
    };
  }

  const matrix = scoreMatrix(
    Math.min(Math.max(homeXg, 0.05), 5),
    Math.min(Math.max(awayXg, 0.05), 5),
    8
  );

  let bestHome = 0;
  let bestAway = 0;
  let bestProbability = -1;

  for (let home = 0; home < matrix.length; home += 1) {
    for (let away = 0; away < matrix[home].length; away += 1) {
      const probability = matrix[home][away] ?? 0;
      if (probability > bestProbability) {
        bestHome = home;
        bestAway = away;
        bestProbability = probability;
      }
    }
  }

  return {
    predictedScore: `${bestHome}-${bestAway}`,
    predictedHomeScore: bestHome,
    predictedAwayScore: bestAway,
    scoreSource: "model_snapshot" as const,
    scoreProbability: bestProbability,
  };
}

function buildPrediction(row: PredictionRow | null, features: FeaturesRow | null) {
  if (!row && !features) return null;

  const expectedHomeGoals = firstNumber(row?.expected_home_goals, features?.home_xg);
  const expectedAwayGoals = firstNumber(row?.expected_away_goals, features?.away_xg);

  const hasExplicitScore =
    !!row?.predicted_score ||
    (row?.predicted_home_score !== null &&
      row?.predicted_home_score !== undefined &&
      row?.predicted_away_score !== null &&
      row?.predicted_away_score !== undefined);

  const explicitScore = hasExplicitScore
    ? parsePredictedScore(
        row?.predicted_score ??
          `${row?.predicted_home_score}-${row?.predicted_away_score}`
      )
    : null;

  const score =
    explicitScore?.predictedScore
      ? explicitScore
      : modelScoreFromXg(expectedHomeGoals, expectedAwayGoals);

  const probabilities = {
    homeWin: firstNumber(row?.probability_home_win, features?.home_win_prob),
    draw: firstNumber(row?.probability_draw, features?.draw_prob),
    awayWin: firstNumber(row?.probability_away_win, features?.away_win_prob),
    over15: safeNum(row?.probability_over_15),
    over25: firstNumber(row?.probability_over_25, features?.over25_prob),
    over35: safeNum(row?.probability_over_35),
    bttsYes: firstNumber(row?.probability_btts_yes, features?.btts_prob),
  };

  const hasUsefulData =
    score.predictedScore ||
    expectedHomeGoals !== null ||
    expectedAwayGoals !== null ||
    probabilities.homeWin !== null ||
    probabilities.draw !== null ||
    probabilities.awayWin !== null ||
    probabilities.over25 !== null ||
    probabilities.bttsYes !== null;

  if (!hasUsefulData) return null;

  return {
    source: row?.source ?? "bsd",
    market: row?.market ?? "model_snapshot",
    predictedScore: score.predictedScore,
    predictedHomeScore: score.predictedHomeScore,
    predictedAwayScore: score.predictedAwayScore,
    predictedResult: row?.predicted_result ?? null,
    predictedLabel: row?.predicted_label ?? null,
    scoreSource: score.scoreSource,
    scoreProbability: score.scoreProbability,
    expectedHomeGoals,
    expectedAwayGoals,
    probabilities,
    confidence: safeNum(row?.confidence),
    modelVersion: row?.model_version ?? features?.model_version ?? null,
    matchConfidence: row?.match_confidence ?? (features ? "features" : null),
    matchScore: safeNum(row?.match_score),
    sourcePredictionId: row?.source_prediction_id ?? null,
    sourceEventId: row?.source_event_id ?? null,
    updatedAt: row?.updated_at ?? features?.updated_at ?? null,
  };
}

type BuiltPrediction = NonNullable<ReturnType<typeof buildPrediction>>;

function hasRealBsdOdds(odds: OddsSet) {
  return (
    (typeof odds["1"] === "number" && odds["1"] > 1) ||
    (typeof odds.X === "number" && odds.X > 1) ||
    (typeof odds["2"] === "number" && odds["2"] > 1)
  );
}

function probabilityToDecimal(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (value <= 1) return value;
  if (value <= 100) return value / 100;

  return null;
}

function buildValueAlert(
  odds: OddsSet,
  prediction: BuiltPrediction | null,
  homeTeam: string,
  awayTeam: string
) {
  if (!prediction || !hasRealBsdOdds(odds)) return null;

  const candidates = [
    {
      pick: "1" as const,
      label: homeTeam,
      modelProbability: probabilityToDecimal(prediction.probabilities.homeWin),
      odds: odds["1"],
    },
    {
      pick: "X" as const,
      label: "Remis",
      modelProbability: probabilityToDecimal(prediction.probabilities.draw),
      odds: odds.X,
    },
    {
      pick: "2" as const,
      label: awayTeam,
      modelProbability: probabilityToDecimal(prediction.probabilities.awayWin),
      odds: odds["2"],
    },
  ]
    .map((candidate) => {
      if (
        candidate.modelProbability === null ||
        typeof candidate.odds !== "number" ||
        !Number.isFinite(candidate.odds) ||
        candidate.odds <= 1
      ) {
        return null;
      }

      const impliedProbability = 1 / candidate.odds;
      const edgePercentPoints =
        (candidate.modelProbability - impliedProbability) * 100;

      return {
        pick: candidate.pick,
        label: candidate.label,
        modelProbability: candidate.modelProbability,
        impliedProbability,
        edgePercentPoints,
        odds: candidate.odds,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate)
    .sort((a, b) => b.edgePercentPoints - a.edgePercentPoints);

  const best = candidates[0] ?? null;
  if (!best || best.edgePercentPoints < 2.5) return null;

  return best;
}

function buildDataQuality(args: {
  odds: OddsSet;
  predictionRow: PredictionRow | null;
  features: FeaturesRow | null;
  prediction: BuiltPrediction | null;
}) {
  const hasOdds = hasRealBsdOdds(args.odds);
  const hasBsdPrediction = !!args.predictionRow;
  const hasBsdFeatures = !!args.features;
  const hasModelScore = args.prediction?.scoreSource === "model_snapshot";

  let score = 0;
  if (hasOdds) score += 35;
  if (hasBsdPrediction) score += 30;
  if (hasBsdFeatures) score += 25;
  if (hasModelScore) score += 10;

  const sourceBadges: string[] = [];
  if (hasOdds) sourceBadges.push("Kursy BSD");
  if (hasBsdPrediction) sourceBadges.push("Predykcja BSD");
  if (hasBsdFeatures) sourceBadges.push("Features BSD");
  if (hasModelScore) sourceBadges.push("Model xG");

  const missing: string[] = [];
  if (!hasOdds) missing.push("kursy BSD");
  if (!hasBsdPrediction) missing.push("pelna predykcja BSD");
  if (!hasBsdFeatures) missing.push("features BSD");

  const label =
    score >= 85
      ? "Premium"
      : score >= 65
        ? "Solidne"
        : score >= 40
          ? "Czesciowe"
          : "Braki";

  return {
    score,
    label,
    hasRealBsdOdds: hasOdds,
    hasBsdPrediction,
    hasBsdFeatures,
    hasModelScore,
    sourceBadges,
    missing,
    updatedAt:
      args.prediction?.updatedAt ?? args.features?.updated_at ?? null,
  };
}

async function readOddsMap(matchIds: number[]) {
  const oddsMap = new Map<number, OddsSet>();

  if (!matchIds.length) return oddsMap;

  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("odds")
    .select("match_id, selection, book_odds, source, pricing_method, updated_at")
    .in("match_id", matchIds)
    .eq("market_id", MARKET_ID_1X2)
    .eq("source", "bsd")
    .eq("pricing_method", DISPLAYABLE_BSD_PRICING_METHOD)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`DB odds read error: ${error.message}`);
  }

  for (const row of (data ?? []) as OddsRow[]) {
    const matchId = Number(row.match_id);
    const selection = String(row.selection ?? "");
    const odd = safeNum(row.book_odds);

    if (!Number.isFinite(matchId)) continue;
    if (row.source !== "bsd") continue;
    if (row.pricing_method !== DISPLAYABLE_BSD_PRICING_METHOD) continue;
    if (odd === null || odd <= 0) continue;
    if (selection !== "1" && selection !== "X" && selection !== "2") continue;

    const current = oddsMap.get(matchId) ?? emptyOdds();

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

  let oddsMap = new Map<number, OddsSet>();

  let predictionsMap = new Map<number, PredictionRow>();
  let featuresMap = new Map<number, FeaturesRow>();

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

  try {
    featuresMap = await readFeaturesMap(matchIds);
  } catch {
    featuresMap = new Map();
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

            const odds = oddsMap.get(Number(m.id)) ?? emptyOdds();

            const matchId = Number(m.id);
            const predictionRow = predictionsMap.get(matchId) ?? null;
            const featuresRow = featuresMap.get(matchId) ?? null;
            const prediction = buildPrediction(predictionRow, featuresRow);
            const homeTeamName = cleanString(m.home_team, "Home");
            const awayTeamName = cleanString(m.away_team, "Away");
            const dataQuality = buildDataQuality({
              odds,
              predictionRow,
              features: featuresRow,
              prediction,
            });
            const valueAlert = buildValueAlert(
              odds,
              prediction,
              homeTeamName,
              awayTeamName
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
                name: homeTeamName,
              },
              awayTeam: {
                id: safeInt(m.away_team_id),
                name: awayTeamName,
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
              dataQuality,
              valueAlert,
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

async function readFeaturesMap(matchIds: number[]) {
  const featuresMap = new Map<number, FeaturesRow>();
  if (!matchIds.length) return featuresMap;

  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bsd_event_features")
    .select(
      "match_id, home_xg, away_xg, total_xg, home_win_prob, draw_prob, away_win_prob, over25_prob, btts_prob, model_version, updated_at"
    )
    .in("match_id", matchIds);

  if (error) return featuresMap;

  for (const row of (data ?? []) as FeaturesRow[]) {
    const matchId = Number(row.match_id);
    if (!Number.isFinite(matchId)) continue;
    featuresMap.set(matchId, row);
  }

  return featuresMap;
}
