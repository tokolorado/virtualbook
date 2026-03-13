// lib/odds/engine-v1.ts

import {
  EngineConfig,
  EngineContext,
  EngineResult,
  MatchInput,
  OddsRowDb,
  StandingsCtx,
} from "./types";
import {
  bookify,
  clamp,
  exactScoreProb,
  poissonCdf,
  poissonPmf,
  totalEvenProb,
} from "./pricing";

const FIRST_HALF_SHARE = 0.45;

const EXACT_SCORE_SELECTIONS = [
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

function getCompetitionModel(competitionId: string | null) {
  const isCL = competitionId === "CL";

  if (isCL) {
    return {
      homeAdv: 1.025,
      standingsWeight: 0.38,
      neutralWeight: 0.62,
      neutralHome: 1.34,
      neutralAway: 1.18,

      overallImpact: 0.42,
      attackHomeImpact: 0.24,
      attackAwayImpact: 0.16,
      defenseImpact: 0.22,
      formImpact: 0.08,

      maxOverallGap: 0.22,
      maxAttackGap: 0.22,
      maxDefenseGap: 0.22,
      maxFormGap: 0.18,

      minLambdaH: 0.55,
      maxLambdaH: 2.35,
      minLambdaA: 0.45,
      maxLambdaA: 2.10,

      drawBoost: 1.08,
      smoothMix: 0.84,
      base1: 0.39,
      baseX: 0.27,
      base2: 0.34,
      minP1: 0.08,
      maxP1: 0.82,
      minPX: 0.14,
      maxPX: 0.38,
      minP2: 0.08,
      maxP2: 0.82,
    };
  }

  return {
    homeAdv: 1.05,
    standingsWeight: 0.65,
    neutralWeight: 0.35,
    neutralHome: 1.06,
    neutralAway: 0.94,

    overallImpact: 0.28,
    attackHomeImpact: 0.16,
    attackAwayImpact: 0.1,
    defenseImpact: 0.14,
    formImpact: 0.1,

    maxOverallGap: 0.25,
    maxAttackGap: 0.25,
    maxDefenseGap: 0.25,
    maxFormGap: 0.25,

    minLambdaH: 0.45,
    maxLambdaH: 2.85,
    minLambdaA: 0.35,
    maxLambdaA: 2.45,

    drawBoost: 1.18,
    smoothMix: 0.75,
    base1: 0.42,
    baseX: 0.28,
    base2: 0.3,
    minP1: 0.03,
    maxP1: 0.9,
    minPX: 0.06,
    maxPX: 0.5,
    minP2: 0.03,
    maxP2: 0.9,
  };
}

function computeLambdas(args: {
  competitionId: string | null;
  homeId: number | null;
  awayId: number | null;
  ctx: StandingsCtx | null;
  homeAdv: number;
  homeRating: number | null;
  awayRating: number | null;
  homeAttackRating: number | null;
  awayAttackRating: number | null;
  homeDefenseRating: number | null;
  awayDefenseRating: number | null;
  homeFormRating: number | null;
  awayFormRating: number | null;
}) {
  const model = getCompetitionModel(args.competitionId);

  if (!args.ctx || args.homeId == null || args.awayId == null) {
    let fallbackH = args.competitionId === "CL" ? 1.34 : 1.32;
    let fallbackA = args.competitionId === "CL" ? 1.18 : 1.08;

    const homeOverall =
      Number.isFinite(args.homeRating) ? Number(args.homeRating) : null;
    const awayOverall =
      Number.isFinite(args.awayRating) ? Number(args.awayRating) : null;

    if (homeOverall != null && awayOverall != null) {
      const gap = clamp(
        (homeOverall - awayOverall) / 100,
        -model.maxOverallGap,
        model.maxOverallGap
      );
      fallbackH *= 1 + gap * model.overallImpact;
      fallbackA *= 1 - gap * model.overallImpact;
    }

    return {
      lambdaH: clamp(fallbackH, model.minLambdaH, model.maxLambdaH),
      lambdaA: clamp(fallbackA, model.minLambdaA, model.maxLambdaA),
    };
  }

  const h = args.ctx.byTeamId.get(args.homeId) ?? null;
  const a = args.ctx.byTeamId.get(args.awayId) ?? null;

  if (!h || !a) {
    return {
      lambdaH: clamp(1.32, model.minLambdaH, model.maxLambdaH),
      lambdaA: clamp(1.08, model.minLambdaA, model.maxLambdaA),
    };
  }

  const hAtt = h.goalsFor / h.playedGames;
  const hDef = h.goalsAgainst / h.playedGames;
  const aAtt = a.goalsFor / a.playedGames;
  const aDef = a.goalsAgainst / a.playedGames;

  const lgGF = args.ctx.leagueAvgGoalsFor;
  const lgGA = args.ctx.leagueAvgGoalsAgainst;
  const base = lgGF;

  const lambdaH_raw = base * (hAtt / lgGF) * (aDef / lgGA) * model.homeAdv;
  const lambdaA_raw = base * (aAtt / lgGF) * (hDef / lgGA);

  let lambdaH =
    lambdaH_raw * model.standingsWeight +
    model.neutralHome * model.neutralWeight;

  let lambdaA =
    lambdaA_raw * model.standingsWeight +
    model.neutralAway * model.neutralWeight;

  const homeOverall =
    Number.isFinite(args.homeRating) ? Number(args.homeRating) : null;
  const awayOverall =
    Number.isFinite(args.awayRating) ? Number(args.awayRating) : null;

  if (homeOverall != null && awayOverall != null) {
    const overallGap = clamp(
      (homeOverall - awayOverall) / 100,
      -model.maxOverallGap,
      model.maxOverallGap
    );
    lambdaH *= 1 + overallGap * model.overallImpact;
    lambdaA *= 1 - overallGap * model.overallImpact;
  }

  const homeAttack =
    Number.isFinite(args.homeAttackRating) ? Number(args.homeAttackRating) : null;
  const awayAttack =
    Number.isFinite(args.awayAttackRating) ? Number(args.awayAttackRating) : null;

  if (homeAttack != null && awayAttack != null) {
    const attackGap = clamp(
      (homeAttack - awayAttack) / 100,
      -model.maxAttackGap,
      model.maxAttackGap
    );
    lambdaH *= 1 + attackGap * model.attackHomeImpact;
    lambdaA *= 1 - attackGap * model.attackAwayImpact;
  }

  const homeDefense =
    Number.isFinite(args.homeDefenseRating) ? Number(args.homeDefenseRating) : null;
  const awayDefense =
    Number.isFinite(args.awayDefenseRating) ? Number(args.awayDefenseRating) : null;

  if (homeDefense != null && awayDefense != null) {
    const defenseGap = clamp(
      (homeDefense - awayDefense) / 100,
      -model.maxDefenseGap,
      model.maxDefenseGap
    );
    lambdaH *= 1 - defenseGap * model.defenseImpact;
    lambdaA *= 1 + defenseGap * model.defenseImpact;
  }

  const homeForm =
    Number.isFinite(args.homeFormRating) ? Number(args.homeFormRating) : null;
  const awayForm =
    Number.isFinite(args.awayFormRating) ? Number(args.awayFormRating) : null;

  if (homeForm != null && awayForm != null) {
    const formGap = clamp(
      (homeForm - awayForm) / 100,
      -model.maxFormGap,
      model.maxFormGap
    );
    lambdaH *= 1 + formGap * model.formImpact;
    lambdaA *= 1 - formGap * model.formImpact;
  }

  lambdaH = clamp(lambdaH, model.minLambdaH, model.maxLambdaH);
  lambdaA = clamp(lambdaA, model.minLambdaA, model.maxLambdaA);

  return { lambdaH, lambdaA };
}

function compute1X2FromLambdas(args: {
  competitionId: string | null;
  lambdaH: number;
  lambdaA: number;
  drawBoost: number;
  maxGoals: number;
}) {
  const model = getCompetitionModel(args.competitionId);
  const effectiveDrawBoost =
    args.competitionId === "CL" ? model.drawBoost : args.drawBoost;

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

  pX *= effectiveDrawBoost;

  const s = p1 + pX + p2;
  if (s > 0) {
    p1 /= s;
    pX /= s;
    p2 /= s;
  }

  p1 = p1 * model.smoothMix + model.base1 * (1 - model.smoothMix);
  pX = pX * model.smoothMix + model.baseX * (1 - model.smoothMix);
  p2 = p2 * model.smoothMix + model.base2 * (1 - model.smoothMix);

  p1 = clamp(p1, model.minP1, model.maxP1);
  pX = clamp(pX, model.minPX, model.maxPX);
  p2 = clamp(p2, model.minP2, model.maxP2);

  const s2 = p1 + pX + p2;
  return { p1: p1 / s2, pX: pX / s2, p2: p2 / s2 };
}

function pushRow(
  rows: OddsRowDb[],
  args: {
    matchId: number;
    marketId: string;
    selection: string;
    prob: number;
    margin: number;
    nowIso: string;
    homeTeamName: string | null;
    awayTeamName: string | null;
    engineVersion: string;
    minProb?: number;
    maxProb?: number;
  }
) {
  const b = bookify(
    args.prob,
    args.margin,
    args.minProb ?? 0.01,
    args.maxProb ?? 0.98
  );

  rows.push({
    match_id: args.matchId,
    market_id: args.marketId,
    selection: args.selection,
    margin: args.margin,
    risk_adjustment: 0,
    updated_at: args.nowIso,
    home_team: args.homeTeamName,
    away_team: args.awayTeamName,
    fair_prob: b.fair_prob,
    fair_odds: b.fair_odds,
    book_prob: b.book_prob,
    book_odds: b.book_odds,
    engine_version: args.engineVersion,
  });
}

export function generateOddsV1(
  match: MatchInput,
  ctx: EngineContext,
  config: EngineConfig
): EngineResult {
  const engineVersion = "v1";
  const rows: OddsRowDb[] = [];

  const { lambdaH, lambdaA } = computeLambdas({
    competitionId: match.competitionId,
    homeId: match.homeId,
    awayId: match.awayId,
    ctx: ctx.standingsCtx,
    homeAdv: config.homeAdv,

    homeRating: ctx.homeRatingRow?.overall_rating ?? null,
    awayRating: ctx.awayRatingRow?.overall_rating ?? null,

    homeAttackRating: ctx.homeRatingRow?.attack_rating ?? null,
    awayAttackRating: ctx.awayRatingRow?.attack_rating ?? null,

    homeDefenseRating: ctx.homeRatingRow?.defense_rating ?? null,
    awayDefenseRating: ctx.awayRatingRow?.defense_rating ?? null,

    homeFormRating: ctx.homeRatingRow?.form_rating ?? null,
    awayFormRating: ctx.awayRatingRow?.form_rating ?? null,
  });

  const { p1, pX, p2 } = compute1X2FromLambdas({
    competitionId: match.competitionId,
    lambdaH,
    lambdaA,
    drawBoost: config.drawBoost,
    maxGoals: config.maxGoals,
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

  const pBttsYes = clamp(1 - pH0 - pA0 + p00, 0.01, 0.98);
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

  const lambdaH_HT = clamp(lambdaH * FIRST_HALF_SHARE, 0.05, 4.5);
  const lambdaA_HT = clamp(lambdaA * FIRST_HALF_SHARE, 0.05, 4.5);
  const lambdaT_HT = clamp(lambdaH_HT + lambdaA_HT, 0.1, 6.0);

  const { p1: p1HT, pX: pXHT, p2: p2HT } = compute1X2FromLambdas({
    competitionId: match.competitionId,
    lambdaH: lambdaH_HT,
    lambdaA: lambdaA_HT,
    drawBoost: config.drawBoost * 1.1,
    maxGoals: Math.max(4, config.maxGoals - 1),
  });

  const p1XHT = clamp(p1HT + pXHT, 0.01, 0.99);
  const p12HT = clamp(p1HT + p2HT, 0.01, 0.99);
  const pX2HT = clamp(pXHT + p2HT, 0.01, 0.99);

  const pHTUnder05 = poissonCdf(lambdaT_HT, 0);
  const pHTOver05 = 1 - pHTUnder05;
  const pHTUnder15 = poissonCdf(lambdaT_HT, 1);
  const pHTOver15 = 1 - pHTUnder15;

  const pH0HT = Math.exp(-lambdaH_HT);
  const pA0HT = Math.exp(-lambdaA_HT);
  const p00HT = Math.exp(-lambdaT_HT);

  const pHTBttsYes = clamp(1 - pH0HT - pA0HT + p00HT, 0.01, 0.98);
  const pHTBttsNo = 1 - pHTBttsYes;

  const pHTHomeUnder05 = poissonCdf(lambdaH_HT, 0);
  const pHTHomeOver05 = 1 - pHTHomeUnder05;
  const pHTHomeUnder15 = poissonCdf(lambdaH_HT, 1);
  const pHTHomeOver15 = 1 - pHTHomeUnder15;

  const pHTAwayUnder05 = poissonCdf(lambdaA_HT, 0);
  const pHTAwayOver05 = 1 - pHTAwayUnder05;
  const pHTAwayUnder15 = poissonCdf(lambdaA_HT, 1);
  const pHTAwayOver15 = 1 - pHTAwayUnder15;

  const lambdaH_ST = clamp(lambdaH - lambdaH_HT, 0.05, 4.5);
  const lambdaA_ST = clamp(lambdaA - lambdaA_HT, 0.05, 4.5);
  const lambdaT_ST = clamp(lambdaH_ST + lambdaA_ST, 0.1, 6.0);

  const pSTUnder05 = poissonCdf(lambdaT_ST, 0);
  const pSTOver05 = 1 - pSTUnder05;
  const pSTUnder15 = poissonCdf(lambdaT_ST, 1);
  const pSTOver15 = 1 - pSTUnder15;

  const { p1: p1ST, pX: pXST, p2: p2ST } = compute1X2FromLambdas({
    competitionId: match.competitionId,
    lambdaH: lambdaH_ST,
    lambdaA: lambdaA_ST,
    drawBoost: config.drawBoost * 1.05,
    maxGoals: Math.max(4, config.maxGoals - 1),
  });

  const pH0ST = Math.exp(-lambdaH_ST);
  const pA0ST = Math.exp(-lambdaA_ST);
  const p00ST = Math.exp(-lambdaT_ST);

  const pSTBttsYes = clamp(1 - pH0ST - pA0ST + p00ST, 0.01, 0.98);
  const pSTBttsNo = 1 - pSTBttsYes;

  const pEven = totalEvenProb(lambdaT);
  const pOdd = 1 - pEven;

  const dnbDenom = Math.max(p1 + p2, 0.0001);
  const pHomeDnb = clamp(p1 / dnbDenom, 0.01, 0.99);
  const pAwayDnb = clamp(p2 / dnbDenom, 0.01, 0.99);

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

  for (const key of EXACT_SCORE_SELECTIONS) {
    const [hgRaw, agRaw] = key.split(":");
    const hg = Number(hgRaw);
    const ag = Number(agRaw);
    const p = exactScoreProb(lambdaH, lambdaA, hg, ag);
    exactScoreProbMap.set(key, p);
    knownExactScoreSum += p;
  }

  const pExactOther = clamp(1 - knownExactScoreSum, 0.0005, 0.999);

  const common = {
    matchId: match.matchId,
    margin: config.margin,
    nowIso: config.nowIso,
    homeTeamName: match.homeTeamName,
    awayTeamName: match.awayTeamName,
    engineVersion,
  };

  pushRow(rows, { ...common, marketId: "1x2", selection: "1", prob: p1 });
  pushRow(rows, { ...common, marketId: "1x2", selection: "X", prob: pX });
  pushRow(rows, { ...common, marketId: "1x2", selection: "2", prob: p2 });

  pushRow(rows, { ...common, marketId: "dc", selection: "1X", prob: p1X });
  pushRow(rows, { ...common, marketId: "dc", selection: "12", prob: p12 });
  pushRow(rows, { ...common, marketId: "dc", selection: "X2", prob: pX2 });

  pushRow(rows, { ...common, marketId: "dnb", selection: "1", prob: pHomeDnb });
  pushRow(rows, { ...common, marketId: "dnb", selection: "2", prob: pAwayDnb });

  pushRow(rows, { ...common, marketId: "ou_1_5", selection: "over", prob: pOver15 });
  pushRow(rows, { ...common, marketId: "ou_1_5", selection: "under", prob: pUnder15 });
  pushRow(rows, { ...common, marketId: "ou_2_5", selection: "over", prob: pOver25 });
  pushRow(rows, { ...common, marketId: "ou_2_5", selection: "under", prob: pUnder25 });
  pushRow(rows, { ...common, marketId: "ou_3_5", selection: "over", prob: pOver35 });
  pushRow(rows, { ...common, marketId: "ou_3_5", selection: "under", prob: pUnder35 });

  pushRow(rows, { ...common, marketId: "btts", selection: "yes", prob: pBttsYes });
  pushRow(rows, { ...common, marketId: "btts", selection: "no", prob: pBttsNo });

  pushRow(rows, { ...common, marketId: "home_ou_0_5", selection: "over", prob: pHomeOver05 });
  pushRow(rows, { ...common, marketId: "home_ou_0_5", selection: "under", prob: pHomeUnder05 });
  pushRow(rows, { ...common, marketId: "home_ou_1_5", selection: "over", prob: pHomeOver15 });
  pushRow(rows, { ...common, marketId: "home_ou_1_5", selection: "under", prob: pHomeUnder15 });
  pushRow(rows, { ...common, marketId: "home_ou_2_5", selection: "over", prob: pHomeOver25 });
  pushRow(rows, { ...common, marketId: "home_ou_2_5", selection: "under", prob: pHomeUnder25 });

  pushRow(rows, { ...common, marketId: "away_ou_0_5", selection: "over", prob: pAwayOver05 });
  pushRow(rows, { ...common, marketId: "away_ou_0_5", selection: "under", prob: pAwayUnder05 });
  pushRow(rows, { ...common, marketId: "away_ou_1_5", selection: "over", prob: pAwayOver15 });
  pushRow(rows, { ...common, marketId: "away_ou_1_5", selection: "under", prob: pAwayUnder15 });
  pushRow(rows, { ...common, marketId: "away_ou_2_5", selection: "over", prob: pAwayOver25 });
  pushRow(rows, { ...common, marketId: "away_ou_2_5", selection: "under", prob: pAwayUnder25 });

  pushRow(rows, { ...common, marketId: "ht_1x2", selection: "1", prob: p1HT });
  pushRow(rows, { ...common, marketId: "ht_1x2", selection: "X", prob: pXHT });
  pushRow(rows, { ...common, marketId: "ht_1x2", selection: "2", prob: p2HT });

  pushRow(rows, { ...common, marketId: "ht_dc", selection: "1X", prob: p1XHT });
  pushRow(rows, { ...common, marketId: "ht_dc", selection: "12", prob: p12HT });
  pushRow(rows, { ...common, marketId: "ht_dc", selection: "X2", prob: pX2HT });

  pushRow(rows, { ...common, marketId: "ht_ou_0_5", selection: "over", prob: pHTOver05 });
  pushRow(rows, { ...common, marketId: "ht_ou_0_5", selection: "under", prob: pHTUnder05 });
  pushRow(rows, { ...common, marketId: "ht_ou_1_5", selection: "over", prob: pHTOver15 });
  pushRow(rows, { ...common, marketId: "ht_ou_1_5", selection: "under", prob: pHTUnder15 });

  pushRow(rows, { ...common, marketId: "ht_btts", selection: "yes", prob: pHTBttsYes });
  pushRow(rows, { ...common, marketId: "ht_btts", selection: "no", prob: pHTBttsNo });

  pushRow(rows, { ...common, marketId: "ht_home_ou_0_5", selection: "over", prob: pHTHomeOver05 });
  pushRow(rows, { ...common, marketId: "ht_home_ou_0_5", selection: "under", prob: pHTHomeUnder05 });
  pushRow(rows, { ...common, marketId: "ht_home_ou_1_5", selection: "over", prob: pHTHomeOver15 });
  pushRow(rows, { ...common, marketId: "ht_home_ou_1_5", selection: "under", prob: pHTHomeUnder15 });

  pushRow(rows, { ...common, marketId: "ht_away_ou_0_5", selection: "over", prob: pHTAwayOver05 });
  pushRow(rows, { ...common, marketId: "ht_away_ou_0_5", selection: "under", prob: pHTAwayUnder05 });
  pushRow(rows, { ...common, marketId: "ht_away_ou_1_5", selection: "over", prob: pHTAwayOver15 });
  pushRow(rows, { ...common, marketId: "ht_away_ou_1_5", selection: "under", prob: pHTAwayUnder15 });

  pushRow(rows, { ...common, marketId: "st_ou_0_5", selection: "over", prob: pSTOver05 });
  pushRow(rows, { ...common, marketId: "st_ou_0_5", selection: "under", prob: pSTUnder05 });
  pushRow(rows, { ...common, marketId: "st_ou_1_5", selection: "over", prob: pSTOver15 });
  pushRow(rows, { ...common, marketId: "st_ou_1_5", selection: "under", prob: pSTUnder15 });

  pushRow(rows, { ...common, marketId: "st_1x2", selection: "1", prob: p1ST });
  pushRow(rows, { ...common, marketId: "st_1x2", selection: "X", prob: pXST });
  pushRow(rows, { ...common, marketId: "st_1x2", selection: "2", prob: p2ST });

  pushRow(rows, { ...common, marketId: "st_btts", selection: "yes", prob: pSTBttsYes });
  pushRow(rows, { ...common, marketId: "st_btts", selection: "no", prob: pSTBttsNo });

  pushRow(rows, { ...common, marketId: "odd_even", selection: "even", prob: pEven });
  pushRow(rows, { ...common, marketId: "odd_even", selection: "odd", prob: pOdd });

  pushRow(rows, {
    ...common,
    marketId: "home_win_to_nil",
    selection: "yes",
    prob: pHomeWinToNilYes,
    minProb: 0.0005,
    maxProb: 0.95,
  });
  pushRow(rows, {
    ...common,
    marketId: "home_win_to_nil",
    selection: "no",
    prob: pHomeWinToNilNo,
  });

  pushRow(rows, {
    ...common,
    marketId: "away_win_to_nil",
    selection: "yes",
    prob: pAwayWinToNilYes,
    minProb: 0.0005,
    maxProb: 0.95,
  });
  pushRow(rows, {
    ...common,
    marketId: "away_win_to_nil",
    selection: "no",
    prob: pAwayWinToNilNo,
  });

  pushRow(rows, {
    ...common,
    marketId: "clean_sheet_home",
    selection: "yes",
    prob: pCleanSheetHomeYes,
    minProb: 0.0005,
    maxProb: 0.95,
  });
  pushRow(rows, {
    ...common,
    marketId: "clean_sheet_home",
    selection: "no",
    prob: pCleanSheetHomeNo,
  });

  pushRow(rows, {
    ...common,
    marketId: "clean_sheet_away",
    selection: "yes",
    prob: pCleanSheetAwayYes,
    minProb: 0.0005,
    maxProb: 0.95,
  });
  pushRow(rows, {
    ...common,
    marketId: "clean_sheet_away",
    selection: "no",
    prob: pCleanSheetAwayNo,
  });

  for (const key of EXACT_SCORE_SELECTIONS) {
    pushRow(rows, {
      ...common,
      marketId: "exact_score",
      selection: key,
      prob: exactScoreProbMap.get(key) ?? 0,
      minProb: 0.0005,
      maxProb: 0.95,
    });
  }

  pushRow(rows, {
    ...common,
    marketId: "exact_score",
    selection: "other",
    prob: pExactOther,
    minProb: 0.0005,
    maxProb: 0.95,
  });

  return { engineVersion, rows };
}