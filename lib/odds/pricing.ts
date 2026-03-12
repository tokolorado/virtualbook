// lib/odds/pricing.ts

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function poissonPmf(lambda: number, k: number) {
  if (!Number.isFinite(lambda) || lambda < 0) return 0;
  if (!Number.isInteger(k) || k < 0) return 0;

  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) {
    p *= lambda / i;
  }
  return p;
}

export function poissonCdf(lambda: number, k: number) {
  if (!Number.isFinite(lambda) || lambda < 0) return 0;
  if (!Number.isInteger(k)) return 0;
  if (k < 0) return 0;

  let sum = 0;
  for (let i = 0; i <= k; i++) {
    sum += poissonPmf(lambda, i);
  }
  return clamp(sum, 0, 1);
}

export function exactScoreProb(
  lambdaHome: number,
  lambdaAway: number,
  homeGoals: number,
  awayGoals: number
) {
  return poissonPmf(lambdaHome, homeGoals) * poissonPmf(lambdaAway, awayGoals);
}

export function totalEvenProb(lambdaTotal: number) {
  if (!Number.isFinite(lambdaTotal) || lambdaTotal < 0) return 0.5;
  return clamp((1 + Math.exp(-2 * lambdaTotal)) / 2, 0.0001, 0.9999);
}

export function bookify(
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