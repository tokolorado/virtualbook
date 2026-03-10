//lib/oddsEngine.ts
export type SelectionProbs = Record<string, number>;

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function normalize(probs: SelectionProbs): SelectionProbs {
  const sum = Object.values(probs).reduce((s, v) => s + v, 0);
  const out: SelectionProbs = {};
  for (const k of Object.keys(probs)) out[k] = probs[k] / sum;
  return out;
}

function poissonPmf(k: number, lambda: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return Math.exp(-lambda) * Math.pow(lambda, k) / fact;
}

export function computeMarkets(params: {
  lambdaHome: number;
  lambdaAway: number;
  maxGoals?: number;
}): Record<"1x2" | "ou_2_5" | "btts", SelectionProbs> {
  const { lambdaHome, lambdaAway, maxGoals = 6 } = params;

  let pHome = 0, pDraw = 0, pAway = 0;
  let pOver = 0, pUnder = 0;
  let pYes = 0, pNo = 0;

  for (let h = 0; h <= maxGoals; h++) {
    const ph = poissonPmf(h, lambdaHome);
    for (let a = 0; a <= maxGoals; a++) {
      const pa = poissonPmf(a, lambdaAway);
      const p = ph * pa;

      if (h > a) pHome += p;
      else if (h === a) pDraw += p;
      else pAway += p;

      if (h + a >= 3) pOver += p;
      else pUnder += p;

      if (h >= 1 && a >= 1) pYes += p;
      else pNo += p;
    }
  }

  return {
    "1x2": normalize({ HOME: pHome, DRAW: pDraw, AWAY: pAway }),
    "ou_2_5": normalize({ OVER: pOver, UNDER: pUnder }),
    "btts": normalize({ YES: pYes, NO: pNo }),
  };
}

export function applyMargin(fair: SelectionProbs, margin: number): SelectionProbs {
  // MVP: inflacja + normalizacja (stabilna)
  const inflated: SelectionProbs = {};
  for (const k of Object.keys(fair)) inflated[k] = fair[k] * (1 + margin);
  return normalize(inflated);
}

export function applyRiskAdjustment(
  probsWithMargin: SelectionProbs,
  exposureLiability: Record<string, number> | null,
  cfg?: { k?: number; maxAdj?: number }
): { bookProb: SelectionProbs; riskAdjustment: Record<string, number> } {
  const k = cfg?.k ?? 0.15;
  const maxAdj = cfg?.maxAdj ?? 0.08;

  const sels = Object.keys(probsWithMargin);
  const targetShare = 1 / sels.length;

  const totalLiab = sels.reduce((s, sel) => s + (exposureLiability?.[sel] ?? 0), 0);
  const adjustedRaw: SelectionProbs = {};
  const adjustments: Record<string, number> = {};

  for (const sel of sels) {
    const liab = exposureLiability?.[sel] ?? 0;
    const share = totalLiab > 0 ? liab / totalLiab : targetShare;
    const adj = clamp(k * (share - targetShare), -maxAdj, maxAdj);
    adjustments[sel] = adj;
    adjustedRaw[sel] = probsWithMargin[sel] * (1 + adj);
  }

  return { bookProb: normalize(adjustedRaw), riskAdjustment: adjustments };
}

export function probsToOdds(probs: SelectionProbs): Record<string, number> {
  const odds: Record<string, number> = {};
  for (const k of Object.keys(probs)) odds[k] = Math.max(1.01, 1 / probs[k]);
  return odds;
}