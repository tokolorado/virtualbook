export function computeLambdasMVP(): { lambdaHome: number; lambdaAway: number } {
  const baseGoals = 2.6;
  const homeAdv = 1.10;

  // MVP: bez ratingów drużyn
  const lambdaHome = (baseGoals * homeAdv) / (1 + homeAdv); // ~1.36
  const lambdaAway = baseGoals / (1 + homeAdv);             // ~1.24

  return { lambdaHome, lambdaAway };
}