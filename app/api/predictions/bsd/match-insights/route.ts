// app/api/predictions/bsd/match-insights/route.ts

import { NextResponse } from "next/server";
import { scoreMatrix } from "@/lib/odds/poisson";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

type MatchRow = {
  id: number;
  home_team: string;
  away_team: string;
  competition_id: string | null;
  competition_name: string | null;
  utc_date: string | null;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  source: string | null;
  source_event_id: string | null;
};

type EventPredictionRow = {
  id: number;
  match_id: number;
  source: string;
  market: string;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_score: string | null;
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
  source_prediction_id: string | null;
  source_event_id: string | null;
  source_league_id: string | null;
  source_league_name: string | null;
  source_home_team_id: string | null;
  source_away_team_id: string | null;
  source_home_team_name: string | null;
  source_away_team_name: string | null;
  source_event_date: string | null;
  match_confidence: string;
  match_score: number | null;
  source_payload: UnknownRecord | null;
  fetched_at: string;
  updated_at: string;
};

type BsdEventFeaturesRow = {
  match_id: number;
  home_xg: number | null;
  away_xg: number | null;
  total_xg: number | null;
  home_win_prob: number | null;
  draw_prob: number | null;
  away_win_prob: number | null;
  over25_prob: number | null;
  btts_prob: number | null;
  unavailable_home_count: number;
  unavailable_away_count: number;
  injured_home_count: number;
  injured_away_count: number;
  doubtful_home_count: number;
  doubtful_away_count: number;
  live_home_xg: number | null;
  live_away_xg: number | null;
  live_home_shots: number | null;
  live_away_shots: number | null;
  live_home_shots_on_target: number | null;
  live_away_shots_on_target: number | null;
  live_home_possession: number | null;
  live_away_possession: number | null;
  model_version: string;
  features: UnknownRecord;
  raw_unavailable_players: unknown | null;
  raw_live_stats: unknown | null;
  fetched_at: string;
  updated_at: string;
};

type OddsRow = {
  match_id: number;
  market_id: string;
  selection: string;
  book_odds: number;
  fair_prob: number | null;
  fair_odds: number | null;
  book_prob: number | null;
  margin: number | null;
  pricing_method: string | null;
  is_model: boolean | null;
  source: string | null;
  updated_at: string | null;
};

type OutcomeKey = "home" | "draw" | "away";
type ScoreSource = "bsd_prediction" | "model_snapshot" | null;

type ValuePick = {
  marketId: string;
  selection: string;
  odds: number;
  fairProbability: number | null;
  impliedProbability: number | null;
  fairProbabilityPercent: number | null;
  impliedProbabilityPercent: number | null;
  edge: number | null;
  edgePercentPoints: number | null;
  pricingMethod: string | null;
  isModel: boolean;
};

function jsonError(
  message: string,
  status = 500,
  extra?: Record<string, unknown>
) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

function isValidMatchId(value: string | null): value is string {
  return !!value && /^\d+$/.test(value);
}

function round(value: number | null | undefined, digits = 4): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
}

function normalizeProbabilityDecimal(
  value: number | null | undefined
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  const normalized = value > 1 ? value / 100 : value;

  if (!Number.isFinite(normalized)) return null;

  return Math.min(Math.max(normalized, 0), 1);
}

function probabilityPercent(
  value: number | null | undefined,
  digits = 1
): number | null {
  const decimal = normalizeProbabilityDecimal(value);
  if (decimal === null) return null;

  return round(decimal * 100, digits);
}

function formatPercent(value: number | null | undefined): string {
  const p = probabilityPercent(value, 1);
  return p === null ? "—" : `${p}%`;
}

function firstProbability(
  primary: number | null | undefined,
  fallback: number | null | undefined
): number | null {
  const primaryNormalized = normalizeProbabilityDecimal(primary);
  if (primaryNormalized !== null) return primaryNormalized;

  return normalizeProbabilityDecimal(fallback);
}

function parsePredictedScore(value: string | null): {
  home: number | null;
  away: number | null;
  label: string | null;
  outcome: OutcomeKey | null;
} {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return {
      home: null,
      away: null,
      label: null,
      outcome: null,
    };
  }

  const match = raw.match(/^(\d{1,2})\s*[-:]\s*(\d{1,2})$/);

  if (!match) {
    return {
      home: null,
      away: null,
      label: raw,
      outcome: null,
    };
  }

  const home = Number(match[1]);
  const away = Number(match[2]);

  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return {
      home: null,
      away: null,
      label: raw,
      outcome: null,
    };
  }

  return {
    home,
    away,
    label: `${home}-${away}`,
    outcome: home > away ? "home" : home < away ? "away" : "draw",
  };
}

function emptyScorePrediction() {
  return {
    home: null,
    away: null,
    label: null,
    outcome: null,
    source: null as ScoreSource,
    probability: null,
  };
}

function buildModelScoreFromXg(
  homeXg: number | null | undefined,
  awayXg: number | null | undefined
) {
  const homeLambda = typeof homeXg === "number" ? homeXg : Number(homeXg);
  const awayLambda = typeof awayXg === "number" ? awayXg : Number(awayXg);

  if (
    !Number.isFinite(homeLambda) ||
    !Number.isFinite(awayLambda) ||
    homeLambda <= 0 ||
    awayLambda <= 0
  ) {
    return emptyScorePrediction();
  }

  const matrix = scoreMatrix(
    Math.min(Math.max(homeLambda, 0.05), 5),
    Math.min(Math.max(awayLambda, 0.05), 5),
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
    home: bestHome,
    away: bestAway,
    label: `${bestHome}-${bestAway}`,
    outcome:
      bestHome > bestAway
        ? ("home" as const)
        : bestHome < bestAway
          ? ("away" as const)
          : ("draw" as const),
    source: "model_snapshot" as ScoreSource,
    probability: bestProbability,
  };
}

function normalizeOutcomeKey(value: string | null): OutcomeKey | null {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (["home", "h", "1"].includes(normalized)) return "home";
  if (["away", "a", "2"].includes(normalized)) return "away";
  if (["draw", "d", "x", "remis"].includes(normalized)) return "draw";

  return null;
}

function outcomeLabel(
  outcome: OutcomeKey | null,
  homeTeam: string,
  awayTeam: string
): string | null {
  if (outcome === "home") return homeTeam;
  if (outcome === "away") return awayTeam;
  if (outcome === "draw") return "Remis";

  return null;
}

function strongestOutcomeFromProbabilities(args: {
  homeWin: number | null;
  draw: number | null;
  awayWin: number | null;
}): OutcomeKey | null {
  const candidates = [
    { outcome: "home" as const, value: args.homeWin },
    { outcome: "draw" as const, value: args.draw },
    { outcome: "away" as const, value: args.awayWin },
  ].filter((item): item is { outcome: OutcomeKey; value: number } => {
    return item.value !== null && Number.isFinite(item.value);
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) => b.value - a.value);
  return candidates[0].outcome;
}

function confidenceLabel(value: number | null | undefined): string {
  const decimal = normalizeProbabilityDecimal(value);

  if (decimal === null) {
    return "Brak oceny";
  }

  if (decimal >= 0.65) return "Wysoka";
  if (decimal >= 0.45) return "Średnia";
  return "Niska";
}

function sourceLabel(
  row: EventPredictionRow | null,
  features: BsdEventFeaturesRow | null
): string {
  if (row?.model_version) return row.model_version;
  if (features?.model_version) return features.model_version;
  return "bsd";
}

function withScoreSource(
  score: ReturnType<typeof parsePredictedScore>,
  source: ScoreSource
) {
  return {
    ...score,
    source: score.label ? source : null,
    probability: null,
  };
}

function buildPredictionScoreLabel(
  prediction: EventPredictionRow | null,
  features: BsdEventFeaturesRow | null
) {
  const explicit = parsePredictedScore(prediction?.predicted_score ?? null);

  if (explicit.label) {
    return withScoreSource(explicit, "bsd_prediction");
  }

  if (
    prediction?.predicted_home_score !== null &&
    prediction?.predicted_home_score !== undefined &&
    prediction?.predicted_away_score !== null &&
    prediction?.predicted_away_score !== undefined
  ) {
    return withScoreSource(
      parsePredictedScore(
        `${prediction.predicted_home_score}-${prediction.predicted_away_score}`
      ),
      "bsd_prediction"
    );
  }

  const modelScore = buildModelScoreFromXg(
    prediction?.expected_home_goals ?? features?.home_xg ?? null,
    prediction?.expected_away_goals ?? features?.away_xg ?? null
  );

  if (modelScore.label) return modelScore;

  return withScoreSource(explicit, null);
}

function buildNarrative(args: {
  match: MatchRow;
  prediction: EventPredictionRow | null;
  features: BsdEventFeaturesRow | null;
}) {
  const { match, prediction, features } = args;

  const homeXg = prediction?.expected_home_goals ?? features?.home_xg ?? null;
  const awayXg = prediction?.expected_away_goals ?? features?.away_xg ?? null;

  const homeWin = firstProbability(
    prediction?.probability_home_win,
    features?.home_win_prob
  );

  const draw = firstProbability(
    prediction?.probability_draw,
    features?.draw_prob
  );

  const awayWin = firstProbability(
    prediction?.probability_away_win,
    features?.away_win_prob
  );

  const over25 = firstProbability(
    prediction?.probability_over_25,
    features?.over25_prob
  );

  const btts = firstProbability(
    prediction?.probability_btts_yes,
    features?.btts_prob
  );

  const scorePrediction = buildPredictionScoreLabel(prediction, features);

  const explicitDirection =
    normalizeOutcomeKey(prediction?.predicted_label ?? null) ??
    normalizeOutcomeKey(prediction?.predicted_result ?? null);

  const probabilityDirection = strongestOutcomeFromProbabilities({
    homeWin,
    draw,
    awayWin,
  });

  const direction = explicitDirection ?? probabilityDirection;
  const directionLabel = outcomeLabel(
    direction,
    match.home_team,
    match.away_team
  );

  const scoreDirection = scorePrediction.outcome;
  const scoreDirectionLabel = outcomeLabel(
    scoreDirection,
    match.home_team,
    match.away_team
  );

  const hasScoreDirectionConflict =
    scoreDirection !== null &&
    direction !== null &&
    scoreDirection !== direction;

  const bullets: string[] = [];

  if (scorePrediction.label && directionLabel) {
    if (hasScoreDirectionConflict) {
      bullets.push(
        scorePrediction.source === "model_snapshot"
          ? `Modelowy wynik z xG to ${scorePrediction.label}, ale kierunek 1X2 wskazuje: ${directionLabel}.`
          : `Najbardziej prawdopodobny dokładny wynik to ${scorePrediction.label}, ale kierunek 1X2 modelu wskazuje: ${directionLabel}.`
      );
    } else {
      bullets.push(
        scorePrediction.source === "model_snapshot"
          ? `Modelowy wynik z xG to ${scorePrediction.label}, zgodny z kierunkiem: ${directionLabel}.`
          : `Najbardziej prawdopodobny dokładny wynik to ${scorePrediction.label}, zgodny z kierunkiem: ${directionLabel}.`
      );
    }
  } else if (scorePrediction.label) {
    bullets.push(
      scorePrediction.source === "model_snapshot"
        ? `Modelowy wynik z xG to ${scorePrediction.label}.`
        : `Najbardziej prawdopodobny dokładny wynik modelu to ${scorePrediction.label}.`
    );
  } else if (directionLabel) {
    bullets.push(`Kierunek 1X2 modelu wskazuje: ${directionLabel}.`);
  }

  if (scoreDirectionLabel && !hasScoreDirectionConflict) {
    bullets.push(`Wynik dokładny wspiera scenariusz: ${scoreDirectionLabel}.`);
  }

  if (homeXg !== null && awayXg !== null) {
    const diff = homeXg - awayXg;

    if (Math.abs(diff) < 0.2) {
      bullets.push(
        `Model widzi wyrównany profil xG: ${match.home_team} ${round(homeXg, 2)} vs ${match.away_team} ${round(awayXg, 2)}.`
      );
    } else if (diff > 0) {
      bullets.push(
        `${match.home_team} ma przewagę w oczekiwanych golach: ${round(homeXg, 2)} vs ${round(awayXg, 2)}.`
      );
    } else {
      bullets.push(
        `${match.away_team} ma przewagę w oczekiwanych golach: ${round(awayXg, 2)} vs ${round(homeXg, 2)}.`
      );
    }
  }

  if (homeWin !== null && draw !== null && awayWin !== null) {
    bullets.push(
      `Rozkład 1X2: ${match.home_team} ${formatPercent(homeWin)}, remis ${formatPercent(draw)}, ${match.away_team} ${formatPercent(awayWin)}.`
    );
  }

  if (over25 !== null) {
    bullets.push(
      over25 >= 0.55
        ? `Rynek bramkowy wygląda ofensywnie: Over 2.5 ma około ${formatPercent(over25)}.`
        : `Model nie widzi bardzo wysokiego tempa bramkowego: Over 2.5 ma około ${formatPercent(over25)}.`
    );
  }

  if (btts !== null) {
    bullets.push(
      btts >= 0.55
        ? `BTTS jest wspierany przez model na poziomie około ${formatPercent(btts)}.`
        : `BTTS nie jest mocnym wskazaniem modelu: około ${formatPercent(btts)}.`
    );
  }

  const unavailableHome = features?.unavailable_home_count ?? 0;
  const unavailableAway = features?.unavailable_away_count ?? 0;

  if (unavailableHome > 0 || unavailableAway > 0) {
    bullets.push(
      `Absencje: ${match.home_team} ${unavailableHome}, ${match.away_team} ${unavailableAway}.`
    );
  }

  const title =
    scorePrediction.label && directionLabel && hasScoreDirectionConflict
      ? scorePrediction.source === "model_snapshot"
        ? `Model xG: wynik ${scorePrediction.label}, kierunek ${directionLabel}`
        : `Analiza BSD: wynik ${scorePrediction.label}, kierunek ${directionLabel}`
      : directionLabel
        ? `Model wskazuje: ${directionLabel}`
        : "Analiza modelowa BSD";

  return {
    title,
    direction,
    directionLabel,
    scorePrediction,
    hasScoreDirectionConflict,
    bullets,
  };
}

function isPreferredMarket(row: OddsRow): boolean {
  return (
    row.market_id === "1x2" ||
    row.market_id === "ou_2_5" ||
    row.market_id === "btts" ||
    row.market_id === "dc" ||
    row.market_id === "dnb"
  );
}

function marketSortWeight(marketId: string): number {
  if (marketId === "1x2") return 10;
  if (marketId === "ou_2_5") return 20;
  if (marketId === "btts") return 30;
  if (marketId === "dc") return 40;
  if (marketId === "dnb") return 50;

  return 999;
}

function mapOddToPick(row: OddsRow): ValuePick | null {
  if (row.source !== "bsd") return null;
  if (!Number.isFinite(row.book_odds) || row.book_odds <= 1) return null;

  const fairProb = normalizeProbabilityDecimal(row.fair_prob);
  const bookProb = normalizeProbabilityDecimal(
    row.book_prob ?? 1 / row.book_odds
  );

  const edge =
    fairProb !== null && bookProb !== null ? fairProb - bookProb : null;

  return {
    marketId: row.market_id,
    selection: row.selection,
    odds: row.book_odds,
    fairProbability: round(fairProb),
    impliedProbability: round(bookProb),
    fairProbabilityPercent: probabilityPercent(fairProb),
    impliedProbabilityPercent: probabilityPercent(bookProb),
    edge: round(edge),
    edgePercentPoints: edge === null ? null : round(edge * 100, 2),
    pricingMethod: row.pricing_method,
    isModel: row.is_model === true,
  };
}

function pickTopPicks(odds: OddsRow[]) {
  return odds
    .filter(isPreferredMarket)
    .map(mapOddToPick)
    .filter((pick): pick is ValuePick => {
      return pick !== null && pick.edge !== null && pick.edge > 0;
    })
    .sort((a, b) => {
      const edgeA = a.edge ?? -999;
      const edgeB = b.edge ?? -999;

      if (edgeA !== edgeB) return edgeB - edgeA;
      return a.odds - b.odds;
    })
    .slice(0, 5);
}

function pickMarketSnapshot(odds: OddsRow[]) {
  return odds
    .filter(isPreferredMarket)
    .map(mapOddToPick)
    .filter((pick): pick is ValuePick => pick !== null)
    .sort((a, b) => {
      const marketDiff =
        marketSortWeight(a.marketId) - marketSortWeight(b.marketId);

      if (marketDiff !== 0) return marketDiff;

      const edgeA = a.edge ?? -999;
      const edgeB = b.edge ?? -999;

      if (edgeA !== edgeB) return edgeB - edgeA;
      return a.odds - b.odds;
    })
    .slice(0, 12);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const matchIdRaw = searchParams.get("matchId");

  if (!isValidMatchId(matchIdRaw)) {
    return jsonError("Invalid matchId", 400);
  }

  const matchId = Number(matchIdRaw);
  const supabase = supabaseAdmin();

  const { data: matchData, error: matchError } = await supabase
    .from("matches")
    .select(
      "id,home_team,away_team,competition_id,competition_name,utc_date,status,home_score,away_score,source,source_event_id"
    )
    .eq("source", "bsd")
    .eq("id", matchId)
    .maybeSingle();

  if (matchError) {
    return jsonError("Match read failed", 500, {
      details: matchError.message,
    });
  }

  if (!matchData) {
    return jsonError("Match not found", 404);
  }

  const match = matchData as MatchRow;

  const { data: predictionData, error: predictionError } = await supabase
    .from("event_predictions")
    .select("*")
    .eq("match_id", matchId)
    .eq("source", "bsd")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (predictionError) {
    return jsonError("Prediction read failed", 500, {
      details: predictionError.message,
    });
  }

  const { data: featuresData, error: featuresError } = await supabase
    .from("bsd_event_features")
    .select("*")
    .eq("match_id", matchId)
    .maybeSingle();

  if (featuresError) {
    return jsonError("BSD event features read failed", 500, {
      details: featuresError.message,
    });
  }

    const { data: oddsData, error: oddsError } = await supabase
    .from("odds")
    .select(
        "match_id,market_id,selection,book_odds,fair_prob,fair_odds,book_prob,margin,pricing_method,is_model,source,updated_at"
    )
    .eq("match_id", matchId)
    .eq("source", "bsd")
    .eq("pricing_method", "bsd_market_normalized");

  if (oddsError) {
    return jsonError("Odds read failed", 500, {
      details: oddsError.message,
    });
  }

  const prediction = (predictionData ?? null) as EventPredictionRow | null;
  const features = (featuresData ?? null) as BsdEventFeaturesRow | null;
  const odds = (oddsData ?? []) as OddsRow[];

  const narrative = buildNarrative({
    match,
    prediction,
    features,
  });

  const expectedHomeGoals =
    prediction?.expected_home_goals ?? features?.home_xg ?? null;

  const expectedAwayGoals =
    prediction?.expected_away_goals ?? features?.away_xg ?? null;

  const homeWin = firstProbability(
    prediction?.probability_home_win,
    features?.home_win_prob
  );

  const draw = firstProbability(
    prediction?.probability_draw,
    features?.draw_prob
  );

  const awayWin = firstProbability(
    prediction?.probability_away_win,
    features?.away_win_prob
  );

  const over15 = firstProbability(prediction?.probability_over_15, null);
  const over25 = firstProbability(
    prediction?.probability_over_25,
    features?.over25_prob
  );
  const over35 = firstProbability(prediction?.probability_over_35, null);
  const bttsYes = firstProbability(
    prediction?.probability_btts_yes,
    features?.btts_prob
  );

  const confidenceDecimal = normalizeProbabilityDecimal(
    prediction?.confidence ?? null
  );

  const topPicks = pickTopPicks(odds);
  const marketSnapshot = pickMarketSnapshot(odds);

  const analysisBullets = [...narrative.bullets];

  if (odds.length > 0 && topPicks.length === 0) {
    analysisBullets.push(
      "Na obecnych kursach model nie znajduje dodatniej przewagi value bet w głównych rynkach."
    );
  }

  const response = {
    ok: true,
    source: "bsd",
    matchId,
    fetchedAt: new Date().toISOString(),

    match: {
      id: match.id,
      homeTeam: match.home_team,
      awayTeam: match.away_team,
      competitionId: match.competition_id,
      competitionName: match.competition_name,
      utcDate: match.utc_date,
      status: match.status,
      score: {
        home: match.home_score,
        away: match.away_score,
      },
      source: match.source,
      sourceEventId: match.source_event_id,
    },

    available: prediction !== null || features !== null,

    prediction: {
      predictedScore: narrative.scorePrediction.label,
      predictedHomeScore:
        narrative.scorePrediction.home ?? prediction?.predicted_home_score ?? null,
      predictedAwayScore:
        narrative.scorePrediction.away ?? prediction?.predicted_away_score ?? null,
      predictedResult: prediction?.predicted_result ?? null,
      predictedLabel: prediction?.predicted_label ?? null,
      direction: narrative.direction,
      winnerLabel: narrative.directionLabel,
      scoreDirection: narrative.scorePrediction.outcome,
      scoreSource: narrative.scorePrediction.source,
      scoreProbability:
        narrative.scorePrediction.probability === null
          ? null
          : probabilityPercent(narrative.scorePrediction.probability),
      hasScoreDirectionConflict: narrative.hasScoreDirectionConflict,
      expectedHomeGoals: round(expectedHomeGoals, 3),
      expectedAwayGoals: round(expectedAwayGoals, 3),
      probabilities: {
        homeWin: probabilityPercent(homeWin),
        draw: probabilityPercent(draw),
        awayWin: probabilityPercent(awayWin),
        over15: probabilityPercent(over15),
        over25: probabilityPercent(over25),
        over35: probabilityPercent(over35),
        bttsYes: probabilityPercent(bttsYes),
      },
      probabilitiesDecimal: {
        homeWin: round(homeWin),
        draw: round(draw),
        awayWin: round(awayWin),
        over15: round(over15),
        over25: round(over25),
        over35: round(over35),
        bttsYes: round(bttsYes),
      },
      confidence: probabilityPercent(confidenceDecimal),
      confidenceDecimal: round(confidenceDecimal),
      confidenceLabel: confidenceLabel(confidenceDecimal),
      modelVersion: sourceLabel(prediction, features),
      updatedAt: prediction?.updated_at ?? features?.updated_at ?? null,
    },

    analysis: {
      title: narrative.title,
      bullets: analysisBullets,
    },

    features: features
      ? {
          homeXg: round(features.home_xg, 3),
          awayXg: round(features.away_xg, 3),
          totalXg: round(features.total_xg, 3),
          homeWinProb: probabilityPercent(features.home_win_prob),
          drawProb: probabilityPercent(features.draw_prob),
          awayWinProb: probabilityPercent(features.away_win_prob),
          over25Prob: probabilityPercent(features.over25_prob),
          bttsProb: probabilityPercent(features.btts_prob),
          unavailableHomeCount: features.unavailable_home_count,
          unavailableAwayCount: features.unavailable_away_count,
          injuredHomeCount: features.injured_home_count,
          injuredAwayCount: features.injured_away_count,
          doubtfulHomeCount: features.doubtful_home_count,
          doubtfulAwayCount: features.doubtful_away_count,
          live: {
            homeXg: round(features.live_home_xg, 3),
            awayXg: round(features.live_away_xg, 3),
            homeShots: features.live_home_shots,
            awayShots: features.live_away_shots,
            homeShotsOnTarget: features.live_home_shots_on_target,
            awayShotsOnTarget: features.live_away_shots_on_target,
            homePossession: round(features.live_home_possession, 2),
            awayPossession: round(features.live_away_possession, 2),
          },
          updatedAt: features.updated_at,
        }
      : null,

    topPicks,
    marketSnapshot,

    valueStatus: {
      hasPositiveEdge: topPicks.length > 0,
      message:
        topPicks.length > 0
          ? "Model znalazł dodatnią przewagę w wybranych rynkach."
          : "Brak dodatniej przewagi value bet w głównych rynkach przy obecnych kursach.",
    },

    meta: {
      hasEventPrediction: prediction !== null,
      hasBsdEventFeatures: features !== null,
      oddsCount: odds.length,
      topPicksCount: topPicks.length,
      marketSnapshotCount: marketSnapshot.length,
      note:
        "Endpoint aggregates stored BSD event_predictions, bsd_event_features and odds for one match. It does not fetch BSD upstream and does not mutate data.",
    },
  };

  return NextResponse.json(response);
}
