// lib/odds/model.ts
import { clamp } from "./poisson";

export type StandingRow = {
  teamId: number;
  position: number;
  playedGames: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
};

export function leagueAverages(rows: StandingRow[]) {
  const playedSum = rows.reduce((acc, r) => acc + (r.playedGames || 0), 0);
  const goalsForSum = rows.reduce((acc, r) => acc + (r.goalsFor || 0), 0);

  // matches played in league table ≈ sum(playedGames)/2
  const matches = Math.max(1, playedSum / 2);
  const avgGoalsPerMatch = goalsForSum / matches;

  // split home/away share (typical football)
  const avgHome = avgGoalsPerMatch * 0.55;
  const avgAway = avgGoalsPerMatch * 0.45;

  // per-team baseline per match (each match has 2 teams)
  const avgPerTeam = avgGoalsPerMatch / 2;

  return { avgGoalsPerMatch, avgHome, avgAway, avgPerTeam };
}

export function calcLambdas(params: {
  home: StandingRow | null;
  away: StandingRow | null;
  leagueRows: StandingRow[];
}) {
  const { home, away, leagueRows } = params;

  const { avgPerTeam } = leagueAverages(leagueRows);

  // fallback if missing
  if (!home || !away) {
    const base = clamp(avgPerTeam || 1.2, 0.6, 2.2);
    return { lambdaHome: base * 1.12, lambdaAway: base * 0.98 };
  }

  const hPG = Math.max(1, home.playedGames);
  const aPG = Math.max(1, away.playedGames);

  const homeAtk = clamp((home.goalsFor / hPG) / avgPerTeam, 0.55, 1.80);
  const homeDefWeak = clamp((home.goalsAgainst / hPG) / avgPerTeam, 0.55, 1.80);

  const awayAtk = clamp((away.goalsFor / aPG) / avgPerTeam, 0.55, 1.80);
  const awayDefWeak = clamp((away.goalsAgainst / aPG) / avgPerTeam, 0.55, 1.80);

  const homeAdv = 1.12; // darmowa, sensowna przewaga domu

  const lambdaHome = clamp(avgPerTeam * homeAtk * awayDefWeak * homeAdv, 0.20, 4.50);
  const lambdaAway = clamp(avgPerTeam * awayAtk * homeDefWeak * 0.98, 0.20, 4.50);

  return { lambdaHome, lambdaAway };
}

export function splitHalfLambdas(lambdaHome: number, lambdaAway: number) {
  // typowy udział goli: ~45% 1H / 55% 2H
  const first = 0.45;
  const second = 0.55;

  return {
    ht: { lambdaHome: lambdaHome * first, lambdaAway: lambdaAway * first },
    sh: { lambdaHome: lambdaHome * second, lambdaAway: lambdaAway * second },
  };
}