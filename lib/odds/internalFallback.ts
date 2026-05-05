import {
  clamp,
  normalize2way,
  oddsFromProb,
  probOverAsian,
  probs1X2FromMatrix,
  round2,
  scoreMatrix,
  totalGoalsDist,
} from "./poisson";

export const INTERNAL_FALLBACK_PRICING_METHOD = "internal_model_fallback";
export const INTERNAL_FALLBACK_SOURCE = "internal_model";
export const INTERNAL_FALLBACK_MODEL_VERSION = "internal-fallback-v1";

export type TeamModelSnapshot = {
  teamId: number | null;
  teamName: string;
  matchesCount: number;
  goalsForPerGame: number | null;
  goalsAgainstPerGame: number | null;
  xgForPerGame?: number | null;
  xgAgainstPerGame?: number | null;
  attackStrength?: number | null;
  defenseStrength?: number | null;
  restDays?: number | null;
};

export type InternalFallbackInput = {
  home: TeamModelSnapshot;
  away: TeamModelSnapshot;
  leagueAverageHomeGoals?: number | null;
  leagueAverageAwayGoals?: number | null;
  homeAdvantageMultiplier?: number | null;
  neutralGround?: boolean | null;
  localDerby?: boolean | null;
};

export type InternalFallbackOddsRow = {
  marketId: string;
  selection: string;
  fairProbability: number;
  fairOdds: number;
  bookProbability: number;
  bookOdds: number;
  margin: number;
};

export type InternalFallbackResult =
  | {
      ok: true;
      modelVersion: string;
      lambdaHome: number;
      lambdaAway: number;
      confidence: number;
      rows: InternalFallbackOddsRow[];
      diagnostics: Record<string, unknown>;
    }
  | {
      ok: false;
      reason: "insufficient_team_stats" | "invalid_lambdas";
      diagnostics: Record<string, unknown>;
    };

const MIN_MATCHES_PER_TEAM = 5;
const DEFAULT_HOME_GOALS = 1.42;
const DEFAULT_AWAY_GOALS = 1.13;
const MARGIN_3WAY = 1.07;
const MARGIN_2WAY = 1.06;

function validRate(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function blendRates(
  primary: number | null | undefined,
  secondary: number | null | undefined,
  fallback: number
) {
  if (validRate(primary) && validRate(secondary)) {
    return primary * 0.6 + secondary * 0.4;
  }

  if (validRate(primary)) return primary;
  if (validRate(secondary)) return secondary;

  return fallback;
}

function strengthRatio(value: number | null | undefined, fallback = 1) {
  if (!validRate(value)) return fallback;
  return clamp(value, 0.55, 1.65);
}

function fatigueMultiplier(restDays: number | null | undefined) {
  if (restDays === null || restDays === undefined || !Number.isFinite(restDays)) {
    return 1;
  }

  if (restDays <= 2) return 0.93;
  if (restDays <= 4) return 0.98;
  if (restDays >= 8) return 1.03;

  return 1;
}

function qualityForTeam(team: TeamModelSnapshot) {
  let quality = 0;
  if (team.matchesCount >= MIN_MATCHES_PER_TEAM) quality += 0.45;
  if (validRate(team.goalsForPerGame) && validRate(team.goalsAgainstPerGame)) {
    quality += 0.25;
  }
  if (validRate(team.xgForPerGame) && validRate(team.xgAgainstPerGame)) {
    quality += 0.2;
  }
  if (validRate(team.attackStrength) || validRate(team.defenseStrength)) {
    quality += 0.1;
  }

  return clamp(quality, 0, 1);
}

function build2WayRows(
  marketId: string,
  overProbability: number,
  underProbability: number,
  margin = MARGIN_2WAY
): InternalFallbackOddsRow[] {
  const normalized = normalize2way(overProbability, underProbability);

  return [
    {
      marketId,
      selection: "over",
      fairProbability: normalized.pA,
      fairOdds: 1 / normalized.pA,
      bookProbability: normalized.pA * margin,
      bookOdds: round2(oddsFromProb(normalized.pA, margin)),
      margin,
    },
    {
      marketId,
      selection: "under",
      fairProbability: normalized.pB,
      fairOdds: 1 / normalized.pB,
      bookProbability: normalized.pB * margin,
      bookOdds: round2(oddsFromProb(normalized.pB, margin)),
      margin,
    },
  ];
}

export function buildInternalFallbackOdds(
  input: InternalFallbackInput
): InternalFallbackResult {
  const homeQuality = qualityForTeam(input.home);
  const awayQuality = qualityForTeam(input.away);
  const confidence = Math.min(homeQuality, awayQuality);

  if (
    input.home.matchesCount < MIN_MATCHES_PER_TEAM ||
    input.away.matchesCount < MIN_MATCHES_PER_TEAM ||
    confidence < 0.55
  ) {
    return {
      ok: false,
      reason: "insufficient_team_stats",
      diagnostics: {
        homeMatchesCount: input.home.matchesCount,
        awayMatchesCount: input.away.matchesCount,
        homeQuality,
        awayQuality,
        minMatchesPerTeam: MIN_MATCHES_PER_TEAM,
      },
    };
  }

  const leagueHomeInput = input.leagueAverageHomeGoals;
  const leagueAwayInput = input.leagueAverageAwayGoals;
  const leagueHome = validRate(leagueHomeInput)
    ? leagueHomeInput
    : DEFAULT_HOME_GOALS;
  const leagueAway = validRate(leagueAwayInput)
    ? leagueAwayInput
    : DEFAULT_AWAY_GOALS;

  const homeAttack = blendRates(
    input.home.xgForPerGame,
    input.home.goalsForPerGame,
    leagueHome
  );
  const awayAttack = blendRates(
    input.away.xgForPerGame,
    input.away.goalsForPerGame,
    leagueAway
  );
  const homeDefenseAllowed = blendRates(
    input.home.xgAgainstPerGame,
    input.home.goalsAgainstPerGame,
    leagueAway
  );
  const awayDefenseAllowed = blendRates(
    input.away.xgAgainstPerGame,
    input.away.goalsAgainstPerGame,
    leagueHome
  );

  const homeAdvantageInput = input.homeAdvantageMultiplier;
  const homeAdvantage = input.neutralGround
    ? 1
    : validRate(homeAdvantageInput)
      ? homeAdvantageInput
      : 1.08;
  const derbyCompression = input.localDerby ? 0.96 : 1;

  const lambdaHome = clamp(
    leagueHome *
      (homeAttack / leagueHome) *
      (awayDefenseAllowed / leagueHome) *
      strengthRatio(input.home.attackStrength) *
      strengthRatio(input.away.defenseStrength) *
      homeAdvantage *
      fatigueMultiplier(input.home.restDays) *
      derbyCompression,
    0.25,
    4.2
  );

  const lambdaAway = clamp(
    leagueAway *
      (awayAttack / leagueAway) *
      (homeDefenseAllowed / leagueAway) *
      strengthRatio(input.away.attackStrength) *
      strengthRatio(input.home.defenseStrength) *
      fatigueMultiplier(input.away.restDays) *
      derbyCompression,
    0.2,
    4
  );

  if (!Number.isFinite(lambdaHome) || !Number.isFinite(lambdaAway)) {
    return {
      ok: false,
      reason: "invalid_lambdas",
      diagnostics: { lambdaHome, lambdaAway },
    };
  }

  const matrix = scoreMatrix(lambdaHome, lambdaAway, 8);
  const oneXTwo = probs1X2FromMatrix(matrix);
  const totalDist = totalGoalsDist(matrix);
  const rows: InternalFallbackOddsRow[] = [];

  rows.push(
    {
      marketId: "1x2",
      selection: "1",
      fairProbability: oneXTwo.p1,
      fairOdds: 1 / oneXTwo.p1,
      bookProbability: oneXTwo.p1 * MARGIN_3WAY,
      bookOdds: round2(oddsFromProb(oneXTwo.p1, MARGIN_3WAY)),
      margin: MARGIN_3WAY,
    },
    {
      marketId: "1x2",
      selection: "X",
      fairProbability: oneXTwo.px,
      fairOdds: 1 / oneXTwo.px,
      bookProbability: oneXTwo.px * MARGIN_3WAY,
      bookOdds: round2(oddsFromProb(oneXTwo.px, MARGIN_3WAY)),
      margin: MARGIN_3WAY,
    },
    {
      marketId: "1x2",
      selection: "2",
      fairProbability: oneXTwo.p2,
      fairOdds: 1 / oneXTwo.p2,
      bookProbability: oneXTwo.p2 * MARGIN_3WAY,
      bookOdds: round2(oddsFromProb(oneXTwo.p2, MARGIN_3WAY)),
      margin: MARGIN_3WAY,
    }
  );

  for (const [marketId, line] of [
    ["ou_1_5", 1.5],
    ["ou_2_5", 2.5],
    ["ou_3_5", 3.5],
  ] as const) {
    const probabilities = probOverAsian(totalDist, line);
    rows.push(
      ...build2WayRows(
        marketId,
        probabilities.pOver,
        probabilities.pUnder,
        MARGIN_2WAY
      )
    );
  }

  const pHomeScores = 1 - Math.exp(-lambdaHome);
  const pAwayScores = 1 - Math.exp(-lambdaAway);
  const pBttsYes = clamp(pHomeScores * pAwayScores, 0.001, 0.999);
  rows.push(...build2WayRows("btts", pBttsYes, 1 - pBttsYes, MARGIN_2WAY));

  return {
    ok: true,
    modelVersion: INTERNAL_FALLBACK_MODEL_VERSION,
    lambdaHome: Number(lambdaHome.toFixed(4)),
    lambdaAway: Number(lambdaAway.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    rows,
    diagnostics: {
      homeQuality,
      awayQuality,
      leagueHome,
      leagueAway,
      homeAttack,
      awayAttack,
      homeDefenseAllowed,
      awayDefenseAllowed,
      neutralGround: input.neutralGround ?? null,
      localDerby: input.localDerby ?? null,
    },
  };
}
