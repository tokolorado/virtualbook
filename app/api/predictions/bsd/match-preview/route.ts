//app/api/predictions/bsd/match-preview/route.ts
import { NextResponse } from "next/server";
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

function jsonError(message: string, status = 500, extra?: Record<string, unknown>) {
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

function percent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return round(value * 100, 1);
}

function pickWinnerLabel(value: string | null, homeTeam: string, awayTeam: string): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (normalized === "home" || normalized === "h" || normalized === "1") {
    return homeTeam;
  }

  if (normalized === "away" || normalized === "a" || normalized === "2") {
    return awayTeam;
  }

  if (normalized === "draw" || normalized === "d" || normalized === "x") {
    return "Remis";
  }

  return null;
}

function confidenceLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "Brak oceny";
  }

  if (value >= 0.75) return "Wysoka";
  if (value >= 0.55) return "Średnia";
  return "Niska";
}

function sourceLabel(row: EventPredictionRow | null, features: BsdEventFeaturesRow | null): string {
  if (row?.model_version) return row.model_version;
  if (features?.model_version) return features.model_version;
  return "bsd";
}

function buildNarrative(args: {
  match: MatchRow;
  prediction: EventPredictionRow | null;
  features: BsdEventFeaturesRow | null;
}) {
  const { match, prediction, features } = args;

  const homeXg =
    prediction?.expected_home_goals ??
    features?.home_xg ??
    null;

  const awayXg =
    prediction?.expected_away_goals ??
    features?.away_xg ??
    null;

  const homeWin =
    prediction?.probability_home_win ??
    features?.home_win_prob ??
    null;

  const draw =
    prediction?.probability_draw ??
    features?.draw_prob ??
    null;

  const awayWin =
    prediction?.probability_away_win ??
    features?.away_win_prob ??
    null;

  const over25 =
    prediction?.probability_over_25 ??
    features?.over25_prob ??
    null;

  const btts =
    prediction?.probability_btts_yes ??
    features?.btts_prob ??
    null;

  const winner =
    pickWinnerLabel(prediction?.predicted_label ?? prediction?.predicted_result ?? null, match.home_team, match.away_team) ??
    (() => {
      const probs = [
        { label: match.home_team, value: homeWin },
        { label: "Remis", value: draw },
        { label: match.away_team, value: awayWin },
      ].filter((item): item is { label: string; value: number } => item.value !== null);

      if (!probs.length) return null;

      probs.sort((a, b) => b.value - a.value);
      return probs[0].label;
    })();

  const bullets: string[] = [];

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
      `Rozkład 1X2: ${match.home_team} ${percent(homeWin)}%, remis ${percent(draw)}%, ${match.away_team} ${percent(awayWin)}%.`
    );
  }

  if (over25 !== null) {
    bullets.push(
      over25 >= 0.55
        ? `Rynek bramkowy wygląda ofensywnie: Over 2.5 ma około ${percent(over25)}%.`
        : `Model nie widzi bardzo wysokiego tempa bramkowego: Over 2.5 ma około ${percent(over25)}%.`
    );
  }

  if (btts !== null) {
    bullets.push(
      btts >= 0.55
        ? `BTTS jest wspierany przez model na poziomie około ${percent(btts)}%.`
        : `BTTS nie jest mocnym wskazaniem modelu: około ${percent(btts)}%.`
    );
  }

  const unavailableHome = features?.unavailable_home_count ?? 0;
  const unavailableAway = features?.unavailable_away_count ?? 0;

  if (unavailableHome > 0 || unavailableAway > 0) {
    bullets.push(
      `Absencje: ${match.home_team} ${unavailableHome}, ${match.away_team} ${unavailableAway}.`
    );
  }

  return {
    winner,
    bullets,
  };
}

function pickTopPicks(odds: OddsRow[]) {
  const preferred = odds.filter((row) => {
    if (row.source !== "bsd") return false;
    if (!Number.isFinite(row.book_odds) || row.book_odds <= 1) return false;

    return (
      row.market_id === "1x2" ||
      row.market_id === "ou_2_5" ||
      row.market_id === "btts" ||
      row.market_id === "dc" ||
      row.market_id === "dnb"
    );
  });

  return preferred
    .map((row) => {
      const fairProb = row.fair_prob ?? null;
      const bookProb = row.book_prob ?? (Number.isFinite(row.book_odds) ? 1 / row.book_odds : null);
      const edge =
        fairProb !== null && bookProb !== null
          ? fairProb - bookProb
          : null;

      return {
        marketId: row.market_id,
        selection: row.selection,
        odds: row.book_odds,
        fairProbability: round(fairProb),
        impliedProbability: round(bookProb),
        edge: round(edge),
        pricingMethod: row.pricing_method,
        isModel: row.is_model === true,
      };
    })
    .sort((a, b) => {
      const edgeA = a.edge ?? -999;
      const edgeB = b.edge ?? -999;

      if (edgeA !== edgeB) return edgeB - edgeA;
      return a.odds - b.odds;
    })
    .slice(0, 5);
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
    .eq("source", "bsd");

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
    prediction?.expected_home_goals ??
    features?.home_xg ??
    null;

  const expectedAwayGoals =
    prediction?.expected_away_goals ??
    features?.away_xg ??
    null;

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
      predictedScore:
        prediction?.predicted_score ??
        (
          prediction?.predicted_home_score !== null &&
          prediction?.predicted_home_score !== undefined &&
          prediction?.predicted_away_score !== null &&
          prediction?.predicted_away_score !== undefined
            ? `${prediction.predicted_home_score}-${prediction.predicted_away_score}`
            : null
        ),
      predictedHomeScore: prediction?.predicted_home_score ?? null,
      predictedAwayScore: prediction?.predicted_away_score ?? null,
      predictedResult: prediction?.predicted_result ?? null,
      predictedLabel: prediction?.predicted_label ?? null,
      winnerLabel: narrative.winner,
      expectedHomeGoals: round(expectedHomeGoals, 3),
      expectedAwayGoals: round(expectedAwayGoals, 3),
      probabilities: {
        homeWin: round(prediction?.probability_home_win ?? features?.home_win_prob ?? null),
        draw: round(prediction?.probability_draw ?? features?.draw_prob ?? null),
        awayWin: round(prediction?.probability_away_win ?? features?.away_win_prob ?? null),
        over15: round(prediction?.probability_over_15 ?? null),
        over25: round(prediction?.probability_over_25 ?? features?.over25_prob ?? null),
        over35: round(prediction?.probability_over_35 ?? null),
        bttsYes: round(prediction?.probability_btts_yes ?? features?.btts_prob ?? null),
      },
      confidence: round(prediction?.confidence ?? null),
      confidenceLabel: confidenceLabel(prediction?.confidence ?? null),
      modelVersion: sourceLabel(prediction, features),
      updatedAt: prediction?.updated_at ?? features?.updated_at ?? null,
    },

    analysis: {
      title: narrative.winner
        ? `Model wskazuje: ${narrative.winner}`
        : "Analiza modelowa BSD",
      bullets: narrative.bullets,
    },

    features: features
      ? {
          homeXg: round(features.home_xg, 3),
          awayXg: round(features.away_xg, 3),
          totalXg: round(features.total_xg, 3),
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

    topPicks: pickTopPicks(odds),

    meta: {
      hasEventPrediction: prediction !== null,
      hasBsdEventFeatures: features !== null,
      oddsCount: odds.length,
      note:
        "Endpoint aggregates stored BSD event_predictions, bsd_event_features and odds for one match. It does not fetch BSD upstream and does not mutate data.",
    },
  };

  return NextResponse.json(response);
}