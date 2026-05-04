// lib/bsd/pricingModel.ts

type UnknownRecord = Record<string, unknown>;

export const BSD_PRICING_MODEL_VERSION = "bsd_pricing_v2";
const DEFAULT_MODEL_MARGIN = 0.08;

export type OddsInput = {
  marketId: string;
  selection: string;
  field: string;
  bookOdds: number;
  fairProbability?: number;
  pricingMargin?: number;
};

export type PricingFeatureSnapshot = {
  model_version: string;
  home_xg: number;
  away_xg: number;
  generated_odds_count: number;
  raw_features: UnknownRecord;
};

export type BsdEventFeaturesSnapshot = {
  model_version: string;

  home_xg: number;
  away_xg: number;
  total_xg: number;

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

  features: UnknownRecord;
  raw_unavailable_players: unknown | null;
  raw_live_stats: unknown | null;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(obj: UnknownRecord, key: string): UnknownRecord | null {
  const value = obj[key];
  return isRecord(value) ? value : null;
}

function readArray(obj: UnknownRecord, key: string): unknown[] | null {
  const value = obj[key];
  return Array.isArray(value) ? value : null;
}

function readNumber(obj: UnknownRecord, key: string): number | null {
  const value = obj[key];

  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readText(obj: UnknownRecord, key: string): string | null {
  const value = obj[key];

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function readPositiveOdd(obj: UnknownRecord, key: string): number | null {
  const value = readNumber(obj, key);
  if (value === null || value <= 1 || !Number.isFinite(value)) return null;
  return value;
}

function readFirstNumber(obj: UnknownRecord | null, keys: string[]): number | null {
  if (!obj) return null;

  for (const key of keys) {
    const value = readNumber(obj, key);
    if (value !== null) return value;
  }

  return null;
}

function readFirstText(obj: UnknownRecord | null, keys: string[]): string | null {
  if (!obj) return null;

  for (const key of keys) {
    const value = readText(obj, key);
    if (value !== null) return value;
  }

  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundNumber(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function oddFromProbability(
  probability: number,
  margin = DEFAULT_MODEL_MARGIN
): number {
  const minOdd = 1.01;
  const maxOdd = 50;

  const p = clamp(probability, 0.001, 0.999);
  const pricedProbability = clamp(p * (1 + margin), 0.001, 0.99);
  const odd = 1 / pricedProbability;

  return Number(clamp(odd, minOdd, maxOdd).toFixed(3));
}

function normalizeProbabilities(values: number[]): number[] {
  const sum = values.reduce((acc, value) => acc + value, 0);
  if (!Number.isFinite(sum) || sum <= 0) return values;
  return values.map((value) => value / sum);
}

function poisson(lambda: number, goals: number): number {
  let factorial = 1;

  for (let i = 2; i <= goals; i += 1) {
    factorial *= i;
  }

  return (Math.exp(-lambda) * Math.pow(lambda, goals)) / factorial;
}

function readPredictionRecord(event: UnknownRecord): UnknownRecord | null {
  return (
    readRecord(event, "prediction") ??
    readRecord(event, "event_prediction") ??
    readRecord(event, "event_predictions")
  );
}

function readFeatureNumber(event: UnknownRecord, key: string): number | null {
  const direct = readNumber(event, key);
  if (direct !== null) return direct;

  const prediction = readPredictionRecord(event);

  if (prediction) {
    const fromPrediction = readNumber(prediction, key);
    if (fromPrediction !== null) return fromPrediction;
  }

  return null;
}

function estimate1x2Probabilities(event: UnknownRecord): {
  homeWin: number | null;
  draw: number | null;
  awayWin: number | null;
} {
  const probabilityHomeWin = readFeatureNumber(event, "probability_home_win");
  const probabilityDraw = readFeatureNumber(event, "probability_draw");
  const probabilityAwayWin = readFeatureNumber(event, "probability_away_win");

  if (
    probabilityHomeWin !== null &&
    probabilityDraw !== null &&
    probabilityAwayWin !== null
  ) {
    const [homeWin, draw, awayWin] = normalizeProbabilities([
      probabilityHomeWin,
      probabilityDraw,
      probabilityAwayWin,
    ]);

    return {
      homeWin: roundNumber(clamp(homeWin, 0.001, 0.999)),
      draw: roundNumber(clamp(draw, 0.001, 0.999)),
      awayWin: roundNumber(clamp(awayWin, 0.001, 0.999)),
    };
  }

  const homeOdd = readPositiveOdd(event, "odds_home");
  const drawOdd = readPositiveOdd(event, "odds_draw");
  const awayOdd = readPositiveOdd(event, "odds_away");

  if (homeOdd && drawOdd && awayOdd) {
    const [homeWin, draw, awayWin] = normalizeProbabilities([
      1 / homeOdd,
      1 / drawOdd,
      1 / awayOdd,
    ]);

    return {
      homeWin: roundNumber(clamp(homeWin, 0.001, 0.999)),
      draw: roundNumber(clamp(draw, 0.001, 0.999)),
      awayWin: roundNumber(clamp(awayWin, 0.001, 0.999)),
    };
  }

  return {
    homeWin: null,
    draw: null,
    awayWin: null,
  };
}

function estimateOver25Probability(event: UnknownRecord): number | null {
  const probabilityOver25 = readFeatureNumber(event, "probability_over_25");

  if (probabilityOver25 !== null) {
    return roundNumber(clamp(probabilityOver25, 0.001, 0.999));
  }

  const over25Odd = readPositiveOdd(event, "odds_over_25");
  const under25Odd = readPositiveOdd(event, "odds_under_25");

  if (over25Odd && under25Odd) {
    const [over25] = normalizeProbabilities([1 / over25Odd, 1 / under25Odd]);
    return roundNumber(clamp(over25, 0.001, 0.999));
  }

  return null;
}

function estimateBttsProbability(event: UnknownRecord): number | null {
  const probabilityBttsYes = readFeatureNumber(event, "probability_btts_yes");

  if (probabilityBttsYes !== null) {
    return roundNumber(clamp(probabilityBttsYes, 0.001, 0.999));
  }

  const bttsYesOdd = readPositiveOdd(event, "odds_btts_yes");
  const bttsNoOdd = readPositiveOdd(event, "odds_btts_no");

  if (bttsYesOdd && bttsNoOdd) {
    const [bttsYes] = normalizeProbabilities([1 / bttsYesOdd, 1 / bttsNoOdd]);
    return roundNumber(clamp(bttsYes, 0.001, 0.999));
  }

  return null;
}

function estimateExpectedGoals(event: UnknownRecord): {
  homeXg: number;
  awayXg: number;
} {
  const predictionHomeXg = readFeatureNumber(event, "expected_home_goals");
  const predictionAwayXg = readFeatureNumber(event, "expected_away_goals");

  if (predictionHomeXg !== null && predictionAwayXg !== null) {
    return {
      homeXg: clamp(predictionHomeXg, 0.05, 5.5),
      awayXg: clamp(predictionAwayXg, 0.05, 5.5),
    };
  }

  const homeOdd = readPositiveOdd(event, "odds_home");
  const drawOdd = readPositiveOdd(event, "odds_draw");
  const awayOdd = readPositiveOdd(event, "odds_away");
  const over25Odd = readPositiveOdd(event, "odds_over_25");
  const under25Odd = readPositiveOdd(event, "odds_under_25");

  let homeStrength = 0.38;
  let awayStrength = 0.3;

  const probabilities = estimate1x2Probabilities(event);

  if (probabilities.homeWin !== null && probabilities.awayWin !== null) {
    homeStrength = probabilities.homeWin;
    awayStrength = probabilities.awayWin;
  } else if (homeOdd && drawOdd && awayOdd) {
    const [home, , away] = normalizeProbabilities([
      1 / homeOdd,
      1 / drawOdd,
      1 / awayOdd,
    ]);

    homeStrength = home;
    awayStrength = away;
  }

  let totalGoals = 2.65;

  const probabilityOver25 = estimateOver25Probability(event);

  if (probabilityOver25 !== null) {
    totalGoals = clamp(2.05 + probabilityOver25 * 1.45, 1.7, 4.2);
  } else if (over25Odd && under25Odd) {
    const [over25] = normalizeProbabilities([1 / over25Odd, 1 / under25Odd]);
    totalGoals = clamp(2.05 + over25 * 1.45, 1.7, 4.2);
  }

  const probabilityBttsYes = estimateBttsProbability(event);

  if (probabilityBttsYes !== null) {
    totalGoals += (probabilityBttsYes - 0.52) * 0.35;
  }

  const liveStats = readRecord(event, "live_stats");
  const homeStats = liveStats ? readRecord(liveStats, "home") : null;
  const awayStats = liveStats ? readRecord(liveStats, "away") : null;

  const homeLiveXg = homeStats ? readNumber(homeStats, "expected_goals") : null;
  const awayLiveXg = awayStats ? readNumber(awayStats, "expected_goals") : null;

  if (homeLiveXg !== null && awayLiveXg !== null) {
    return {
      homeXg: clamp(homeLiveXg, 0.05, 5.5),
      awayXg: clamp(awayLiveXg, 0.05, 5.5),
    };
  }

  const neutralGround = event.is_neutral_ground === true;
  const localDerby = event.is_local_derby === true;

  let homeShare = clamp(
    0.5 + (homeStrength - awayStrength) * 0.85,
    0.24,
    0.76
  );

  if (neutralGround) {
    homeShare = clamp(homeShare - 0.025, 0.24, 0.76);
  }

  if (localDerby) {
    totalGoals = clamp(totalGoals + 0.08, 1.7, 4.2);
  }

  const temperatureC = readNumber(event, "temperature_c");
  const windSpeed = readNumber(event, "wind_speed");
  const pitchCondition = readText(event, "pitch_condition")?.toLowerCase();

  if (temperatureC !== null && (temperatureC < 0 || temperatureC > 32)) {
    totalGoals = clamp(totalGoals - 0.08, 1.7, 4.2);
  }

  if (windSpeed !== null && windSpeed >= 35) {
    totalGoals = clamp(totalGoals - 0.1, 1.7, 4.2);
  }

  if (
    pitchCondition &&
    ["poor", "bad", "heavy", "wet"].includes(pitchCondition)
  ) {
    totalGoals = clamp(totalGoals - 0.12, 1.7, 4.2);
  }

  return {
    homeXg: clamp(totalGoals * homeShare, 0.15, 4.8),
    awayXg: clamp(totalGoals * (1 - homeShare), 0.15, 4.8),
  };
}

function getLiveStats(event: UnknownRecord): {
  liveStats: UnknownRecord | null;
  homeStats: UnknownRecord | null;
  awayStats: UnknownRecord | null;
} {
  const liveStats = readRecord(event, "live_stats");

  return {
    liveStats,
    homeStats: liveStats ? readRecord(liveStats, "home") : null,
    awayStats: liveStats ? readRecord(liveStats, "away") : null,
  };
}

function normalizeSide(value: unknown): "home" | "away" | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();

  if (["home", "h", "home_team", "team_home"].includes(normalized)) {
    return "home";
  }

  if (["away", "a", "away_team", "team_away"].includes(normalized)) {
    return "away";
  }

  return null;
}

function readUnavailableSide(player: UnknownRecord): "home" | "away" | null {
  return (
    normalizeSide(player.side) ??
    normalizeSide(player.team_side) ??
    normalizeSide(player.teamType) ??
    normalizeSide(player.team_type) ??
    normalizeSide(player.home_away)
  );
}

function isInjuredStatus(player: UnknownRecord): boolean {
  const status = [
    readFirstText(player, ["status", "reason", "type", "category"]),
    readFirstText(player, ["description", "note"]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /injur|kontuz|uraz|out/.test(status);
}

function isDoubtfulStatus(player: UnknownRecord): boolean {
  const status = [
    readFirstText(player, ["status", "reason", "type", "category"]),
    readFirstText(player, ["description", "note"]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /doubt|question|wątpli|uncertain|niepew/.test(status);
}

function countUnavailablePlayers(event: UnknownRecord): {
  rawUnavailablePlayers: unknown | null;
  unavailableHomeCount: number;
  unavailableAwayCount: number;
  injuredHomeCount: number;
  injuredAwayCount: number;
  doubtfulHomeCount: number;
  doubtfulAwayCount: number;
} {
  const rawUnavailablePlayers = event.unavailable_players ?? null;

  let homePlayers: unknown[] = [];
  let awayPlayers: unknown[] = [];

  if (Array.isArray(rawUnavailablePlayers)) {
    for (const item of rawUnavailablePlayers) {
      if (!isRecord(item)) continue;

      const side = readUnavailableSide(item);

      if (side === "home") {
        homePlayers.push(item);
      } else if (side === "away") {
        awayPlayers.push(item);
      }
    }
  } else if (isRecord(rawUnavailablePlayers)) {
    homePlayers =
      readArray(rawUnavailablePlayers, "home") ??
      readArray(rawUnavailablePlayers, "home_team") ??
      readArray(rawUnavailablePlayers, "homeTeam") ??
      [];

    awayPlayers =
      readArray(rawUnavailablePlayers, "away") ??
      readArray(rawUnavailablePlayers, "away_team") ??
      readArray(rawUnavailablePlayers, "awayTeam") ??
      [];
  }

  const injuredHomeCount = homePlayers.filter(
    (player) => isRecord(player) && isInjuredStatus(player)
  ).length;

  const injuredAwayCount = awayPlayers.filter(
    (player) => isRecord(player) && isInjuredStatus(player)
  ).length;

  const doubtfulHomeCount = homePlayers.filter(
    (player) => isRecord(player) && isDoubtfulStatus(player)
  ).length;

  const doubtfulAwayCount = awayPlayers.filter(
    (player) => isRecord(player) && isDoubtfulStatus(player)
  ).length;

  return {
    rawUnavailablePlayers,
    unavailableHomeCount: homePlayers.length,
    unavailableAwayCount: awayPlayers.length,
    injuredHomeCount,
    injuredAwayCount,
    doubtfulHomeCount,
    doubtfulAwayCount,
  };
}

export function buildModelOddsInputs(event: UnknownRecord): OddsInput[] {
  const { homeXg, awayXg } = estimateExpectedGoals(event);

  const maxGoals = 7;
  const matrix: Array<{ h: number; a: number; p: number }> = [];

  for (let h = 0; h <= maxGoals; h += 1) {
    for (let a = 0; a <= maxGoals; a += 1) {
      matrix.push({
        h,
        a,
        p: poisson(homeXg, h) * poisson(awayXg, a),
      });
    }
  }

  const prob = (predicate: (h: number, a: number) => boolean) =>
    clamp(
      matrix
        .filter((row) => predicate(row.h, row.a))
        .reduce((sum, row) => sum + row.p, 0),
      0.01,
      0.97
    );

    const input = (
    marketId: string,
    selection: string,
    probability: number,
    field: string
    ): OddsInput => {
    const fairProbability = clamp(probability, 0.001, 0.999);

    return {
        marketId,
        selection,
        field,
        bookOdds: oddFromProbability(fairProbability),
        fairProbability,
        pricingMargin: DEFAULT_MODEL_MARGIN,
    };
    };

  const rows: OddsInput[] = [];

  const pHome = prob((h, a) => h > a);
  const pDraw = prob((h, a) => h === a);
  const pAway = prob((h, a) => h < a);

  rows.push(input("dc", "1X", pHome + pDraw, "model_dc_1x"));
  rows.push(input("dc", "12", pHome + pAway, "model_dc_12"));
  rows.push(input("dc", "X2", pDraw + pAway, "model_dc_x2"));

  rows.push(
    input("dnb", "1", pHome / Math.max(pHome + pAway, 0.01), "model_dnb_1")
  );
  rows.push(
    input("dnb", "2", pAway / Math.max(pHome + pAway, 0.01), "model_dnb_2")
  );

  for (const line of [0.5, 1.5, 2.5]) {
    const key = String(line).replace(".", "_");

    rows.push(
      input(
        `home_ou_${key}`,
        "over",
        prob((h) => h > line),
        `model_home_ou_${key}_over`
      )
    );

    rows.push(
      input(
        `home_ou_${key}`,
        "under",
        prob((h) => h < line),
        `model_home_ou_${key}_under`
      )
    );

    rows.push(
      input(
        `away_ou_${key}`,
        "over",
        prob((_, a) => a > line),
        `model_away_ou_${key}_over`
      )
    );

    rows.push(
      input(
        `away_ou_${key}`,
        "under",
        prob((_, a) => a < line),
        `model_away_ou_${key}_under`
      )
    );
  }

  rows.push(
    input(
      "odd_even",
      "even",
      prob((h, a) => (h + a) % 2 === 0),
      "model_odd_even_even"
    )
  );

  rows.push(
    input(
      "odd_even",
      "odd",
      prob((h, a) => (h + a) % 2 === 1),
      "model_odd_even_odd"
    )
  );

  rows.push(
    input(
      "clean_sheet_home",
      "yes",
      prob((_, a) => a === 0),
      "model_clean_sheet_home_yes"
    )
  );

  rows.push(
    input(
      "clean_sheet_home",
      "no",
      prob((_, a) => a > 0),
      "model_clean_sheet_home_no"
    )
  );

  rows.push(
    input(
      "clean_sheet_away",
      "yes",
      prob((h) => h === 0),
      "model_clean_sheet_away_yes"
    )
  );

  rows.push(
    input(
      "clean_sheet_away",
      "no",
      prob((h) => h > 0),
      "model_clean_sheet_away_no"
    )
  );

  rows.push(
    input(
      "home_win_to_nil",
      "yes",
      prob((h, a) => h > a && a === 0),
      "model_home_win_to_nil_yes"
    )
  );

  rows.push(
    input(
      "home_win_to_nil",
      "no",
      prob((h, a) => !(h > a && a === 0)),
      "model_home_win_to_nil_no"
    )
  );

  rows.push(
    input(
      "away_win_to_nil",
      "yes",
      prob((h, a) => a > h && h === 0),
      "model_away_win_to_nil_yes"
    )
  );

  rows.push(
    input(
      "away_win_to_nil",
      "no",
      prob((h, a) => !(a > h && h === 0)),
      "model_away_win_to_nil_no"
    )
  );

  const exactScores = [
    "0:0",
    "1:0",
    "2:0",
    "2:1",
    "1:1",
    "0:1",
    "0:2",
    "1:2",
    "3:0",
    "3:1",
    "2:2",
    "1:3",
    "0:3",
    "3:2",
    "2:3",
  ];

  let listedExactScoreProb = 0;

  for (const score of exactScores) {
    const [h, a] = score.split(":").map(Number);
    const p = prob((home, away) => home === h && away === a);

    listedExactScoreProb += p;

    rows.push(input("exact_score", score, p, `model_exact_score_${score}`));
  }

  rows.push(
    input(
      "exact_score",
      "other",
      Math.max(0.01, 1 - listedExactScoreProb),
      "model_exact_score_other"
    )
  );

  const halfMarkets = [
    { prefix: "ht", h: homeXg * 0.45, a: awayXg * 0.45 },
    { prefix: "st", h: homeXg * 0.55, a: awayXg * 0.55 },
  ];

  for (const half of halfMarkets) {
    const halfMatrix: Array<{ h: number; a: number; p: number }> = [];

    for (let h = 0; h <= 5; h += 1) {
      for (let a = 0; a <= 5; a += 1) {
        halfMatrix.push({
          h,
          a,
          p: poisson(half.h, h) * poisson(half.a, a),
        });
      }
    }

    const hp = (predicate: (h: number, a: number) => boolean) =>
      clamp(
        halfMatrix
          .filter((row) => predicate(row.h, row.a))
          .reduce((sum, row) => sum + row.p, 0),
        0.01,
        0.97
      );

    if (half.prefix === "ht") {
      rows.push(input("ht_1x2", "1", hp((h, a) => h > a), "model_ht_1x2_1"));
      rows.push(input("ht_1x2", "X", hp((h, a) => h === a), "model_ht_1x2_x"));
      rows.push(input("ht_1x2", "2", hp((h, a) => h < a), "model_ht_1x2_2"));

      rows.push(input("ht_dc", "1X", hp((h, a) => h >= a), "model_ht_dc_1x"));
      rows.push(input("ht_dc", "12", hp((h, a) => h !== a), "model_ht_dc_12"));
      rows.push(input("ht_dc", "X2", hp((h, a) => h <= a), "model_ht_dc_x2"));

      for (const line of [0.5, 1.5]) {
        const key = String(line).replace(".", "_");

        rows.push(
          input(
            `ht_home_ou_${key}`,
            "over",
            hp((h) => h > line),
            `model_ht_home_ou_${key}_over`
          )
        );

        rows.push(
          input(
            `ht_home_ou_${key}`,
            "under",
            hp((h) => h < line),
            `model_ht_home_ou_${key}_under`
          )
        );

        rows.push(
          input(
            `ht_away_ou_${key}`,
            "over",
            hp((_, a) => a > line),
            `model_ht_away_ou_${key}_over`
          )
        );

        rows.push(
          input(
            `ht_away_ou_${key}`,
            "under",
            hp((_, a) => a < line),
            `model_ht_away_ou_${key}_under`
          )
        );
      }
    }

    if (half.prefix === "st") {
      rows.push(input("st_1x2", "1", hp((h, a) => h > a), "model_st_1x2_1"));
      rows.push(input("st_1x2", "X", hp((h, a) => h === a), "model_st_1x2_x"));
      rows.push(input("st_1x2", "2", hp((h, a) => h < a), "model_st_1x2_2"));
    }

    for (const line of [0.5, 1.5]) {
      const key = String(line).replace(".", "_");

      rows.push(
        input(
          `${half.prefix}_ou_${key}`,
          "over",
          hp((h, a) => h + a > line),
          `model_${half.prefix}_ou_${key}_over`
        )
      );

      rows.push(
        input(
          `${half.prefix}_ou_${key}`,
          "under",
          hp((h, a) => h + a < line),
          `model_${half.prefix}_ou_${key}_under`
        )
      );
    }

    rows.push(
      input(
        `${half.prefix}_btts`,
        "yes",
        hp((h, a) => h > 0 && a > 0),
        `model_${half.prefix}_btts_yes`
      )
    );

    rows.push(
      input(
        `${half.prefix}_btts`,
        "no",
        hp((h, a) => !(h > 0 && a > 0)),
        `model_${half.prefix}_btts_no`
      )
    );
  }

  return rows;
}

export function buildPricingFeatureSnapshot(
  event: UnknownRecord
): PricingFeatureSnapshot {
  const { homeXg, awayXg } = estimateExpectedGoals(event);
  const odds = buildModelOddsInputs(event);
  const probabilities = estimate1x2Probabilities(event);

  return {
    model_version: BSD_PRICING_MODEL_VERSION,
    home_xg: roundNumber(homeXg),
    away_xg: roundNumber(awayXg),
    generated_odds_count: odds.length,
    raw_features: {
      expected_home_goals: homeXg,
      expected_away_goals: awayXg,
      probability_home_win: probabilities.homeWin,
      probability_draw: probabilities.draw,
      probability_away_win: probabilities.awayWin,
      probability_over_15: readFeatureNumber(event, "probability_over_15"),
      probability_over_25: estimateOver25Probability(event),
      probability_over_35: readFeatureNumber(event, "probability_over_35"),
      probability_btts_yes: estimateBttsProbability(event),
      is_neutral_ground: event.is_neutral_ground ?? null,
      is_local_derby: event.is_local_derby ?? null,
      travel_distance_km: readNumber(event, "travel_distance_km"),
      weather_code: readText(event, "weather_code"),
      wind_speed: readNumber(event, "wind_speed"),
      temperature_c: readNumber(event, "temperature_c"),
      pitch_condition: readText(event, "pitch_condition"),
    },
  };
}

export function buildBsdEventFeaturesSnapshot(
  event: UnknownRecord
): BsdEventFeaturesSnapshot {
  const { homeXg, awayXg } = estimateExpectedGoals(event);
  const probabilities = estimate1x2Probabilities(event);
  const { liveStats, homeStats, awayStats } = getLiveStats(event);
  const unavailable = countUnavailablePlayers(event);

  const liveHomeXg = readFirstNumber(homeStats, [
    "expected_goals",
    "xg",
    "expectedGoals",
  ]);

  const liveAwayXg = readFirstNumber(awayStats, [
    "expected_goals",
    "xg",
    "expectedGoals",
  ]);

  const liveHomeShots = readFirstNumber(homeStats, [
    "total_shots",
    "shots",
    "shots_total",
    "totalShots",
  ]);

  const liveAwayShots = readFirstNumber(awayStats, [
    "total_shots",
    "shots",
    "shots_total",
    "totalShots",
  ]);

  const liveHomeShotsOnTarget = readFirstNumber(homeStats, [
    "shots_on_target",
    "shotsOnTarget",
    "on_target",
  ]);

  const liveAwayShotsOnTarget = readFirstNumber(awayStats, [
    "shots_on_target",
    "shotsOnTarget",
    "on_target",
  ]);

  const liveHomePossession = readFirstNumber(homeStats, [
    "ball_possession",
    "possession",
    "ballPossession",
  ]);

  const liveAwayPossession = readFirstNumber(awayStats, [
    "ball_possession",
    "possession",
    "ballPossession",
  ]);

  return {
    model_version: BSD_PRICING_MODEL_VERSION,

    home_xg: roundNumber(homeXg),
    away_xg: roundNumber(awayXg),
    total_xg: roundNumber(homeXg + awayXg),

    home_win_prob: probabilities.homeWin,
    draw_prob: probabilities.draw,
    away_win_prob: probabilities.awayWin,
    over25_prob: estimateOver25Probability(event),
    btts_prob: estimateBttsProbability(event),

    unavailable_home_count: unavailable.unavailableHomeCount,
    unavailable_away_count: unavailable.unavailableAwayCount,
    injured_home_count: unavailable.injuredHomeCount,
    injured_away_count: unavailable.injuredAwayCount,
    doubtful_home_count: unavailable.doubtfulHomeCount,
    doubtful_away_count: unavailable.doubtfulAwayCount,

    live_home_xg: liveHomeXg === null ? null : roundNumber(liveHomeXg),
    live_away_xg: liveAwayXg === null ? null : roundNumber(liveAwayXg),
    live_home_shots: liveHomeShots === null ? null : Math.trunc(liveHomeShots),
    live_away_shots: liveAwayShots === null ? null : Math.trunc(liveAwayShots),
    live_home_shots_on_target:
      liveHomeShotsOnTarget === null ? null : Math.trunc(liveHomeShotsOnTarget),
    live_away_shots_on_target:
      liveAwayShotsOnTarget === null ? null : Math.trunc(liveAwayShotsOnTarget),
    live_home_possession:
      liveHomePossession === null ? null : roundNumber(liveHomePossession),
    live_away_possession:
      liveAwayPossession === null ? null : roundNumber(liveAwayPossession),

    features: {
      expected_home_goals: homeXg,
      expected_away_goals: awayXg,
      total_expected_goals: homeXg + awayXg,
      probability_home_win: probabilities.homeWin,
      probability_draw: probabilities.draw,
      probability_away_win: probabilities.awayWin,
      probability_over_25: estimateOver25Probability(event),
      probability_btts_yes: estimateBttsProbability(event),
      is_neutral_ground: event.is_neutral_ground ?? null,
      is_local_derby: event.is_local_derby ?? null,
      travel_distance_km: readNumber(event, "travel_distance_km"),
      weather_code: readText(event, "weather_code"),
      wind_speed: readNumber(event, "wind_speed"),
      temperature_c: readNumber(event, "temperature_c"),
      pitch_condition: readText(event, "pitch_condition"),
      unavailable_home_count: unavailable.unavailableHomeCount,
      unavailable_away_count: unavailable.unavailableAwayCount,
      injured_home_count: unavailable.injuredHomeCount,
      injured_away_count: unavailable.injuredAwayCount,
      doubtful_home_count: unavailable.doubtfulHomeCount,
      doubtful_away_count: unavailable.doubtfulAwayCount,
      live_home_xg: liveHomeXg,
      live_away_xg: liveAwayXg,
      live_home_shots: liveHomeShots,
      live_away_shots: liveAwayShots,
      live_home_shots_on_target: liveHomeShotsOnTarget,
      live_away_shots_on_target: liveAwayShotsOnTarget,
      live_home_possession: liveHomePossession,
      live_away_possession: liveAwayPossession,
    },

    raw_unavailable_players: unavailable.rawUnavailablePlayers,
    raw_live_stats: liveStats,
  };
}