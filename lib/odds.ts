// lib/odds.ts
export type Odds1X2 = { "1": number; X: number; "2": number };

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const round2 = (n: number) => Number(n.toFixed(2));

function factorial(k: number) {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return f;
}

function poissonPmf(k: number, lambda: number) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

function normalize3(a: number, b: number, c: number) {
  const s = a + b + c;
  if (s <= 0) return [1 / 3, 1 / 3, 1 / 3] as const;
  return [a / s, b / s, c / s] as const;
}

export type StandingTeamRow = {
  teamId: number;
  position: number;
  playedGames: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
};

export type StandingContext = {
  tableSize: number;
  byTeamId: Map<number, StandingTeamRow>;
};

const FALLBACK: Odds1X2 = { "1": 1.9, X: 3.6, "2": 4.1 };

/**
 * Mocniejsze kursy 1X2 na bazie tabeli:
 * - wyliczamy "rating" drużyn z points/game + (GF-GA)/game + pozycja
 * - przekładamy na lambdy bramek (Poisson)
 * - liczymy P(1/X/2) z macierzy wyników 0..MAXG
 * - dodajemy home advantage + kontrolę remisu
 * - nakładamy marżę
 */
export function oddsFromStandingsPoisson(
  homeId: number | null,
  awayId: number | null,
  ctx: StandingContext | null,
  opts?: {
    maxGoals?: number;
    homeAdv?: number; // 1.00..1.20
    margin?: number;  // 1.03..1.10
    drawBoost?: number; // 0.9..1.2
  }
): Odds1X2 {
  if (!homeId || !awayId || !ctx) return FALLBACK;

  const home = ctx.byTeamId.get(homeId);
  const away = ctx.byTeamId.get(awayId);
  if (!home || !away) return FALLBACK;

  const maxGoals = opts?.maxGoals ?? 7;
  const margin = clamp(opts?.margin ?? 1.06, 1.0, 1.2);
  const homeAdv = clamp(opts?.homeAdv ?? 1.10, 1.0, 1.25);
  const drawBoost = clamp(opts?.drawBoost ?? 1.05, 0.8, 1.3);

  // zabezpieczenie
  const ph = Math.max(1, home.playedGames || 1);
  const pa = Math.max(1, away.playedGames || 1);

  // metryki per mecz
  const homePPG = home.points / ph;
  const awayPPG = away.points / pa;

  const homeGFpg = home.goalsFor / ph;
  const homeGApg = home.goalsAgainst / ph;

  const awayGFpg = away.goalsFor / pa;
  const awayGApg = away.goalsAgainst / pa;

  const size = Math.max(2, ctx.tableSize);

  // pozycja -> [0..1] (lider ~1)
  const posStrength = (pos: number) => (size - pos) / (size - 1);

  // rating łączony (ważone): punkty, różnica bramek, pozycja
  // zakresy mniej więcej stabilne między ligami:
  const homeRating =
    0.55 * clamp(homePPG / 3, 0, 1) +
    0.25 * clamp((homeGFpg - homeGApg + 2) / 4, 0, 1) +
    0.20 * clamp(posStrength(home.position), 0, 1);

  const awayRating =
    0.55 * clamp(awayPPG / 3, 0, 1) +
    0.25 * clamp((awayGFpg - awayGApg + 2) / 4, 0, 1) +
    0.20 * clamp(posStrength(away.position), 0, 1);

  // różnica sił [-1..1]
  const diff = clamp(homeRating - awayRating, -1, 1);

  // bazowe lambdy bramek:
  // - atak gospodarzy ~ ich GFpg + słabość obrony rywala (GApg)
  // - analogicznie dla gości
  // - domyślny poziom bramek w piłce ~ 2.4-2.8 na mecz (na ligę)
  const baseHomeAttack = 0.60 * homeGFpg + 0.40 * awayGApg;
  const baseAwayAttack = 0.60 * awayGFpg + 0.40 * homeGApg;

  // korekty z rating diff
  let lambdaHome = (0.85 + 0.75 * baseHomeAttack) * (1 + 0.30 * diff) * homeAdv;
  let lambdaAway = (0.75 + 0.70 * baseAwayAttack) * (1 - 0.25 * diff);

  // clamp lambd
  lambdaHome = clamp(lambdaHome, 0.25, 3.8);
  lambdaAway = clamp(lambdaAway, 0.20, 3.4);

  // macierz wyników -> P(1/X/2)
  let pH = 0, pD = 0, pA = 0;

  for (let hg = 0; hg <= maxGoals; hg++) {
    const pHG = poissonPmf(hg, lambdaHome);
    for (let ag = 0; ag <= maxGoals; ag++) {
      const p = pHG * poissonPmf(ag, lambdaAway);
      if (hg > ag) pH += p;
      else if (hg === ag) pD += p;
      else pA += p;
    }
  }

  // delikatne “doładowanie” remisu (Poisson bywa zaniża remis w niektórych ligach)
  pD *= drawBoost;

  // normalize
  const [nH, nD, nA] = normalize3(pH, pD, pA);

  // marża (overround) – mnożymy prawdopodobieństwa
  const mH = clamp(nH * margin, 1e-6, 1 - 1e-6);
  const mD = clamp(nD * margin, 1e-6, 1 - 1e-6);
  const mA = clamp(nA * margin, 1e-6, 1 - 1e-6);

  // odds
  const o1 = clamp(1 / mH, 1.12, 25);
  const oX = clamp(1 / mD, 1.12, 25);
  const o2 = clamp(1 / mA, 1.12, 25);

  return { "1": round2(o1), X: round2(oX), "2": round2(o2) };
}