export type TrophyTone = "neutral" | "green" | "red" | "yellow" | "blue" | "purple";

export type PlayerReputationInput = {
  betsCount: number;
  wonBets: number;
  lostBets: number;
  voidBets: number;
  profit: number;
  roi: number;
  winrate: number;
  balance?: number;
  currentWinStreak?: number;
  bestWinStreak?: number;
};

export type PlayerTrophy = {
  id: string;
  title: string;
  description: string;
  tone: TrophyTone;
  earned: boolean;
  progress: number;
  target: number;
};

export type PlayerReputation = {
  score: number;
  title: string;
  subtitle: string;
  tone: TrophyTone;
  trophies: PlayerTrophy[];
  earnedTrophies: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function trophy(
  id: string,
  title: string,
  description: string,
  tone: TrophyTone,
  progress: number,
  target: number
): PlayerTrophy {
  const safeProgress = Math.max(0, finiteNumber(progress));
  const safeTarget = Math.max(1, finiteNumber(target));

  return {
    id,
    title,
    description,
    tone,
    earned: safeProgress >= safeTarget,
    progress: Math.min(safeProgress, safeTarget),
    target: safeTarget,
  };
}

function reputationTitle(score: number, input: PlayerReputationInput) {
  if (input.bestWinStreak && input.bestWinStreak >= 5) {
    return {
      title: "Spec od serii",
      subtitle: "Gracz, który potrafi długo utrzymać formę.",
      tone: "purple" as const,
    };
  }

  if (input.roi >= 25 && input.betsCount >= 10) {
    return {
      title: "ROI Master",
      subtitle: "Bardzo mocny zwrot przy sensownej próbie kuponów.",
      tone: "green" as const,
    };
  }

  if (score >= 80) {
    return {
      title: "Elita VirtualBook",
      subtitle: "Wysoka skuteczność, dodatni bilans i regularność.",
      tone: "green" as const,
    };
  }

  if (score >= 60) {
    return {
      title: "Solidny typer",
      subtitle: "Profil z dobrym bilansem i coraz większą historią gry.",
      tone: "blue" as const,
    };
  }

  if (score >= 35) {
    return {
      title: "Aktywny gracz",
      subtitle: "Jest już historia, są pierwsze wyniki i miejsce na progres.",
      tone: "yellow" as const,
    };
  }

  return {
    title: "Nowy gracz",
    subtitle: "Profil dopiero zbiera pierwsze kupony i statystyki.",
    tone: "neutral" as const,
  };
}

export function buildPlayerReputation(
  input: PlayerReputationInput
): PlayerReputation {
  const betsCount = finiteNumber(input.betsCount);
  const wonBets = finiteNumber(input.wonBets);
  const lostBets = finiteNumber(input.lostBets);
  const voidBets = finiteNumber(input.voidBets);
  const settledBets = wonBets + lostBets + voidBets;
  const profit = finiteNumber(input.profit);
  const roi = finiteNumber(input.roi);
  const winrate = finiteNumber(input.winrate);
  const bestWinStreak = finiteNumber(input.bestWinStreak);
  const currentWinStreak = finiteNumber(input.currentWinStreak);

  const activityScore = clamp(betsCount * 2, 0, 24);
  const settledScore = clamp(settledBets * 1.4, 0, 16);
  const profitScore = clamp(profit / 25, -12, 18);
  const roiScore = clamp(roi / 2, -10, 18);
  const winrateScore = betsCount >= 5 ? clamp((winrate - 40) / 1.6, -8, 16) : 0;
  const streakScore = clamp(bestWinStreak * 3 + currentWinStreak, 0, 12);
  const rawScore =
    30 + activityScore + settledScore + profitScore + roiScore + winrateScore + streakScore;
  const score = Math.round(clamp(rawScore, 0, 100));
  const title = reputationTitle(score, {
    ...input,
    betsCount,
    bestWinStreak,
    roi,
  });

  const trophies = [
    trophy(
      "first-bet",
      "Pierwszy kupon",
      "Postawiony pierwszy kupon w VirtualBook.",
      "blue",
      betsCount,
      1
    ),
    trophy(
      "first-win",
      "Pierwsza wygrana",
      "Pierwszy rozliczony kupon na plus.",
      "green",
      wonBets,
      1
    ),
    trophy(
      "regular",
      "Regularny gracz",
      "Minimum 25 postawionych kuponów.",
      "blue",
      betsCount,
      25
    ),
    trophy(
      "roi-positive",
      "Dodatni ROI",
      "ROI powyżej zera przy minimum 5 kuponach.",
      "green",
      betsCount >= 5 && roi > 0 ? 1 : 0,
      1
    ),
    trophy(
      "hot-streak",
      "Gorąca seria",
      "Najlepsza seria minimum 3 wygranych kuponów.",
      "purple",
      bestWinStreak,
      3
    ),
    trophy(
      "sniper",
      "Snajper",
      "Winrate minimum 60% przy minimum 10 kuponach.",
      "yellow",
      betsCount >= 10 && winrate >= 60 ? 1 : 0,
      1
    ),
    trophy(
      "profit-hunter",
      "Profit hunter",
      "Profit minimum +500 VB.",
      "green",
      profit,
      500
    ),
    trophy(
      "veteran",
      "Weteran",
      "Minimum 100 postawionych kuponów.",
      "purple",
      betsCount,
      100
    ),
  ];

  return {
    score,
    title: title.title,
    subtitle: title.subtitle,
    tone: title.tone,
    trophies,
    earnedTrophies: trophies.filter((item) => item.earned).length,
  };
}
