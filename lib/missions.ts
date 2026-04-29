export type MissionPeriod = "daily" | "weekly";

export type MissionDefinition = {
  id: string;
  title: string;
  description: string;
  period: MissionPeriod;
  target: number;
  reward: number;
};

export type MissionBet = {
  id: string;
  status: string | null;
  total_odds: number | string | null;
  created_at: string | null;
};

export type MissionBetItem = {
  bet_id: string;
  odds: number | string | null;
};

export type MissionClaim = {
  mission_id: string;
  period_key: string;
};

export type EvaluatedMission = MissionDefinition & {
  periodKey: string;
  progress: number;
  completed: boolean;
  claimed: boolean;
  claimable: boolean;
};

export const MISSION_DEFINITIONS: MissionDefinition[] = [
  {
    id: "daily_place_3_bets",
    title: "Dzienny rytm",
    description: "Postaw 3 kupony dzisiaj.",
    period: "daily",
    target: 3,
    reward: 50,
  },
  {
    id: "daily_win_odds_2",
    title: "Pewna reka",
    description: "Traf dzisiaj kupon z kursem lacznym 2.00+.",
    period: "daily",
    target: 1,
    reward: 80,
  },
  {
    id: "daily_underdog_pick",
    title: "Underdog hunter",
    description: "Zagraj dzisiaj typ z kursem 3.00+.",
    period: "daily",
    target: 1,
    reward: 60,
  },
  {
    id: "weekly_place_10_bets",
    title: "Tydzien gracza",
    description: "Postaw 10 kuponow w tym tygodniu.",
    period: "weekly",
    target: 10,
    reward: 150,
  },
  {
    id: "weekly_win_5_bets",
    title: "Forma tygodnia",
    description: "Traf 5 kuponow w tym tygodniu.",
    period: "weekly",
    target: 5,
    reward: 200,
  },
];

function toNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcIsoWeek(date: Date) {
  const day = startOfUtcDay(date);
  const utcDay = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() - utcDay + 1);
  return day;
}

function periodKey(period: MissionPeriod, date: Date) {
  if (period === "daily") {
    return startOfUtcDay(date).toISOString().slice(0, 10);
  }

  const weekStart = startOfUtcIsoWeek(date);
  return weekStart.toISOString().slice(0, 10);
}

export function missionWindow(now = new Date()) {
  const dayStart = startOfUtcDay(now);
  const weekStart = startOfUtcIsoWeek(now);

  return {
    dayStartIso: dayStart.toISOString(),
    weekStartIso: weekStart.toISOString(),
    dailyKey: periodKey("daily", now),
    weeklyKey: periodKey("weekly", now),
  };
}

function isAtOrAfter(value: string | null, iso: string) {
  if (!value) return false;
  return Date.parse(value) >= Date.parse(iso);
}

export function evaluateMissions(params: {
  bets: MissionBet[];
  items: MissionBetItem[];
  claims: MissionClaim[];
  now?: Date;
}): EvaluatedMission[] {
  const now = params.now ?? new Date();
  const window = missionWindow(now);
  const dailyBets = params.bets.filter((bet) =>
    isAtOrAfter(bet.created_at, window.dayStartIso)
  );
  const weeklyBets = params.bets.filter((bet) =>
    isAtOrAfter(bet.created_at, window.weekStartIso)
  );

  const dailyBetIds = new Set(dailyBets.map((bet) => bet.id));
  const dailyItems = params.items.filter((item) => dailyBetIds.has(item.bet_id));

  const progressByMission: Record<string, number> = {
    daily_place_3_bets: dailyBets.length,
    daily_win_odds_2: dailyBets.some(
      (bet) =>
        String(bet.status ?? "").toLowerCase() === "won" &&
        toNumber(bet.total_odds) >= 2
    )
      ? 1
      : 0,
    daily_underdog_pick: dailyItems.some((item) => toNumber(item.odds) >= 3)
      ? 1
      : 0,
    weekly_place_10_bets: weeklyBets.length,
    weekly_win_5_bets: weeklyBets.filter(
      (bet) => String(bet.status ?? "").toLowerCase() === "won"
    ).length,
  };

  const claimed = new Set(
    params.claims.map((claim) => `${claim.mission_id}:${claim.period_key}`)
  );

  return MISSION_DEFINITIONS.map((definition) => {
    const key = periodKey(definition.period, now);
    const progress = Math.min(progressByMission[definition.id] ?? 0, definition.target);
    const completed = progress >= definition.target;
    const isClaimed = claimed.has(`${definition.id}:${key}`);

    return {
      ...definition,
      periodKey: key,
      progress,
      completed,
      claimed: isClaimed,
      claimable: completed && !isClaimed,
    };
  });
}
