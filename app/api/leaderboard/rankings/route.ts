import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LeaderboardRow = {
  id: string;
  username: string | null;
  balance_vb: number | string | null;
  bets_count: number | string | null;
  active_bets: number | string | null;
  won_bets: number | string | null;
  lost_bets: number | string | null;
  void_bets: number | string | null;
  profit: number | string | null;
  roi: number | string | null;
  winrate: number | string | null;
};

type BetRow = {
  id: string;
  user_id: string;
  stake: number | string | null;
  total_odds: number | string | null;
  payout: number | string | null;
  status: string | null;
  settled: boolean | null;
  created_at: string | null;
};

type UserExtraMetrics = {
  weekly_profit: number;
  weekly_won_bets: number;
  best_win_streak: number;
  current_win_streak: number;
  underdog_wins: number;
  underdog_profit: number;
  winning_bets: number;
};

const MAX_BETS_FOR_RANKING = 10_000;
const UNDERDOG_TOTAL_ODDS = 2.5;

function toNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyMetrics(): UserExtraMetrics {
  return {
    weekly_profit: 0,
    weekly_won_bets: 0,
    best_win_streak: 0,
    current_win_streak: 0,
    underdog_wins: 0,
    underdog_profit: 0,
    winning_bets: 0,
  };
}

function betNetResult(bet: BetRow) {
  const status = String(bet.status ?? "").toLowerCase();
  const stake = toNumber(bet.stake);
  const payout = bet.payout === null ? 0 : toNumber(bet.payout);

  if (status === "won") return payout - stake;
  if (status === "lost") return -stake;
  if (status === "void") return 0;
  return 0;
}

function computeMetrics(bets: BetRow[], weekCutoffMs: number): UserExtraMetrics {
  const metrics = emptyMetrics();
  let tempWinStreak = 0;

  const settledBets = bets
    .filter((bet) => ["won", "lost"].includes(String(bet.status ?? "").toLowerCase()))
    .sort((a, b) => {
      const aTime = Date.parse(a.created_at ?? "");
      const bTime = Date.parse(b.created_at ?? "");
      return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
    });

  for (const bet of settledBets) {
    const status = String(bet.status ?? "").toLowerCase();

    if (status === "won") {
      tempWinStreak += 1;
      metrics.best_win_streak = Math.max(metrics.best_win_streak, tempWinStreak);
    } else if (status === "lost") {
      tempWinStreak = 0;
    }
  }

  for (let index = settledBets.length - 1; index >= 0; index -= 1) {
    const status = String(settledBets[index]?.status ?? "").toLowerCase();
    if (status !== "won") break;
    metrics.current_win_streak += 1;
  }

  for (const bet of bets) {
    const status = String(bet.status ?? "").toLowerCase();
    const createdMs = Date.parse(bet.created_at ?? "");
    const net = betNetResult(bet);

    if (status === "won") {
      metrics.winning_bets += 1;
    }

    if (Number.isFinite(createdMs) && createdMs >= weekCutoffMs) {
      metrics.weekly_profit += net;
      if (status === "won") metrics.weekly_won_bets += 1;
    }

    if (status === "won" && toNumber(bet.total_odds) >= UNDERDOG_TOTAL_ODDS) {
      metrics.underdog_wins += 1;
      metrics.underdog_profit += net;
    }
  }

  return {
    ...metrics,
    weekly_profit: Number(metrics.weekly_profit.toFixed(2)),
    underdog_profit: Number(metrics.underdog_profit.toFixed(2)),
  };
}

export async function GET() {
  try {
    const supabase = supabaseAdmin();
    const weekCutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const { data: rows, error: rowsError } = await supabase
      .from("leaderboard_global")
      .select(
        "id,username,balance_vb,bets_count,active_bets,won_bets,lost_bets,void_bets,profit,roi,winrate"
      );

    if (rowsError) {
      return NextResponse.json(
        { ok: false, error: rowsError.message, rows: [] },
        { status: 500 }
      );
    }

    const { data: betRows, error: betsError } = await supabase
      .from("bets")
      .select("id,user_id,stake,total_odds,payout,status,settled,created_at")
      .order("created_at", { ascending: true })
      .limit(MAX_BETS_FOR_RANKING);

    if (betsError) {
      return NextResponse.json(
        { ok: false, error: betsError.message, rows: [] },
        { status: 500 }
      );
    }

    const betsByUser = new Map<string, BetRow[]>();

    for (const bet of (betRows ?? []) as BetRow[]) {
      const userId = String(bet.user_id ?? "");
      if (!userId) continue;
      const userBets = betsByUser.get(userId) ?? [];
      userBets.push(bet);
      betsByUser.set(userId, userBets);
    }

    const normalizedRows = ((rows ?? []) as LeaderboardRow[]).map((row) => {
      const id = String(row.id);
      const metrics = computeMetrics(betsByUser.get(id) ?? [], weekCutoffMs);

      return {
        id,
        username: row.username,
        balance_vb: toNumber(row.balance_vb),
        bets_count: toNumber(row.bets_count),
        active_bets: toNumber(row.active_bets),
        won_bets: toNumber(row.won_bets),
        lost_bets: toNumber(row.lost_bets),
        void_bets: toNumber(row.void_bets),
        profit: toNumber(row.profit),
        roi: toNumber(row.roi),
        winrate: toNumber(row.winrate),
        ...metrics,
      };
    });

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      underdogTotalOdds: UNDERDOG_TOTAL_ODDS,
      maxBetsScanned: MAX_BETS_FOR_RANKING,
      rows: normalizedRows,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Server error",
        rows: [],
      },
      { status: 500 }
    );
  }
}
