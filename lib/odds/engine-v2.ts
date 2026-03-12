// /lib/odds/engine-v2.ts
import type { MatchInput, EngineContext } from "./types";

type AnyObj = Record<string, any>;

const DEFAULT_EXACT_SCORE_SELECTIONS = [
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
] as const;

const DEFAULT_FIRST_HALF_SHARE = 0.45;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function mix(a: number, b: number, weightA: number) {
  return a * weightA + b * (1 - weightA);
}

function safeNum(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function maybeNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeStr(v: unknown, fallback = "") {
  return typeof v === "string" && v.trim() ? v : fallback;
}

function poissonPmf(lambda: number, k: number) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function poissonCdf(lambda: number, k: number) {
  let s = 0;
  for (let i = 0; i <= k; i++) s += poissonPmf(lambda, i);
  return clamp(s, 0, 1);
}

function exactScoreProb(lambdaH: number, lambdaA: number, hg: number, ag: number) {
  return poissonPmf(lambdaH, hg) * poissonPmf(lambdaA, ag);
}

function totalEvenProb(lambdaTotal: number) {
  return clamp((1 + Math.exp(-2 * lambdaTotal)) / 2, 0.0001, 0.9999);
}

function bookify(
  prob: number,
  margin: number,
  minProb = 0.01,
  maxProb = 0.98
) {
  const fairProb = clamp(prob, minProb, maxProb);
  const fairOdds = 1 / fairProb;

  const bookProb = clamp(fairProb * margin, minProb, maxProb);
  const bookOdds = 1 / bookProb;

  return {
    fair_prob: fairProb,
    fair_odds: fairOdds,
    book_prob: bookProb,
    book_odds: bookOdds,
  };
}

function getCompetitionProfile(code: string | null) {
  const c = (code || "").toUpperCase();

  if (c === "CL") {
    return {
      baseTotalGoals: 2.72,
      baseHomeShare: 0.515,
      baseHomeAdv: 1.03,
      standingsWeight: 0.42,
      ratingsWeight: 0.58,
      formWeight: 0.14,
      drawTightnessBoost: 1.10,
      minLambdaH: 0.42,
      maxLambdaH: 2.95,
      minLambdaA: 0.32,
      maxLambdaA: 2.70,
    };
  }

  if (c === "WC") {
    return {
      baseTotalGoals: 2.48,
      baseHomeShare: 0.505,
      baseHomeAdv: 1.01,
      standingsWeight: 0.28,
      ratingsWeight: 0.72,
      formWeight: 0.12,
      drawTightnessBoost: 1.14,
      minLambdaH: 0.35,
      maxLambdaH: 2.65,
      minLambdaA: 0.30,
      maxLambdaA: 2.55,
    };
  }

  return {
    baseTotalGoals: 2.82,
    baseHomeShare: 0.535,
    baseHomeAdv: 1.07,
    standingsWeight: 0.48,
    ratingsWeight: 0.52,
    formWeight: 0.16,
    drawTightnessBoost: 1.08,
    minLambdaH: 0.45,
    maxLambdaH: 3.10,
    minLambdaA: 0.35,
    maxLambdaA: 2.85,
  };
}

function getPath(obj: AnyObj | null | undefined, path: string[]) {
  let cur: any = obj;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

function pickFirst(obj: AnyObj | null | undefined, keys: string[]) {
  if (!obj) return undefined;
  for (const key of keys) {
    if (key in obj && obj[key] != null) return obj[key];
  }
  return undefined;
}

function normalizeInvocation(args: any[]) {
  const first = (args[0] ?? {}) as AnyObj;
  const second = (args[1] ?? {}) as AnyObj;
  const third = (args[2] ?? {}) as AnyObj;

  let match: AnyObj = {};
  let ctx: AnyObj = {};
  let opts: AnyObj = {};

  if (
    first &&
    typeof first === "object" &&
    ("match" in first || "ctx" in first || "context" in first)
  ) {
    match = (first.match ?? {}) as AnyObj;
    ctx = (first.ctx ?? first.context ?? {}) as AnyObj;
    opts = first;
  } else {
    match = first;
    ctx = second;
    opts = third;
  }

  return {
    match,
    ctx,
    nowIso: safeStr(
      pickFirst(opts, ["nowIso", "updatedAt", "ts"]),
      new Date().toISOString()
    ),
    margin: safeNum(pickFirst(opts, ["margin"]), 1.06),
    drawBoost: safeNum(pickFirst(opts, ["drawBoost"]), 1.18),
    maxGoals: Math.max(
      3,
      Math.min(10, Math.floor(safeNum(pickFirst(opts, ["maxGoals"]), 7)))
    ),
    firstHalfShare: clamp(
      safeNum(pickFirst(opts, ["firstHalfShare"]), DEFAULT_FIRST_HALF_SHARE),
      0.38,
      0.50
    ),
    exactScoreSelections:
      (pickFirst(opts, [
        "exactScoreSelections",
      ]) as string[] | readonly string[] | undefined) ??
      DEFAULT_EXACT_SCORE_SELECTIONS,
  };
}

function extractStandingsCtx(ctx: AnyObj) {
  return (
    pickFirst(ctx, ["standingsCtx", "standings", "leagueCtx", "tableCtx"]) ??
    getPath(ctx, ["data", "standingsCtx"]) ??
    null
  ) as AnyObj | null;
}

function extractRatingsMap(ctx: AnyObj) {
  return (
    pickFirst(ctx, ["ratingsByTeam", "teamRatings", "latestRatings", "ratingsMap"]) ??
    getPath(ctx, ["data", "ratingsByTeam"]) ??
    null
  ) as Map<any, any> | Record<string, any> | null;
}

function extractHomeRatingRow(ctx: AnyObj) {
  return (
    pickFirst(ctx, ["homeRatingRow", "homeRating", "homeTeamRating"]) ??
    getPath(ctx, ["ratings", "home"]) ??
    null
  ) as AnyObj | null;
}

function extractAwayRatingRow(ctx: AnyObj) {
  return (
    pickFirst(ctx, ["awayRatingRow", "awayRating", "awayTeamRating"]) ??
    getPath(ctx, ["ratings", "away"]) ??
    null
  ) as AnyObj | null;
}

function getFromMapLike(mapLike: any, key: string | number) {
  if (!mapLike) return null;
  if (typeof mapLike.get === "function") return mapLike.get(key) ?? null;
  return mapLike[key] ?? null;
}

function resolveRatingRow(
  ctx: AnyObj,
  competitionId: string | null,
  teamId: number | null,
  side: "home" | "away"
) {
  const direct = side === "home" ? extractHomeRatingRow(ctx) : extractAwayRatingRow(ctx);
  if (direct) return direct;

  const mapLike = extractRatingsMap(ctx);
  if (!mapLike || teamId == null) return null;

  const key1 = `${competitionId ?? ""}:${teamId}`;
  const key2 = String(teamId);

  return getFromMapLike(mapLike, key1) ?? getFromMapLike(mapLike, key2) ?? null;
}

function resolveStandingRow(standingsCtx: AnyObj | null, teamId: number | null) {
  if (!standingsCtx || teamId == null) return null;

  const byTeamId =
    pickFirst(standingsCtx, ["byTeamId", "teams"]) ??
    getPath(standingsCtx, ["table", "byTeamId"]) ??
    null;

  if (!byTeamId) return null;

  if (typeof byTeamId.get === "function") {
    return byTeamId.get(teamId) ?? null;
  }

  return byTeamId[teamId] ?? byTeamId[String(teamId)] ?? null;
}

function buildLambdasV2(params: {
  competitionId: string | null;
  homeId: number | null;
  awayId: number | null;
  ctx: AnyObj;
}) {
  const { competitionId, homeId, awayId, ctx } = params;
  const profile = getCompetitionProfile(competitionId);

  const standingsCtx = extractStandingsCtx(ctx);
  const homeStanding = resolveStandingRow(standingsCtx, homeId);
  const awayStanding = resolveStandingRow(standingsCtx, awayId);

  const lgGF = clamp(
    safeNum(
      pickFirst(standingsCtx ?? {}, ["leagueAvgGoalsFor", "avgGoalsFor"]),
      profile.baseTotalGoals / 2
    ),
    0.85,
    2.20
  );

  const lgGA = clamp(
    safeNum(
      pickFirst(standingsCtx ?? {}, ["leagueAvgGoalsAgainst", "avgGoalsAgainst"]),
      profile.baseTotalGoals / 2
    ),
    0.85,
    2.20
  );

  const homeRatingRow = resolveRatingRow(ctx, competitionId, homeId, "home");
  const awayRatingRow = resolveRatingRow(ctx, competitionId, awayId, "away");

  const homeOverall = maybeNum(
    pickFirst(homeRatingRow ?? {}, ["overall_rating", "overallRating"])
  );
  const awayOverall = maybeNum(
    pickFirst(awayRatingRow ?? {}, ["overall_rating", "overallRating"])
  );

  const homeAttack = maybeNum(
    pickFirst(homeRatingRow ?? {}, ["attack_rating", "attackRating"])
  );
  const awayAttack = maybeNum(
    pickFirst(awayRatingRow ?? {}, ["attack_rating", "attackRating"])
  );

  const homeDefense = maybeNum(
    pickFirst(homeRatingRow ?? {}, ["defense_rating", "defenseRating"])
  );
  const awayDefense = maybeNum(
    pickFirst(awayRatingRow ?? {}, ["defense_rating", "defenseRating"])
  );

  const homeForm = maybeNum(
    pickFirst(homeRatingRow ?? {}, ["form_rating", "formRating"])
  );
  const awayForm = maybeNum(
    pickFirst(awayRatingRow ?? {}, ["form_rating", "formRating"])
  );

  const hPlayed = Math.max(
    1,
    safeNum(pickFirst(homeStanding ?? {}, ["playedGames", "played_games"]), 0)
  );
  const aPlayed = Math.max(
    1,
    safeNum(pickFirst(awayStanding ?? {}, ["playedGames", "played_games"]), 0)
  );

  const hGFpg = safeNum(pickFirst(homeStanding ?? {}, ["goalsFor", "goals_for"]), lgGF) / hPlayed;
  const hGApg =
    safeNum(pickFirst(homeStanding ?? {}, ["goalsAgainst", "goals_against"]), lgGA) / hPlayed;

  const aGFpg = safeNum(pickFirst(awayStanding ?? {}, ["goalsFor", "goals_for"]), lgGF) / aPlayed;
  const aGApg =
    safeNum(pickFirst(awayStanding ?? {}, ["goalsAgainst", "goals_against"]), lgGA) / aPlayed;

  const hAttackFromTable = clamp(hGFpg / lgGF, 0.72, 1.35);
const hDefenseFromTable = clamp(hGApg / lgGA, 0.72, 1.35);
const aAttackFromTable = clamp(aGFpg / lgGF, 0.72, 1.35);
const aDefenseFromTable = clamp(aGApg / lgGA, 0.72, 1.35);

    const overallGap =
    homeOverall != null && awayOverall != null
        ? clamp((homeOverall - awayOverall) / 100, -0.22, 0.22)
        : 0;

    const attackGap =
    homeAttack != null && awayAttack != null
        ? clamp((homeAttack - awayAttack) / 100, -0.18, 0.18)
        : 0;

    const defenseGap =
    homeDefense != null && awayDefense != null
        ? clamp((homeDefense - awayDefense) / 100, -0.18, 0.18)
        : 0;

    const formGap =
    homeForm != null && awayForm != null
        ? clamp((homeForm - awayForm) / 100, -0.15, 0.15)
        : 0;

  const ratingAttackHome =
  homeAttack != null ? clamp(1 + ((homeAttack - 50) / 100) * 0.32, 0.80, 1.22) : 1;

const ratingAttackAway =
  awayAttack != null ? clamp(1 + ((awayAttack - 50) / 100) * 0.32, 0.80, 1.22) : 1;

const ratingDefenseHome =
  homeDefense != null ? clamp(1 - ((homeDefense - 50) / 100) * 0.24, 0.80, 1.20) : 1;

const ratingDefenseAway =
  awayDefense != null ? clamp(1 - ((awayDefense - 50) / 100) * 0.24, 0.80, 1.20) : 1;

  const standingsHomeAttack = mix(hAttackFromTable, 1, profile.standingsWeight);
  const standingsAwayAttack = mix(aAttackFromTable, 1, profile.standingsWeight);
  const standingsHomeDefense = mix(hDefenseFromTable, 1, profile.standingsWeight);
  const standingsAwayDefense = mix(aDefenseFromTable, 1, profile.standingsWeight);

    let expectedTotal =
    (profile.baseTotalGoals - 0.12) *
    (1 + attackGap * 0.04) *
    (1 - defenseGap * 0.025) *
    (1 + Math.abs(formGap) * 0.01);

    expectedTotal = clamp(expectedTotal, 2.00, 3.20);


    let homeShare =
    profile.baseHomeShare +
    overallGap * 0.09 +
    attackGap * 0.05 -
    defenseGap * 0.03 +
    formGap * 0.06;

    homeShare = clamp(homeShare, 0.42, 0.62);

  let lambdaH =
    expectedTotal *
    homeShare *
    profile.baseHomeAdv *
    standingsHomeAttack *
    standingsAwayDefense *
    ratingAttackHome *
    ratingDefenseAway;

  let lambdaA =
    expectedTotal *
    (1 - homeShare) *
    standingsAwayAttack *
    standingsHomeDefense *
    ratingAttackAway *
    ratingDefenseHome;

    lambdaH *= 1 + overallGap * 0.10 + formGap * 0.04;
    lambdaA *= 1 - overallGap * 0.10 - formGap * 0.04;

  lambdaH = clamp(lambdaH, profile.minLambdaH, profile.maxLambdaH);
  lambdaA = clamp(lambdaA, profile.minLambdaA, profile.maxLambdaA);

  const closeness = 1 - clamp(Math.abs(lambdaH - lambdaA) / 1.8, 0, 1);
  const lowTotalBonus = clamp((3.0 - (lambdaH + lambdaA)) / 1.4, 0, 0.22);

  const effectiveDrawBoostFactor =
    profile.drawTightnessBoost + closeness * 0.08 + lowTotalBonus;

  return {
    lambdaH,
    lambdaA,
    effectiveDrawBoostFactor,
    debug: {
      profile: { ...profile },
      leagueAverages: {
        leagueAvgGoalsFor: lgGF,
        leagueAvgGoalsAgainst: lgGA,
      },
      standings: {
        available: !!standingsCtx,
        home: homeStanding
          ? {
              teamId: safeNum(pickFirst(homeStanding, ["teamId", "team_id"]), homeId ?? 0),
              playedGames: hPlayed,
              goalsFor: safeNum(pickFirst(homeStanding, ["goalsFor", "goals_for"]), 0),
              goalsAgainst: safeNum(pickFirst(homeStanding, ["goalsAgainst", "goals_against"]), 0),
              gfPerGame: hGFpg,
              gaPerGame: hGApg,
              attackFromTable: hAttackFromTable,
              defenseFromTable: hDefenseFromTable,
            }
          : null,
        away: awayStanding
          ? {
              teamId: safeNum(pickFirst(awayStanding, ["teamId", "team_id"]), awayId ?? 0),
              playedGames: aPlayed,
              goalsFor: safeNum(pickFirst(awayStanding, ["goalsFor", "goals_for"]), 0),
              goalsAgainst: safeNum(pickFirst(awayStanding, ["goalsAgainst", "goals_against"]), 0),
              gfPerGame: aGFpg,
              gaPerGame: aGApg,
              attackFromTable: aAttackFromTable,
              defenseFromTable: aDefenseFromTable,
            }
          : null,
      },
      ratings: {
        home: homeRatingRow
          ? {
              overall: homeOverall,
              attack: homeAttack,
              defense: homeDefense,
              form: homeForm,
              matchesCount: maybeNum(
                pickFirst(homeRatingRow, ["matches_count", "matchesCount"])
              ),
              ratingDate: pickFirst(homeRatingRow, ["rating_date", "ratingDate"]) ?? null,
            }
          : null,
        away: awayRatingRow
          ? {
              overall: awayOverall,
              attack: awayAttack,
              defense: awayDefense,
              form: awayForm,
              matchesCount: maybeNum(
                pickFirst(awayRatingRow, ["matches_count", "matchesCount"])
              ),
              ratingDate: pickFirst(awayRatingRow, ["rating_date", "ratingDate"]) ?? null,
            }
          : null,
      },
      factors: {
        overallGap,
        attackGap,
        defenseGap,
        formGap,
        ratingAttackHome,
        ratingAttackAway,
        ratingDefenseHome,
        ratingDefenseAway,
        standingsHomeAttack,
        standingsAwayAttack,
        standingsHomeDefense,
        standingsAwayDefense,
        expectedTotal,
        homeShare,
        closeness,
        lowTotalBonus,
      },
      lambdas: {
        lambdaH,
        lambdaA,
        lambdaT: lambdaH + lambdaA,
        effectiveDrawBoostFactor,
      },
    },
  };
}

function compute1X2FromLambdas(args: {
  lambdaH: number;
  lambdaA: number;
  drawBoost: number;
  maxGoals: number;
}) {
  const maxGoals = Math.max(3, Math.min(10, Math.floor(args.maxGoals)));

  const ph: number[] = [];
  const pa: number[] = [];
  let sumH = 0;
  let sumA = 0;

  for (let k = 0; k <= maxGoals; k++) {
    const pH = poissonPmf(args.lambdaH, k);
    const pA = poissonPmf(args.lambdaA, k);
    ph.push(pH);
    pa.push(pA);
    sumH += pH;
    sumA += pA;
  }

  if (sumH > 0) for (let i = 0; i < ph.length; i++) ph[i] /= sumH;
  if (sumA > 0) for (let i = 0; i < pa.length; i++) pa[i] /= sumA;

  let p1 = 0;
  let pX = 0;
  let p2 = 0;

  for (let i = 0; i < ph.length; i++) {
    for (let j = 0; j < pa.length; j++) {
      const p = ph[i] * pa[j];
      if (i > j) p1 += p;
      else if (i === j) pX += p;
      else p2 += p;
    }
  }

  pX *= args.drawBoost;

  const s = p1 + pX + p2;
  if (s > 0) {
    p1 /= s;
    pX /= s;
    p2 /= s;
  }

  p1 = clamp(p1, 0.02, 0.92);
  pX = clamp(pX, 0.05, 0.42);
  p2 = clamp(p2, 0.02, 0.92);

  const s2 = p1 + pX + p2;
  return { p1: p1 / s2, pX: pX / s2, p2: p2 / s2 };
}

function pushMarketRow(
  rows: any[],
  baseMeta: AnyObj,
  params: {
    marketId: string;
    selection: string;
    prob: number;
    margin: number;
    minProb?: number;
    maxProb?: number;
  }
) {
  rows.push({
    match_id: baseMeta.match_id,
    market_id: params.marketId,
    selection: params.selection,
    margin: params.margin,
    risk_adjustment: 0,
    updated_at: baseMeta.updated_at,
    engine_version: "v2",
    home_team: baseMeta.home_team,
    away_team: baseMeta.away_team,
    ...bookify(
      params.prob,
      params.margin,
      params.minProb ?? 0.01,
      params.maxProb ?? 0.98
    ),
  });
}

export function generateOddsV2(...rawArgs: any[]) {
  const {
    match,
    ctx,
    nowIso,
    margin,
    drawBoost,
    maxGoals,
    firstHalfShare,
    exactScoreSelections,
  } = normalizeInvocation(rawArgs);

  const m = (match ?? {}) as MatchInput & AnyObj;
  const context = (ctx ?? {}) as EngineContext & AnyObj;

  const matchId = safeNum(pickFirst(m, ["matchId", "match_id", "id"]), NaN);

  const competitionId =
    safeStr(
      pickFirst(m, ["competitionId", "competition_id", "competitionCode"]),
      null as any
    ) || null;

  const homeId = maybeNum(
    pickFirst(m, ["homeId", "home_id", "homeTeamId", "home_team_id"])
  );

  const awayId = maybeNum(
    pickFirst(m, ["awayId", "away_id", "awayTeamId", "away_team_id"])
  );

  const homeTeam =
    safeStr(
      pickFirst(m, ["homeTeamName", "home_team", "homeTeam", "home"]),
      "Home"
    ) || "Home";

  const awayTeam =
    safeStr(
      pickFirst(m, ["awayTeamName", "away_team", "awayTeam", "away"]),
      "Away"
    ) || "Away";

  const lambdaPack = buildLambdasV2({
    competitionId,
    homeId,
    awayId,
    ctx: context,
  });

  const { lambdaH, lambdaA, effectiveDrawBoostFactor } = lambdaPack;

  const appliedDrawBoost = drawBoost * effectiveDrawBoostFactor;

  const { p1, pX, p2 } = compute1X2FromLambdas({
    lambdaH,
    lambdaA,
    drawBoost: appliedDrawBoost,
    maxGoals,
  });

  const lambdaT = clamp(lambdaH + lambdaA, 0.2, 8.0);

  const pUnder15 = poissonCdf(lambdaT, 1);
  const pOver15 = 1 - pUnder15;

  const pUnder25 = poissonCdf(lambdaT, 2);
  const pOver25 = 1 - pUnder25;

  const pUnder35 = poissonCdf(lambdaT, 3);
  const pOver35 = 1 - pUnder35;

  const pH0 = Math.exp(-lambdaH);
  const pA0 = Math.exp(-lambdaA);
  const p00 = Math.exp(-lambdaT);

    const rawBttsYes = 1 - pH0 - pA0 + p00;
    const pBttsYes = clamp(rawBttsYes * 0.97, 0.01, 0.98);
    const pBttsNo = 1 - pBttsYes;

  const pHomeUnder05 = poissonCdf(lambdaH, 0);
  const pHomeOver05 = 1 - pHomeUnder05;
  const pHomeUnder15 = poissonCdf(lambdaH, 1);
  const pHomeOver15 = 1 - pHomeUnder15;
  const pHomeUnder25 = poissonCdf(lambdaH, 2);
  const pHomeOver25 = 1 - pHomeUnder25;

  const pAwayUnder05 = poissonCdf(lambdaA, 0);
  const pAwayOver05 = 1 - pAwayUnder05;
  const pAwayUnder15 = poissonCdf(lambdaA, 1);
  const pAwayOver15 = 1 - pAwayUnder15;
  const pAwayUnder25 = poissonCdf(lambdaA, 2);
  const pAwayOver25 = 1 - pAwayUnder25;

  const p1X = clamp(p1 + pX, 0.01, 0.99);
  const p12 = clamp(p1 + p2, 0.01, 0.99);
  const pX2 = clamp(pX + p2, 0.01, 0.99);

  const dnbDenom = Math.max(p1 + p2, 0.0001);
  const pHomeDnb = clamp(p1 / dnbDenom, 0.01, 0.99);
  const pAwayDnb = clamp(p2 / dnbDenom, 0.01, 0.99);

  const lambdaHHT = clamp(lambdaH * firstHalfShare, 0.05, 4.5);
  const lambdaAHT = clamp(lambdaA * firstHalfShare, 0.05, 4.5);
  const lambdaTHT = clamp(lambdaHHT + lambdaAHT, 0.1, 6.0);

  const appliedDrawBoostHT = drawBoost * (effectiveDrawBoostFactor + 0.03);

  const { p1: p1HT, pX: pXHT, p2: p2HT } = compute1X2FromLambdas({
    lambdaH: lambdaHHT,
    lambdaA: lambdaAHT,
    drawBoost: appliedDrawBoostHT,
    maxGoals: Math.max(4, maxGoals - 1),
  });

  const p1XHT = clamp(p1HT + pXHT, 0.01, 0.99);
  const p12HT = clamp(p1HT + p2HT, 0.01, 0.99);
  const pX2HT = clamp(pXHT + p2HT, 0.01, 0.99);

  const pHTUnder05 = poissonCdf(lambdaTHT, 0);
  const pHTOver05 = 1 - pHTUnder05;
  const pHTUnder15 = poissonCdf(lambdaTHT, 1);
  const pHTOver15 = 1 - pHTUnder15;

  const pH0HT = Math.exp(-lambdaHHT);
  const pA0HT = Math.exp(-lambdaAHT);
  const p00HT = Math.exp(-lambdaTHT);

  const pHTBttsYes = clamp(1 - pH0HT - pA0HT + p00HT, 0.01, 0.98);
  const pHTBttsNo = 1 - pHTBttsYes;

  const pHTHomeUnder05 = poissonCdf(lambdaHHT, 0);
  const pHTHomeOver05 = 1 - pHTHomeUnder05;
  const pHTHomeUnder15 = poissonCdf(lambdaHHT, 1);
  const pHTHomeOver15 = 1 - pHTHomeUnder15;

  const pHTAwayUnder05 = poissonCdf(lambdaAHT, 0);
  const pHTAwayOver05 = 1 - pHTAwayUnder05;
  const pHTAwayUnder15 = poissonCdf(lambdaAHT, 1);
  const pHTAwayOver15 = 1 - pHTAwayUnder15;

  const lambdaHST = clamp(lambdaH - lambdaHHT, 0.05, 4.5);
  const lambdaAST = clamp(lambdaA - lambdaAHT, 0.05, 4.5);
  const lambdaTST = clamp(lambdaHST + lambdaAST, 0.1, 6.0);

  const appliedDrawBoostST = drawBoost * (effectiveDrawBoostFactor + 0.01);

  const { p1: p1ST, pX: pXST, p2: p2ST } = compute1X2FromLambdas({
    lambdaH: lambdaHST,
    lambdaA: lambdaAST,
    drawBoost: appliedDrawBoostST,
    maxGoals: Math.max(4, maxGoals - 1),
  });

  const pSTUnder05 = poissonCdf(lambdaTST, 0);
  const pSTOver05 = 1 - pSTUnder05;
  const pSTUnder15 = poissonCdf(lambdaTST, 1);
  const pSTOver15 = 1 - pSTUnder15;

  const pH0ST = Math.exp(-lambdaHST);
  const pA0ST = Math.exp(-lambdaAST);
  const p00ST = Math.exp(-lambdaTST);

  const pSTBttsYes = clamp(1 - pH0ST - pA0ST + p00ST, 0.01, 0.98);
  const pSTBttsNo = 1 - pSTBttsYes;

  const pEven = totalEvenProb(lambdaT);
  const pOdd = 1 - pEven;

  const pHomeWinToNilYes = clamp((1 - pH0) * pA0, 0.0005, 0.999);
  const pHomeWinToNilNo = 1 - pHomeWinToNilYes;

  const pAwayWinToNilYes = clamp((1 - pA0) * pH0, 0.0005, 0.999);
  const pAwayWinToNilNo = 1 - pAwayWinToNilYes;

  const pCleanSheetHomeYes = clamp(pA0, 0.0005, 0.999);
  const pCleanSheetHomeNo = 1 - pCleanSheetHomeYes;

  const pCleanSheetAwayYes = clamp(pH0, 0.0005, 0.999);
  const pCleanSheetAwayNo = 1 - pCleanSheetAwayYes;

  const exactScoreProbMap = new Map<string, number>();
  let knownExactScoreSum = 0;

  for (const key of exactScoreSelections) {
    const [hgRaw, agRaw] = String(key).split(":");
    const hg = Number(hgRaw);
    const ag = Number(agRaw);
    if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;

    const p = exactScoreProb(lambdaH, lambdaA, hg, ag);
    exactScoreProbMap.set(String(key), p);
    knownExactScoreSum += p;
  }

  const pExactOther = clamp(1 - knownExactScoreSum, 0.0005, 0.999);

  const rows: any[] = [];

  const baseMeta = {
    match_id: matchId,
    updated_at: nowIso,
    home_team: homeTeam,
    away_team: awayTeam,
  };

  // 1x2
  pushMarketRow(rows, baseMeta, { marketId: "1x2", selection: "1", prob: p1, margin });
  pushMarketRow(rows, baseMeta, { marketId: "1x2", selection: "X", prob: pX, margin });
  pushMarketRow(rows, baseMeta, { marketId: "1x2", selection: "2", prob: p2, margin });

  // dc
  pushMarketRow(rows, baseMeta, { marketId: "dc", selection: "1X", prob: p1X, margin });
  pushMarketRow(rows, baseMeta, { marketId: "dc", selection: "12", prob: p12, margin });
  pushMarketRow(rows, baseMeta, { marketId: "dc", selection: "X2", prob: pX2, margin });

  // dnb
  pushMarketRow(rows, baseMeta, { marketId: "dnb", selection: "1", prob: pHomeDnb, margin });
  pushMarketRow(rows, baseMeta, { marketId: "dnb", selection: "2", prob: pAwayDnb, margin });

  // totals
  pushMarketRow(rows, baseMeta, { marketId: "ou_1_5", selection: "over", prob: pOver15, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ou_1_5", selection: "under", prob: pUnder15, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ou_2_5", selection: "over", prob: pOver25, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ou_2_5", selection: "under", prob: pUnder25, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ou_3_5", selection: "over", prob: pOver35, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ou_3_5", selection: "under", prob: pUnder35, margin });

  // btts
  pushMarketRow(rows, baseMeta, { marketId: "btts", selection: "yes", prob: pBttsYes, margin });
  pushMarketRow(rows, baseMeta, { marketId: "btts", selection: "no", prob: pBttsNo, margin });

  // team goals
  pushMarketRow(rows, baseMeta, { marketId: "home_ou_0_5", selection: "over", prob: pHomeOver05, margin });
  pushMarketRow(rows, baseMeta, { marketId: "home_ou_0_5", selection: "under", prob: pHomeUnder05, margin });
  pushMarketRow(rows, baseMeta, { marketId: "home_ou_1_5", selection: "over", prob: pHomeOver15, margin });
  pushMarketRow(rows, baseMeta, { marketId: "home_ou_1_5", selection: "under", prob: pHomeUnder15, margin });
  pushMarketRow(rows, baseMeta, { marketId: "home_ou_2_5", selection: "over", prob: pHomeOver25, margin });
  pushMarketRow(rows, baseMeta, { marketId: "home_ou_2_5", selection: "under", prob: pHomeUnder25, margin });

  pushMarketRow(rows, baseMeta, { marketId: "away_ou_0_5", selection: "over", prob: pAwayOver05, margin });
  pushMarketRow(rows, baseMeta, { marketId: "away_ou_0_5", selection: "under", prob: pAwayUnder05, margin });
  pushMarketRow(rows, baseMeta, { marketId: "away_ou_1_5", selection: "over", prob: pAwayOver15, margin });
  pushMarketRow(rows, baseMeta, { marketId: "away_ou_1_5", selection: "under", prob: pAwayUnder15, margin });
  pushMarketRow(rows, baseMeta, { marketId: "away_ou_2_5", selection: "over", prob: pAwayOver25, margin });
  pushMarketRow(rows, baseMeta, { marketId: "away_ou_2_5", selection: "under", prob: pAwayUnder25, margin });

  // HT 1x2 + DC
  pushMarketRow(rows, baseMeta, { marketId: "ht_1x2", selection: "1", prob: p1HT, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ht_1x2", selection: "X", prob: pXHT, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ht_1x2", selection: "2", prob: p2HT, margin });

  pushMarketRow(rows, baseMeta, { marketId: "ht_dc", selection: "1X", prob: p1XHT, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ht_dc", selection: "12", prob: p12HT, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ht_dc", selection: "X2", prob: pX2HT, margin });

  // HT totals + BTTS
  pushMarketRow(rows, baseMeta, { marketId: "ht_ou_0_5", selection: "over", prob: pHTOver05, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ht_ou_0_5", selection: "under", prob: pHTUnder05, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ht_ou_1_5", selection: "over", prob: pHTOver15, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ht_ou_1_5", selection: "under", prob: pHTUnder15, margin });

  pushMarketRow(rows, baseMeta, { marketId: "ht_btts", selection: "yes", prob: pHTBttsYes, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ht_btts", selection: "no", prob: pHTBttsNo, margin });

  // HT team goals
  pushMarketRow(rows, baseMeta, { marketId: "ht_home_ou_0_5", selection: "over", prob: pHTHomeOver05, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ht_home_ou_0_5", selection: "under", prob: pHTHomeUnder05, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ht_home_ou_1_5", selection: "over", prob: pHTHomeOver15, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ht_home_ou_1_5", selection: "under", prob: pHTHomeUnder15, margin });

  pushMarketRow(rows, baseMeta, { marketId: "ht_away_ou_0_5", selection: "over", prob: pHTAwayOver05, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ht_away_ou_0_5", selection: "under", prob: pHTAwayUnder05, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ht_away_ou_1_5", selection: "over", prob: pHTAwayOver15, margin });
  pushMarketRow(rows, baseMeta, { marketId: "ht_away_ou_1_5", selection: "under", prob: pHTAwayUnder15, margin });

  // ST totals
  pushMarketRow(rows, baseMeta, { marketId: "st_ou_0_5", selection: "over", prob: pSTOver05, margin });
  pushMarketRow(rows, baseMeta, { marketId: "st_ou_0_5", selection: "under", prob: pSTUnder05, margin });
  pushMarketRow(rows, baseMeta, { marketId: "st_ou_1_5", selection: "over", prob: pSTOver15, margin });
  pushMarketRow(rows, baseMeta, { marketId: "st_ou_1_5", selection: "under", prob: pSTUnder15, margin });

  // ST 1x2 + BTTS
  pushMarketRow(rows, baseMeta, { marketId: "st_1x2", selection: "1", prob: p1ST, margin });
  pushMarketRow(rows, baseMeta, { marketId: "st_1x2", selection: "X", prob: pXST, margin });
  pushMarketRow(rows, baseMeta, { marketId: "st_1x2", selection: "2", prob: p2ST, margin });

  pushMarketRow(rows, baseMeta, { marketId: "st_btts", selection: "yes", prob: pSTBttsYes, margin });
  pushMarketRow(rows, baseMeta, { marketId: "st_btts", selection: "no", prob: pSTBttsNo, margin });

  // odd/even
  pushMarketRow(rows, baseMeta, { marketId: "odd_even", selection: "even", prob: pEven, margin });
  pushMarketRow(rows, baseMeta, { marketId: "odd_even", selection: "odd", prob: pOdd, margin });

  // win to nil / clean sheet
  pushMarketRow(rows, baseMeta, {
    marketId: "home_win_to_nil",
    selection: "yes",
    prob: pHomeWinToNilYes,
    margin,
    minProb: 0.0005,
    maxProb: 0.95,
  });
  pushMarketRow(rows, baseMeta, {
    marketId: "home_win_to_nil",
    selection: "no",
    prob: pHomeWinToNilNo,
    margin,
  });

  pushMarketRow(rows, baseMeta, {
    marketId: "away_win_to_nil",
    selection: "yes",
    prob: pAwayWinToNilYes,
    margin,
    minProb: 0.0005,
    maxProb: 0.95,
  });
  pushMarketRow(rows, baseMeta, {
    marketId: "away_win_to_nil",
    selection: "no",
    prob: pAwayWinToNilNo,
    margin,
  });

  pushMarketRow(rows, baseMeta, {
    marketId: "clean_sheet_home",
    selection: "yes",
    prob: pCleanSheetHomeYes,
    margin,
    minProb: 0.0005,
    maxProb: 0.95,
  });
  pushMarketRow(rows, baseMeta, {
    marketId: "clean_sheet_home",
    selection: "no",
    prob: pCleanSheetHomeNo,
    margin,
  });

  pushMarketRow(rows, baseMeta, {
    marketId: "clean_sheet_away",
    selection: "yes",
    prob: pCleanSheetAwayYes,
    margin,
    minProb: 0.0005,
    maxProb: 0.95,
  });
  pushMarketRow(rows, baseMeta, {
    marketId: "clean_sheet_away",
    selection: "no",
    prob: pCleanSheetAwayNo,
    margin,
  });

  // exact score
  for (const key of exactScoreSelections) {
    const p = exactScoreProbMap.get(String(key)) ?? 0;
    pushMarketRow(rows, baseMeta, {
      marketId: "exact_score",
      selection: String(key),
      prob: p,
      margin,
      minProb: 0.0005,
      maxProb: 0.95,
    });
  }

  pushMarketRow(rows, baseMeta, {
    marketId: "exact_score",
    selection: "other",
    prob: pExactOther,
    margin,
    minProb: 0.0005,
    maxProb: 0.95,
  });

  return {
    engineVersion: "v2",
    rows,
    debug: {
      engineVersion: "v2",
      match: {
        matchId,
        competitionId,
        homeId,
        awayId,
        homeTeam,
        awayTeam,
      },
      config: {
        nowIso,
        margin,
        drawBoostInput: drawBoost,
        drawBoostApplied: appliedDrawBoost,
        drawBoostAppliedHT: appliedDrawBoostHT,
        drawBoostAppliedST: appliedDrawBoostST,
        maxGoals,
        firstHalfShare,
        exactScoreSelections: exactScoreSelections.map(String),
      },
      model: lambdaPack.debug,
      probabilities: {
        main: {
          p1,
          pX,
          p2,
          p1X,
          p12,
          pX2,
          pHomeDnb,
          pAwayDnb,
        },
        totals: {
          lambdaT,
          pOver15,
          pUnder15,
          pOver25,
          pUnder25,
          pOver35,
          pUnder35,
        },
        btts: {
          pBttsYes,
          pBttsNo,
          pH0,
          pA0,
          p00,
        },
        teamGoals: {
          home: {
            lambda: lambdaH,
            pOver05: pHomeOver05,
            pUnder05: pHomeUnder05,
            pOver15: pHomeOver15,
            pUnder15: pHomeUnder15,
            pOver25: pHomeOver25,
            pUnder25: pHomeUnder25,
          },
          away: {
            lambda: lambdaA,
            pOver05: pAwayOver05,
            pUnder05: pAwayUnder05,
            pOver15: pAwayOver15,
            pUnder15: pAwayUnder15,
            pOver25: pAwayOver25,
            pUnder25: pAwayUnder25,
          },
        },
        firstHalf: {
          lambdaH: lambdaHHT,
          lambdaA: lambdaAHT,
          lambdaT: lambdaTHT,
          p1: p1HT,
          pX: pXHT,
          p2: p2HT,
          p1X: p1XHT,
          p12: p12HT,
          pX2: pX2HT,
          pOver05: pHTOver05,
          pUnder05: pHTUnder05,
          pOver15: pHTOver15,
          pUnder15: pHTUnder15,
          pBttsYes: pHTBttsYes,
          pBttsNo: pHTBttsNo,
          pHomeOver05: pHTHomeOver05,
          pHomeUnder05: pHTHomeUnder05,
          pHomeOver15: pHTHomeOver15,
          pHomeUnder15: pHTHomeUnder15,
          pAwayOver05: pHTAwayOver05,
          pAwayUnder05: pHTAwayUnder05,
          pAwayOver15: pHTAwayOver15,
          pAwayUnder15: pHTAwayUnder15,
        },
        secondHalf: {
          lambdaH: lambdaHST,
          lambdaA: lambdaAST,
          lambdaT: lambdaTST,
          p1: p1ST,
          pX: pXST,
          p2: p2ST,
          pOver05: pSTOver05,
          pUnder05: pSTUnder05,
          pOver15: pSTOver15,
          pUnder15: pSTUnder15,
          pBttsYes: pSTBttsYes,
          pBttsNo: pSTBttsNo,
        },
        extras: {
          pEven,
          pOdd,
          pHomeWinToNilYes,
          pHomeWinToNilNo,
          pAwayWinToNilYes,
          pAwayWinToNilNo,
          pCleanSheetHomeYes,
          pCleanSheetHomeNo,
          pCleanSheetAwayYes,
          pCleanSheetAwayNo,
        },
        exactScore: {
          knownSelectionsSum: knownExactScoreSum,
          pExactOther,
          bySelection: Object.fromEntries(
            Array.from(exactScoreProbMap.entries()).sort((a, b) =>
              a[0].localeCompare(b[0])
            )
          ),
        },
      },
      rowsSummary: {
        rowsCount: rows.length,
        marketsCount: new Set(rows.map((r) => r.market_id)).size,
        sample: rows.slice(0, 20).map((row) => ({
          market_id: row.market_id,
          selection: row.selection,
          fair_prob: row.fair_prob,
          fair_odds: row.fair_odds,
          book_prob: row.book_prob,
          book_odds: row.book_odds,
        })),
      },
    },
  };
}