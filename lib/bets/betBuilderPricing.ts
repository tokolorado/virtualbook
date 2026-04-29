import { clamp, oddsFromProb, poissonP, round2 } from "../odds/poisson";

export type BetBuilderItemInput = {
  matchId?: string | number | null;
  market?: string | null;
  pick?: string | null;
  odd?: number | string | null;
  home?: string | null;
  away?: string | null;
};

export type BetBuilderOddsRow = {
  market_id: string;
  selection: string;
  fair_prob?: number | string | null;
  book_odds?: number | string | null;
};

export type BetBuilderPricingOk = {
  ok: true;
  mode: "bet_builder";
  totalOdds: number;
  potentialWin?: number;
  jointProbability: number;
  productOdds: number;
  correlationFactor: number;
  lambdaHome: number;
  lambdaAway: number;
  itemsCount: number;
  supportedMarkets: string[];
  meta: Record<string, unknown>;
};

export type BetBuilderPricingFail = {
  ok: false;
  code:
    | "empty"
    | "too_few_items"
    | "too_many_items"
    | "multi_match"
    | "duplicate_selection"
    | "unsupported_market"
    | "missing_odds"
    | "invalid_probability";
  message: string;
  details?: unknown;
};

export type BetBuilderPricingResult =
  | BetBuilderPricingOk
  | BetBuilderPricingFail;

type NormalizedItem = {
  matchId: string;
  market: string;
  pick: string;
  odd: number;
  home?: string | null;
  away?: string | null;
};

type ScoreState = {
  ftHome: number;
  ftAway: number;
  htHome: number;
  htAway: number;
  shHome: number;
  shAway: number;
};

type Predicate = (state: ScoreState) => boolean | null;

const MAX_BUILDER_ITEMS = 8;
const MAX_TOTAL_ODDS = 150;
const MATRIX_MAX_GOALS = 8;
const BUILDER_MARGIN = 1.08;
const HALF_SPLIT_FIRST = 0.45;

function toNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePick(value: unknown) {
  return String(value ?? "").trim();
}

function parseLineToken(value: string | null) {
  if (!value) return null;
  const normalized = value.replace(",", ".").replace("_", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function lineFromMarket(market: string) {
  const decimal = market.match(/(?:^|_)(\d+\.\d+)$/);
  if (decimal) return parseLineToken(decimal[1]);

  const underscore = market.match(/(?:^|_)(\d+)_(\d+)$/);
  if (underscore) return parseLineToken(`${underscore[1]}.${underscore[2]}`);

  return null;
}

function normalizeItems(
  items: BetBuilderItemInput[]
): NormalizedItem[] | BetBuilderPricingFail {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      ok: false,
      code: "empty",
      message: "Bet Builder jest pusty.",
    };
  }

  if (items.length < 2) {
    return {
      ok: false,
      code: "too_few_items",
      message: "Bet Builder wymaga minimum 2 zdarzeń z jednego meczu.",
    };
  }

  if (items.length > MAX_BUILDER_ITEMS) {
    return {
      ok: false,
      code: "too_many_items",
      message: `Bet Builder może mieć maksymalnie ${MAX_BUILDER_ITEMS} zdarzeń.`,
    };
  }

  const normalized = items.map((item) => ({
    matchId: String(item.matchId ?? "").trim(),
    market: normalizeText(item.market),
    pick: normalizePick(item.pick),
    odd: toNumber(item.odd),
    home: item.home ?? null,
    away: item.away ?? null,
  }));

  if (normalized.some((item) => !item.matchId || !item.market || !item.pick)) {
    return {
      ok: false,
      code: "missing_odds",
      message: "Bet Builder zawiera niepełne zdarzenie.",
    };
  }

  const matchIds = new Set(normalized.map((item) => item.matchId));
  if (matchIds.size !== 1) {
    return {
      ok: false,
      code: "multi_match",
      message: "Bet Builder działa tylko dla jednego meczu naraz.",
    };
  }

  const unique = new Set(
    normalized.map((item) => `${item.matchId}|${item.market}|${item.pick}`)
  );
  if (unique.size !== normalized.length) {
    return {
      ok: false,
      code: "duplicate_selection",
      message: "Ten sam typ nie może wystąpić dwa razy w Bet Builderze.",
    };
  }

  if (normalized.some((item) => !Number.isFinite(item.odd) || item.odd <= 1)) {
    return {
      ok: false,
      code: "missing_odds",
      message: "Bet Builder zawiera zdarzenie bez aktywnego kursu.",
    };
  }

  return normalized;
}

function isOverPick(pick: string) {
  return pick.toLowerCase() === "over" || pick.toLowerCase().startsWith("over ");
}

function isUnderPick(pick: string) {
  return (
    pick.toLowerCase() === "under" || pick.toLowerCase().startsWith("under ")
  );
}

function resolve1X2(home: number, away: number) {
  if (home > away) return "1";
  if (home === away) return "X";
  return "2";
}

function isOver(total: number, line: number) {
  return total > line;
}

function isUnder(total: number, line: number) {
  return total < line;
}

function predicateForItem(item: NormalizedItem): Predicate | null {
  const market = item.market;
  const pick = item.pick;
  const upper = pick.toUpperCase();
  const lower = pick.toLowerCase();
  const line = lineFromMarket(market);

  if (market === "1x2" || market === "ft_1x2") {
    if (!["1", "X", "2"].includes(upper)) return null;
    return (state) => resolve1X2(state.ftHome, state.ftAway) === upper;
  }

  if (market === "ht_1x2") {
    if (!["1", "X", "2"].includes(upper)) return null;
    return (state) => resolve1X2(state.htHome, state.htAway) === upper;
  }

  if (market === "st_1x2" || market === "sh_1x2") {
    if (!["1", "X", "2"].includes(upper)) return null;
    return (state) => resolve1X2(state.shHome, state.shAway) === upper;
  }

  if (market === "dc" || market === "ht_dc") {
    const allowed = new Set(["1X", "12", "X2"]);
    if (!allowed.has(upper)) return null;
    return (state) => {
      const base =
        market === "ht_dc"
          ? resolve1X2(state.htHome, state.htAway)
          : resolve1X2(state.ftHome, state.ftAway);
      return upper.includes(base);
    };
  }

  if (market === "dnb") {
    if (!["1", "2"].includes(upper)) return null;
    return (state) => {
      const result = resolve1X2(state.ftHome, state.ftAway);
      if (result === "X") return null;
      return result === upper;
    };
  }

  if (market === "btts") {
    if (!["yes", "no"].includes(lower)) return null;
    return (state) => (state.ftHome > 0 && state.ftAway > 0) === (lower === "yes");
  }

  if (market === "ht_btts") {
    if (!["yes", "no"].includes(lower)) return null;
    return (state) => (state.htHome > 0 && state.htAway > 0) === (lower === "yes");
  }

  if (market === "st_btts" || market === "sh_btts") {
    if (!["yes", "no"].includes(lower)) return null;
    return (state) => (state.shHome > 0 && state.shAway > 0) === (lower === "yes");
  }

  if (
    /^(ou|ft_ou)_\d+_\d+$/.test(market) ||
    /^ft_total_\d+(?:[._]\d+)?$/.test(market)
  ) {
    if (line == null || (!isOverPick(pick) && !isUnderPick(pick))) return null;
    return (state) =>
      isOverPick(pick)
        ? isOver(state.ftHome + state.ftAway, line)
        : isUnder(state.ftHome + state.ftAway, line);
  }

  if (
    /^home_ou_\d+_\d+$/.test(market) ||
    /^ft_home_tg_\d+(?:[._]\d+)?$/.test(market)
  ) {
    if (line == null || (!isOverPick(pick) && !isUnderPick(pick))) return null;
    return (state) =>
      isOverPick(pick) ? isOver(state.ftHome, line) : isUnder(state.ftHome, line);
  }

  if (
    /^away_ou_\d+_\d+$/.test(market) ||
    /^ft_away_tg_\d+(?:[._]\d+)?$/.test(market)
  ) {
    if (line == null || (!isOverPick(pick) && !isUnderPick(pick))) return null;
    return (state) =>
      isOverPick(pick) ? isOver(state.ftAway, line) : isUnder(state.ftAway, line);
  }

  if (/^ht_ou_\d+_\d+$/.test(market)) {
    if (line == null || (!isOverPick(pick) && !isUnderPick(pick))) return null;
    return (state) =>
      isOverPick(pick)
        ? isOver(state.htHome + state.htAway, line)
        : isUnder(state.htHome + state.htAway, line);
  }

  if (/^ht_home_ou_\d+_\d+$/.test(market)) {
    if (line == null || (!isOverPick(pick) && !isUnderPick(pick))) return null;
    return (state) =>
      isOverPick(pick) ? isOver(state.htHome, line) : isUnder(state.htHome, line);
  }

  if (/^ht_away_ou_\d+_\d+$/.test(market)) {
    if (line == null || (!isOverPick(pick) && !isUnderPick(pick))) return null;
    return (state) =>
      isOverPick(pick) ? isOver(state.htAway, line) : isUnder(state.htAway, line);
  }

  if (/^(st|sh)_ou_\d+_\d+$/.test(market)) {
    if (line == null || (!isOverPick(pick) && !isUnderPick(pick))) return null;
    return (state) =>
      isOverPick(pick)
        ? isOver(state.shHome + state.shAway, line)
        : isUnder(state.shHome + state.shAway, line);
  }

  if (market === "odd_even") {
    if (!["odd", "even"].includes(lower)) return null;
    return (state) => ((state.ftHome + state.ftAway) % 2 === 0) === (lower === "even");
  }

  if (market === "exact_score") {
    if (lower === "other") return null;
    const score = pick.replace(/[_-]/g, ":").match(/^(\d+):(\d+)$/);
    if (!score) return null;
    const home = Number(score[1]);
    const away = Number(score[2]);
    return (state) => state.ftHome === home && state.ftAway === away;
  }

  if (market === "ft_total_exact") {
    if (lower === "other" || lower === "6+") return null;
    const total = Number(pick);
    if (!Number.isInteger(total) || total < 0) return null;
    return (state) => state.ftHome + state.ftAway === total;
  }

  if (market === "home_win_to_nil") {
    if (!["yes", "no"].includes(lower)) return null;
    return (state) =>
      (state.ftHome > state.ftAway && state.ftAway === 0) === (lower === "yes");
  }

  if (market === "away_win_to_nil") {
    if (!["yes", "no"].includes(lower)) return null;
    return (state) =>
      (state.ftAway > state.ftHome && state.ftHome === 0) === (lower === "yes");
  }

  if (market === "clean_sheet_home") {
    if (!["yes", "no"].includes(lower)) return null;
    return (state) => (state.ftAway === 0) === (lower === "yes");
  }

  if (market === "clean_sheet_away") {
    if (!["yes", "no"].includes(lower)) return null;
    return (state) => (state.ftHome === 0) === (lower === "yes");
  }

  return null;
}

function predicateProbability(
  lambdaHome: number,
  lambdaAway: number,
  predicate: Predicate
) {
  let probability = 0;
  let totalMass = 0;

  const htHomeLambda = lambdaHome * HALF_SPLIT_FIRST;
  const htAwayLambda = lambdaAway * HALF_SPLIT_FIRST;
  const shHomeLambda = lambdaHome * (1 - HALF_SPLIT_FIRST);
  const shAwayLambda = lambdaAway * (1 - HALF_SPLIT_FIRST);

  const htHomeP = Array.from({ length: MATRIX_MAX_GOALS + 1 }, (_, i) =>
    poissonP(i, htHomeLambda)
  );
  const htAwayP = Array.from({ length: MATRIX_MAX_GOALS + 1 }, (_, i) =>
    poissonP(i, htAwayLambda)
  );
  const shHomeP = Array.from({ length: MATRIX_MAX_GOALS + 1 }, (_, i) =>
    poissonP(i, shHomeLambda)
  );
  const shAwayP = Array.from({ length: MATRIX_MAX_GOALS + 1 }, (_, i) =>
    poissonP(i, shAwayLambda)
  );

  for (let htH = 0; htH <= MATRIX_MAX_GOALS; htH++) {
    for (let htA = 0; htA <= MATRIX_MAX_GOALS; htA++) {
      for (let shH = 0; shH <= MATRIX_MAX_GOALS; shH++) {
        for (let shA = 0; shA <= MATRIX_MAX_GOALS; shA++) {
          const mass = htHomeP[htH] * htAwayP[htA] * shHomeP[shH] * shAwayP[shA];
          totalMass += mass;

          const accepted = predicate({
            htHome: htH,
            htAway: htA,
            shHome: shH,
            shAway: shA,
            ftHome: htH + shH,
            ftAway: htA + shA,
          });

          if (accepted === true) probability += mass;
        }
      }
    }
  }

  return totalMass > 0 ? probability / totalMass : 0;
}

function jointProbability(lambdaHome: number, lambdaAway: number, predicates: Predicate[]) {
  return predicateProbability(lambdaHome, lambdaAway, (state) => {
    for (const predicate of predicates) {
      const accepted = predicate(state);
      if (accepted !== true) return false;
    }
    return true;
  });
}

function oddsRowProbability(row: BetBuilderOddsRow) {
  const fair = toNumber(row.fair_prob);
  if (Number.isFinite(fair) && fair > 0 && fair < 1) return fair;

  const odds = toNumber(row.book_odds);
  if (Number.isFinite(odds) && odds > 1) return clamp(1 / odds, 0.001, 0.999);

  return null;
}

function fitLambdasFromOdds(oddsRows: BetBuilderOddsRow[]) {
  const anchors = oddsRows
    .map((row) => {
      const item: NormalizedItem = {
        matchId: "anchor",
        market: normalizeText(row.market_id),
        pick: normalizePick(row.selection),
        odd: toNumber(row.book_odds),
      };
      const predicate = predicateForItem(item);
      const probability = oddsRowProbability(row);
      if (!predicate || probability == null) return null;
      return { predicate, probability };
    })
    .filter(
      (row): row is { predicate: Predicate; probability: number } => row !== null
    )
    .slice(0, 28);

  let best = { lambdaHome: 1.35, lambdaAway: 1.1, error: Number.POSITIVE_INFINITY };

  for (let h = 0.35; h <= 3.85; h += 0.1) {
    for (let a = 0.35; a <= 3.85; a += 0.1) {
      let error = 0;

      if (anchors.length === 0) {
        const total = h + a;
        error = Math.pow(total - 2.55, 2);
      } else {
        for (const anchor of anchors) {
          const model = predicateProbability(h, a, anchor.predicate);
          error += Math.pow(model - anchor.probability, 2);
        }
      }

      if (error < best.error) {
        best = { lambdaHome: h, lambdaAway: a, error };
      }
    }
  }

  return {
    lambdaHome: Number(best.lambdaHome.toFixed(2)),
    lambdaAway: Number(best.lambdaAway.toFixed(2)),
    fitError: Number(best.error.toFixed(6)),
    anchors: anchors.length,
  };
}

export function priceBetBuilderSlip(params: {
  items: BetBuilderItemInput[];
  oddsRows: BetBuilderOddsRow[];
  stake?: number | null;
}): BetBuilderPricingResult {
  const normalized = normalizeItems(params.items);
  if (!Array.isArray(normalized)) return normalized;

  const predicates = normalized.map((item) => ({
    item,
    predicate: predicateForItem(item),
  }));

  const unsupported = predicates.filter((entry) => !entry.predicate);
  if (unsupported.length > 0) {
    return {
      ok: false,
      code: "unsupported_market",
      message:
        "Ten rynek nie jest jeszcze obsługiwany w Bet Builderze. Usuń go albo postaw jako zwykły kupon.",
      details: unsupported.map((entry) => ({
        market: entry.item.market,
        pick: entry.item.pick,
      })),
    };
  }

  const fitted = fitLambdasFromOdds(params.oddsRows);
  const probability = jointProbability(
    fitted.lambdaHome,
    fitted.lambdaAway,
    predicates.map((entry) => entry.predicate!)
  );

  if (!Number.isFinite(probability) || probability <= 0) {
    return {
      ok: false,
      code: "invalid_probability",
      message: "Nie udało się policzyć kursu Bet Buildera dla tej kombinacji.",
    };
  }

  const rawOdds = oddsFromProb(clamp(probability, 0.0001, 0.99), BUILDER_MARGIN);
  const productOdds = normalized.reduce((acc, item) => acc * item.odd, 1);
  const cappedByProduct = Math.min(rawOdds, productOdds * 0.98);
  const totalOdds = round2(clamp(cappedByProduct, 1.01, MAX_TOTAL_ODDS));
  const stake = toNumber(params.stake);

  return {
    ok: true,
    mode: "bet_builder",
    totalOdds,
    potentialWin:
      Number.isFinite(stake) && stake > 0 ? round2(stake * totalOdds) : undefined,
    jointProbability: Number(probability.toFixed(6)),
    productOdds: round2(productOdds),
    correlationFactor: Number((totalOdds / productOdds).toFixed(4)),
    lambdaHome: fitted.lambdaHome,
    lambdaAway: fitted.lambdaAway,
    itemsCount: normalized.length,
    supportedMarkets: Array.from(new Set(normalized.map((item) => item.market))),
    meta: {
      engine: "bet-builder-v1",
      method: "poisson-joint-probability",
      margin: BUILDER_MARGIN,
      maxTotalOdds: MAX_TOTAL_ODDS,
      maxMatrixGoals: MATRIX_MAX_GOALS,
      lambdaHome: fitted.lambdaHome,
      lambdaAway: fitted.lambdaAway,
      fitError: fitted.fitError,
      anchors: fitted.anchors,
      productOdds: round2(productOdds),
      correlationFactor: Number((totalOdds / productOdds).toFixed(4)),
      jointProbability: Number(probability.toFixed(6)),
      voidPolicy: "any_void_refunds_builder",
    },
  };
}
