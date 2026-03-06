// lib/odds/markets.ts
import {
  oddsFromProb,
  probOverAsian,
  probs1X2FromMatrix,
  round2,
  scoreMatrix,
  teamGoalsDist,
  totalGoalsDist,
  clamp,
} from "./poisson";

export type MarketOption = { key: string; label: string; odd: number };
export type MarketGroup = { key: string; title: string; markets: { key: string; title: string; options: MarketOption[] }[] };

const MARGIN_3WAY = 1.07;
const MARGIN_2WAY = 1.06;

function formatLine(line: number) {
  // 2 -> "2.0", 2.5 -> "2.5"
  return Number.isInteger(line) ? `${line.toFixed(1)}` : `${line}`;
}

export function buildMarkets(params: { lambdaHome: number; lambdaAway: number }) {
  const { lambdaHome, lambdaAway } = params;

  const maxGoals = 6;

  // FT
  const matFT = scoreMatrix(lambdaHome, lambdaAway, maxGoals);
  const pFT = probs1X2FromMatrix(matFT);

  const distTotalFT = totalGoalsDist(matFT);
  const distHomeFT = teamGoalsDist(lambdaHome, maxGoals);
  const distAwayFT = teamGoalsDist(lambdaAway, maxGoals);

  const groupMain: MarketGroup = {
    key: "main",
    title: "Główne",
    markets: [
      {
        key: "ft_1x2",
        title: "1X2 (mecz)",
        options: [
          { key: "1", label: "1", odd: round2(oddsFromProb(pFT.p1, MARGIN_3WAY)) },
          { key: "X", label: "X", odd: round2(oddsFromProb(pFT.px, MARGIN_3WAY)) },
          { key: "2", label: "2", odd: round2(oddsFromProb(pFT.p2, MARGIN_3WAY)) },
        ],
      },
    ],
  };

  // Totals (Asian)
  const totalLines = [2.0, 2.5, 3.0, 3.5];
  const totalsMarkets = totalLines.map((line) => {
    const pr = probOverAsian(distTotalFT, line);
    // 2-way odds: use only over/under mass (ignore push)
    const overUnder = (1 - pr.pPush);
    const pOver = overUnder > 0 ? pr.pOver / overUnder : 0.5;
    const pUnder = overUnder > 0 ? pr.pUnder / overUnder : 0.5;

    return {
      key: `ft_total_${formatLine(line)}`,
      title: `Gole w meczu (Asian) ${formatLine(line)}`,
      options: [
        { key: "over", label: `Over ${formatLine(line)}`, odd: round2(oddsFromProb(clamp(pOver, 0.01, 0.99), MARGIN_2WAY)) },
        { key: "under", label: `Under ${formatLine(line)}`, odd: round2(oddsFromProb(clamp(pUnder, 0.01, 0.99), MARGIN_2WAY)) },
      ],
    };
  });

  const groupGoals: MarketGroup = {
    key: "goals",
    title: "Gole",
    markets: [
      // classic 2.5
      (() => {
        const pr = probOverAsian(distTotalFT, 2.5);
        return {
          key: "ft_ou_2_5",
          title: "Over/Under 2.5",
          options: [
            { key: "over", label: "Over 2.5", odd: round2(oddsFromProb(pr.pOver, MARGIN_2WAY)) },
            { key: "under", label: "Under 2.5", odd: round2(oddsFromProb(pr.pUnder, MARGIN_2WAY)) },
          ],
        };
      })(),
      ...totalsMarkets,
      // exact total (0-5, 6+)
      (() => {
        const opts: MarketOption[] = [];
        for (let g = 0; g <= 5; g++) {
          const p = distTotalFT[g] ?? 0;
          opts.push({ key: String(g), label: String(g), odd: round2(oddsFromProb(clamp(p, 0.0001, 0.99), 1.10)) });
        }
        const p6p = distTotalFT.slice(6).reduce((a, b) => a + b, 0);
        opts.push({ key: "6+", label: "6+", odd: round2(oddsFromProb(clamp(p6p, 0.0001, 0.99), 1.10)) });
        return { key: "ft_total_exact", title: "Dokładna liczba goli (mecz)", options: opts };
      })(),
    ],
  };

  // Team totals (Asian)
  const teamLines = [0.5, 1.0, 1.5, 2.0, 2.5];

  const teamMarket = (side: "home" | "away") => {
    const dist = side === "home" ? distHomeFT : distAwayFT;
    const label = side === "home" ? "Drużyna 1" : "Drużyna 2";

    return teamLines.map((line) => {
      const pr = probOverAsian(dist, line);
      const overUnder = (1 - pr.pPush);
      const pOver = overUnder > 0 ? pr.pOver / overUnder : 0.5;
      const pUnder = overUnder > 0 ? pr.pUnder / overUnder : 0.5;

      return {
        key: `ft_${side}_tg_${formatLine(line)}`,
        title: `${label} gole (Asian) ${formatLine(line)}`,
        options: [
          { key: "over", label: `${label} Over ${formatLine(line)}`, odd: round2(oddsFromProb(clamp(pOver, 0.01, 0.99), MARGIN_2WAY)) },
          { key: "under", label: `${label} Under ${formatLine(line)}`, odd: round2(oddsFromProb(clamp(pUnder, 0.01, 0.99), MARGIN_2WAY)) },
        ],
      };
    });
  };

  const groupTeamGoals: MarketGroup = {
    key: "team_goals",
    title: "Gole drużyn",
    markets: [...teamMarket("home"), ...teamMarket("away")],
  };

  return [groupMain, groupGoals, groupTeamGoals];
}

export function buildHalfMarkets(params: { lambdaHome: number; lambdaAway: number; prefix: "ht" | "sh" }) {
  const { lambdaHome, lambdaAway, prefix } = params;

  const maxGoals = 6;
  const mat = scoreMatrix(lambdaHome, lambdaAway, maxGoals);
  const p = probs1X2FromMatrix(mat);
  const distTotal = totalGoalsDist(mat);

  const titlePrefix = prefix === "ht" ? "1. połowa" : "2. połowa";

  const group: MarketGroup = {
    key: prefix,
    title: titlePrefix,
    markets: [
      {
        key: `${prefix}_1x2`,
        title: `1X2 (${titlePrefix})`,
        options: [
          { key: "1", label: "1", odd: round2(oddsFromProb(p.p1, MARGIN_3WAY)) },
          { key: "X", label: "X", odd: round2(oddsFromProb(p.px, MARGIN_3WAY)) },
          { key: "2", label: "2", odd: round2(oddsFromProb(p.p2, MARGIN_3WAY)) },
        ],
      },
      ...[0.5, 1.0, 1.5, 2.0].map((line) => {
        const pr = probOverAsian(distTotal, line);
        const overUnder = (1 - pr.pPush);
        const pOver = overUnder > 0 ? pr.pOver / overUnder : 0.5;
        const pUnder = overUnder > 0 ? pr.pUnder / overUnder : 0.5;

        return {
          key: `${prefix}_ou_${formatLine(line)}`,
          title: `Gole (${titlePrefix}) Asian ${formatLine(line)}`,
          options: [
            { key: "over", label: `Over ${formatLine(line)}`, odd: round2(oddsFromProb(clamp(pOver, 0.01, 0.99), MARGIN_2WAY)) },
            { key: "under", label: `Under ${formatLine(line)}`, odd: round2(oddsFromProb(clamp(pUnder, 0.01, 0.99), MARGIN_2WAY)) },
          ],
        };
      }),
    ],
  };

  return group;
}