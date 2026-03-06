// lib/odds/poisson.ts
export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export function round2(n: number) {
  return Number(n.toFixed(2));
}

export function poissonP(k: number, lambda: number) {
  // P(X=k) for Poisson(lambda)
  // stable enough for k<=10
  const e = Math.exp(-lambda);
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return e * Math.pow(lambda, k) / fact;
}

export function scoreMatrix(lambdaHome: number, lambdaAway: number, maxGoals = 6) {
  const homeP = Array.from({ length: maxGoals + 1 }, (_, i) => poissonP(i, lambdaHome));
  const awayP = Array.from({ length: maxGoals + 1 }, (_, i) => poissonP(i, lambdaAway));

  const mat: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    mat[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      mat[h][a] = homeP[h] * awayP[a];
    }
  }
  return mat;
}

export function probs1X2FromMatrix(mat: number[][]) {
  let p1 = 0, px = 0, p2 = 0;
  const maxH = mat.length - 1;
  const maxA = mat[0].length - 1;

  for (let h = 0; h <= maxH; h++) {
    for (let a = 0; a <= maxA; a++) {
      const p = mat[h][a];
      if (h > a) p1 += p;
      else if (h === a) px += p;
      else p2 += p;
    }
  }

  // normalize (matrix is truncated)
  const sum = p1 + px + p2;
  return { p1: p1 / sum, px: px / sum, p2: p2 / sum };
}

export function totalGoalsDist(mat: number[][]) {
  const maxH = mat.length - 1;
  const maxA = mat[0].length - 1;
  const dist = Array.from({ length: maxH + maxA + 1 }, () => 0);

  for (let h = 0; h <= maxH; h++) {
    for (let a = 0; a <= maxA; a++) {
      dist[h + a] += mat[h][a];
    }
  }

  const sum = dist.reduce((acc, x) => acc + x, 0);
  return dist.map((x) => x / sum);
}

export function teamGoalsDist(lambda: number, maxGoals = 6) {
  const dist = Array.from({ length: maxGoals + 1 }, (_, i) => poissonP(i, lambda));
  const sum = dist.reduce((acc, x) => acc + x, 0);
  return dist.map((x) => x / sum);
}

export function probOverAsian(dist: number[], line: number) {
  // Asian total goals lines:
  // - x.5: no push
  // - x.0: push at exactly x
  // We return {pOver, pUnder, pPush}
  const isInteger = Math.abs(line - Math.round(line)) < 1e-9;
  const L = Math.floor(line);

  let pPush = 0;
  if (isInteger) {
    pPush = dist[L] ?? 0;
  }

  let pUnder = 0;
  let pOver = 0;

  for (let g = 0; g < dist.length; g++) {
    const p = dist[g] ?? 0;
    if (isInteger) {
      if (g < L) pUnder += p;
      else if (g > L) pOver += p;
    } else {
      // x.5
      if (g <= L) pUnder += p;
      else pOver += p;
    }
  }

  // normalize (should already sum ~1)
  const sum = pUnder + pOver + pPush;
  return { pOver: pOver / sum, pUnder: pUnder / sum, pPush: pPush / sum };
}

export function probTeamOverAsian(dist: number[], line: number) {
  return probOverAsian(dist, line);
}

export function oddsFromProb(p: number, margin = 1.06) {
  return clamp((1 / p) * margin, 1.01, 100);
}

export function normalize2way(pA: number, pB: number) {
  const s = pA + pB;
  return { pA: pA / s, pB: pB / s };
}

export function normalize3way(p1: number, px: number, p2: number) {
  const s = p1 + px + p2;
  return { p1: p1 / s, px: px / s, p2: p2 / s };
}