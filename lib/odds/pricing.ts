// lib/odds/pricing.ts

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function poissonPmf(lambda: number, k: number): number {
  if (!Number.isFinite(lambda) || lambda <= 0) return k === 0 ? 1 : 0;
  if (!Number.isFinite(k) || k < 0) return 0;

  const n = Math.floor(k);
  let probability = Math.exp(-lambda);

  for (let i = 1; i <= n; i += 1) {
    probability *= lambda / i;
  }

  return probability;
}

export function poissonCdf(lambda: number, k: number): number {
  if (!Number.isFinite(lambda) || lambda <= 0) return 1;
  if (!Number.isFinite(k) || k < 0) return 0;

  const n = Math.floor(k);
  let sum = 0;

  for (let i = 0; i <= n; i += 1) {
    sum += poissonPmf(lambda, i);
  }

  return clamp(sum, 0, 1);
}

export function exactScoreProb(
  lambdaHome: number,
  lambdaAway: number,
  homeGoals: number,
  awayGoals: number
): number {
  return poissonPmf(lambdaHome, homeGoals) * poissonPmf(lambdaAway, awayGoals);
}

export function totalEvenProb(lambdaTotal: number): number {
  if (!Number.isFinite(lambdaTotal) || lambdaTotal <= 0) return 1;

  return clamp((1 + Math.exp(-2 * lambdaTotal)) / 2, 0.0001, 0.9999);
}

export function bookify(
  probability: number,
  margin: number,
  minProb = 0.01,
  maxProb = 0.98
): {
  fair_prob: number;
  fair_odds: number;
  book_prob: number;
  book_odds: number;
} {
  const fairProb = clamp(probability, minProb, maxProb);
  const fairOdds = 1 / fairProb;

  const safeMargin = Number.isFinite(margin) && margin > 0 ? margin : 1;
  const bookProb = clamp(fairProb * safeMargin, minProb, maxProb);
  const bookOdds = 1 / bookProb;

  return {
    fair_prob: fairProb,
    fair_odds: fairOdds,
    book_prob: bookProb,
    book_odds: bookOdds,
  };
}