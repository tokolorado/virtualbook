// lib/bsd/pricingModel.ts

type UnknownRecord = Record<string, unknown>;

export type OddsInput = {
  marketId: string;
  selection: string;
  field: string;
  bookOdds: number;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(obj: UnknownRecord, key: string): UnknownRecord | null {
  const value = obj[key];
  return isRecord(value) ? value : null;
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

function readPositiveOdd(obj: UnknownRecord, key: string): number | null {
  const value = readNumber(obj, key);
  if (value === null || value <= 1 || !Number.isFinite(value)) return null;
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function oddFromProbability(probability: number, margin = 0.08): number {
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
  for (let i = 2; i <= goals; i += 1) factorial *= i;
  return Math.exp(-lambda) * Math.pow(lambda, goals) / factorial;
}

function estimateExpectedGoals(event: UnknownRecord): {
  homeXg: number;
  awayXg: number;
} {
  const homeOdd = readPositiveOdd(event, "odds_home");
  const drawOdd = readPositiveOdd(event, "odds_draw");
  const awayOdd = readPositiveOdd(event, "odds_away");
  const over25Odd = readPositiveOdd(event, "odds_over_25");
  const under25Odd = readPositiveOdd(event, "odds_under_25");

  let homeStrength = 0.38;
  let awayStrength = 0.30;

  if (homeOdd && drawOdd && awayOdd) {
    const [home, , away] = normalizeProbabilities([
      1 / homeOdd,
      1 / drawOdd,
      1 / awayOdd,
    ]);

    homeStrength = home;
    awayStrength = away;
  }

  let totalGoals = 2.65;

  if (over25Odd && under25Odd) {
    const [over25] = normalizeProbabilities([1 / over25Odd, 1 / under25Odd]);
    totalGoals = clamp(2.05 + over25 * 1.45, 1.7, 4.2);
  }

  const bttsYesOdd = readPositiveOdd(event, "odds_btts_yes");
  const bttsNoOdd = readPositiveOdd(event, "odds_btts_no");

  if (bttsYesOdd && bttsNoOdd) {
    const [bttsYes] = normalizeProbabilities([1 / bttsYesOdd, 1 / bttsNoOdd]);
    totalGoals += (bttsYes - 0.52) * 0.35;
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

  const homeShare = clamp(
    0.5 + (homeStrength - awayStrength) * 0.85,
    0.24,
    0.76
  );

  return {
    homeXg: clamp(totalGoals * homeShare, 0.15, 4.8),
    awayXg: clamp(totalGoals * (1 - homeShare), 0.15, 4.8),
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
  ): OddsInput => ({
    marketId,
    selection,
    field,
    bookOdds: oddFromProbability(probability),
  });

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
      input(`home_ou_${key}`, "over", prob((h) => h > line), `model_home_ou_${key}_over`)
    );
    rows.push(
      input(`home_ou_${key}`, "under", prob((h) => h < line), `model_home_ou_${key}_under`)
    );
    rows.push(
      input(`away_ou_${key}`, "over", prob((_, a) => a > line), `model_away_ou_${key}_over`)
    );
    rows.push(
      input(`away_ou_${key}`, "under", prob((_, a) => a < line), `model_away_ou_${key}_under`)
    );
  }

  rows.push(input("odd_even", "even", prob((h, a) => (h + a) % 2 === 0), "model_odd_even_even"));
  rows.push(input("odd_even", "odd", prob((h, a) => (h + a) % 2 === 1), "model_odd_even_odd"));

  rows.push(input("clean_sheet_home", "yes", prob((_, a) => a === 0), "model_clean_sheet_home_yes"));
  rows.push(input("clean_sheet_home", "no", prob((_, a) => a > 0), "model_clean_sheet_home_no"));
  rows.push(input("clean_sheet_away", "yes", prob((h) => h === 0), "model_clean_sheet_away_yes"));
  rows.push(input("clean_sheet_away", "no", prob((h) => h > 0), "model_clean_sheet_away_no"));

  rows.push(input("home_win_to_nil", "yes", prob((h, a) => h > a && a === 0), "model_home_win_to_nil_yes"));
  rows.push(input("home_win_to_nil", "no", prob((h, a) => !(h > a && a === 0)), "model_home_win_to_nil_no"));
  rows.push(input("away_win_to_nil", "yes", prob((h, a) => a > h && h === 0), "model_away_win_to_nil_yes"));
  rows.push(input("away_win_to_nil", "no", prob((h, a) => !(a > h && h === 0)), "model_away_win_to_nil_no"));

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

        rows.push(input(`ht_home_ou_${key}`, "over", hp((h) => h > line), `model_ht_home_ou_${key}_over`));
        rows.push(input(`ht_home_ou_${key}`, "under", hp((h) => h < line), `model_ht_home_ou_${key}_under`));
        rows.push(input(`ht_away_ou_${key}`, "over", hp((_, a) => a > line), `model_ht_away_ou_${key}_over`));
        rows.push(input(`ht_away_ou_${key}`, "under", hp((_, a) => a < line), `model_ht_away_ou_${key}_under`));
      }
    }

    if (half.prefix === "st") {
      rows.push(input("st_1x2", "1", hp((h, a) => h > a), "model_st_1x2_1"));
      rows.push(input("st_1x2", "X", hp((h, a) => h === a), "model_st_1x2_x"));
      rows.push(input("st_1x2", "2", hp((h, a) => h < a), "model_st_1x2_2"));
    }

    for (const line of [0.5, 1.5]) {
      const key = String(line).replace(".", "_");

      rows.push(input(`${half.prefix}_ou_${key}`, "over", hp((h, a) => h + a > line), `model_${half.prefix}_ou_${key}_over`));
      rows.push(input(`${half.prefix}_ou_${key}`, "under", hp((h, a) => h + a < line), `model_${half.prefix}_ou_${key}_under`));
    }

    rows.push(input(`${half.prefix}_btts`, "yes", hp((h, a) => h > 0 && a > 0), `model_${half.prefix}_btts_yes`));
    rows.push(input(`${half.prefix}_btts`, "no", hp((h, a) => !(h > 0 && a > 0)), `model_${half.prefix}_btts_no`));
  }

  return rows;
}