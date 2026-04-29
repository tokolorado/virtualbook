// app/(main)/leaderboard/page.tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  weekly_profit?: number | string | null;
  weekly_won_bets?: number | string | null;
  best_win_streak?: number | string | null;
  current_win_streak?: number | string | null;
  underdog_wins?: number | string | null;
  underdog_profit?: number | string | null;
  winning_bets?: number | string | null;
};

type SortKey =
  | "profit"
  | "balance"
  | "roi"
  | "winrate"
  | "weekly"
  | "streak"
  | "underdog"
  | "wins";

type RankingsResponse = {
  ok: boolean;
  error?: string;
  rows?: LeaderboardRow[];
  generatedAt?: string;
};

const MIN_BETS_FOR_RATE_RANKING = 5;

const USER_PROFILE_PATH = (username: string) =>
  `/users/${encodeURIComponent(username)}`;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function toNum(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt(v: unknown) {
  return toNum(v).toLocaleString("pl-PL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtInt(v: unknown) {
  return toNum(v).toLocaleString("pl-PL", {
    maximumFractionDigits: 0,
  });
}

function fmtPct(v: unknown) {
  return `${fmt(v)}%`;
}

function rankLabel(index: number) {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return String(index + 1);
}

function sortLabel(sortBy: SortKey) {
  if (sortBy === "profit") return "Profit";
  if (sortBy === "balance") return "Saldo";
  if (sortBy === "roi") return "ROI";
  if (sortBy === "winrate") return "Winrate";
  if (sortBy === "weekly") return "Gracz tygodnia";
  if (sortBy === "streak") return "Seria wygranych";
  if (sortBy === "underdog") return "Underdog hunter";
  return "Trafione kupony";
}

function medalBg(index: number) {
  if (index === 0) {
    return "border-yellow-500/30 bg-[radial-gradient(circle_at_top_left,rgba(234,179,8,0.24),transparent_36%),linear-gradient(180deg,rgba(23,23,23,0.94),rgba(5,5,5,0.98))]";
  }

  if (index === 1) {
    return "border-slate-300/20 bg-[radial-gradient(circle_at_top_left,rgba(203,213,225,0.16),transparent_36%),linear-gradient(180deg,rgba(23,23,23,0.94),rgba(5,5,5,0.98))]";
  }

  if (index === 2) {
    return "border-orange-500/25 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.18),transparent_36%),linear-gradient(180deg,rgba(23,23,23,0.94),rgba(5,5,5,0.98))]";
  }

  return "border-neutral-800 bg-neutral-950/70";
}

function metricColor(v: number) {
  if (v > 0) return "text-green-400";
  if (v < 0) return "text-red-400";
  return "text-neutral-200";
}

function trendLabel(profit: number, roi: number, winrate: number) {
  if (profit > 0 && roi > 0 && winrate >= 55) return "HOT";
  if (profit > 0 || roi > 0) return "UP";
  if (profit < 0 && roi < 0) return "DOWN";
  return "NEUTRAL";
}

function trendClasses(label: string) {
  if (label === "HOT") {
    return "border-green-500/30 bg-green-500/10 text-green-300";
  }

  if (label === "UP") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  }

  if (label === "DOWN") {
    return "border-red-500/30 bg-red-500/10 text-red-300";
  }

  return "border-neutral-700 bg-neutral-900 text-neutral-300";
}

function SmallPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "green" | "red" | "yellow" | "blue";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold",
        tone === "neutral" &&
          "border-neutral-800 bg-neutral-950 text-neutral-300",
        tone === "green" && "border-green-500/30 bg-green-500/10 text-green-300",
        tone === "red" && "border-red-500/30 bg-red-500/10 text-red-300",
        tone === "yellow" &&
          "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
        tone === "blue" && "border-sky-500/30 bg-sky-500/10 text-sky-300"
      )}
    >
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "neutral" | "green" | "red" | "yellow" | "blue";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        tone === "neutral" && "border-neutral-800 bg-neutral-950/80",
        tone === "green" && "border-green-500/20 bg-green-500/10",
        tone === "red" && "border-red-500/20 bg-red-500/10",
        tone === "yellow" && "border-yellow-500/20 bg-yellow-500/10",
        tone === "blue" && "border-sky-500/20 bg-sky-500/10"
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </div>

      <div className="mt-2 text-2xl font-semibold leading-tight text-white">
        {value}
      </div>

      {hint ? <div className="mt-1 text-xs text-neutral-500">{hint}</div> : null}
    </div>
  );
}

function SurfaceCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-3xl border border-neutral-800 bg-neutral-950/70 shadow-[0_18px_80px_rgba(0,0,0,0.35)]",
        className
      )}
    >
      {children}
    </section>
  );
}

function Sparkline({
  value,
  positive,
}: {
  value: number;
  positive: boolean;
}) {
  const amp = Math.max(3, Math.min(10, Math.abs(value) / 35));

  const d = `
    M 4 18
    C 12 ${18 - amp}, 20 ${18 - amp}, 28 18
    C 36 ${18 + amp * 0.35}, 44 ${18 + amp * 0.35}, 52 18
    C 60 ${18 - amp * 0.75}, 68 ${18 - amp * 0.75}, 76 18
    C 84 ${18 + amp * 0.2}, 90 ${18 + amp * 0.2}, 96 18
  `;

  return (
    <svg viewBox="0 0 100 36" className="h-8 w-20 shrink-0" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke={positive ? "rgb(74 222 128)" : "rgb(248 113 113)"}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle
        cx="96"
        cy="18"
        r="2.5"
        fill={positive ? "rgb(74 222 128)" : "rgb(248 113 113)"}
      />
    </svg>
  );
}

function SortButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm font-semibold transition",
        active
          ? "border-white bg-white text-black"
          : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-900"
      )}
    >
      <span className="inline-flex items-center gap-2">
        <span>{label}</span>
        {active ? (
          <span className="rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-semibold">
            aktywne
          </span>
        ) : null}
      </span>
    </button>
  );
}

function HeaderLabel({
  label,
  active,
}: {
  label: string;
  active: boolean;
}) {
  return (
    <span className="inline-flex items-center justify-end gap-1">
      <span>{label}</span>
      {active ? <span className="text-neutral-300">↓</span> : null}
    </span>
  );
}

function PodiumCard({
  row,
  index,
  sortBy,
}: {
  row: LeaderboardRow;
  index: number;
  sortBy: SortKey;
}) {
  const username = row.username?.trim() || "gracz";
  const profit = toNum(row.profit);
  const roi = toNum(row.roi);
  const winrate = toNum(row.winrate);
  const balance = toNum(row.balance_vb);
  const betsCount = toNum(row.bets_count);
  const activeBets = toNum(row.active_bets);
  const weeklyProfit = toNum(row.weekly_profit);
  const bestWinStreak = toNum(row.best_win_streak);
  const underdogWins = toNum(row.underdog_wins);
  const winningBets = toNum(row.winning_bets ?? row.won_bets);
  const rateEligible = betsCount >= MIN_BETS_FOR_RATE_RANKING;
  const trend = trendLabel(profit, roi, winrate);

  let primaryMetric =
    sortBy === "profit"
      ? `${profit > 0 ? "+" : ""}${fmt(profit)} VB`
      : sortBy === "balance"
        ? `${fmt(balance)} VB`
        : sortBy === "roi"
          ? rateEligible
            ? fmtPct(roi)
            : "—"
          : rateEligible
            ? fmtPct(winrate)
            : "—";

  if (sortBy === "weekly") {
    primaryMetric = `${weeklyProfit > 0 ? "+" : ""}${fmt(weeklyProfit)} VB`;
  } else if (sortBy === "streak") {
    primaryMetric = `${fmtInt(bestWinStreak)} wygr. z rzędu`;
  } else if (sortBy === "underdog") {
    primaryMetric = `${fmtInt(underdogWins)} trafień`;
  } else if (sortBy === "wins") {
    primaryMetric = `${fmtInt(winningBets)} trafień`;
  }

  return (
    <div
      className={cn(
        "rounded-3xl border p-4 transition hover:border-neutral-600",
        medalBg(index)
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-2xl">{rankLabel(index)}</div>

          <Link
            href={USER_PROFILE_PATH(username)}
            className="mt-3 block break-words text-lg font-semibold text-white transition hover:text-sky-300"
          >
            {username}
          </Link>

          <div className="mt-2 text-xs leading-5 text-neutral-400">
            {rateEligible
              ? "pełne statystyki rankingowe"
              : `za mało kuponów do ROI/Winrate (${betsCount}/${MIN_BETS_FOR_RATE_RANKING})`}
          </div>
        </div>

        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
            trendClasses(trend)
          )}
        >
          {trend}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl border border-neutral-800 bg-black/20 p-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">
            Aktualna metryka
          </div>
          <div className="mt-1 font-semibold text-white">{primaryMetric}</div>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-black/20 p-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">
            Saldo
          </div>
          <div className="mt-1 font-semibold text-white">{fmt(balance)} VB</div>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-black/20 p-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">
            Profit
          </div>
          <div className={cn("mt-1 font-semibold", metricColor(profit))}>
            {profit > 0 ? "+" : ""}
            {fmt(profit)} VB
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-black/20 p-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">
            W grze
          </div>
          <div className="mt-1 font-semibold text-yellow-300">{activeBets}</div>
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5">
      <SurfaceCard className="overflow-hidden">
        <div className="p-5 sm:p-6">
          <div className="h-8 w-64 animate-pulse rounded bg-neutral-800" />
          <div className="mt-4 h-4 w-96 max-w-full animate-pulse rounded bg-neutral-800" />
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="h-20 animate-pulse rounded-2xl bg-neutral-800" />
            <div className="h-20 animate-pulse rounded-2xl bg-neutral-800" />
            <div className="h-20 animate-pulse rounded-2xl bg-neutral-800" />
            <div className="h-20 animate-pulse rounded-2xl bg-neutral-800" />
          </div>
        </div>
      </SurfaceCard>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-52 animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40" />
        <div className="h-52 animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40" />
        <div className="h-52 animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40" />
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("profit");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setLoadError(null);

    try {
      const response = await fetch("/api/leaderboard/rankings", {
        cache: "no-store",
      });
      const payload = (await response.json()) as RankingsResponse;
      const error = { message: payload.error ?? `HTTP ${response.status}` };
      const data = payload.rows ?? [];

      if (!response.ok || !payload.ok) {
        setRows([]);
        setLoadError(`Nie udało się pobrać rankingu: ${error.message}`);
        return;
      }

      setRows((data ?? []) as LeaderboardRow[]);
      setLastLoadedAt(payload.generatedAt ?? new Date().toISOString());
    } catch (error) {
      setRows([]);
      setLoadError(
        error instanceof Error
          ? error.message
          : "Nie udało się pobrać rankingu."
      );
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(false);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [load]);

  const sortedRows = useMemo(() => {
    const copy = [...rows];

    copy.sort((a, b) => {
      const aProfit = toNum(a.profit);
      const bProfit = toNum(b.profit);

      const aBalance = toNum(a.balance_vb);
      const bBalance = toNum(b.balance_vb);

      const aRoi = toNum(a.roi);
      const bRoi = toNum(b.roi);

      const aWinrate = toNum(a.winrate);
      const bWinrate = toNum(b.winrate);

      const aBets = toNum(a.bets_count);
      const bBets = toNum(b.bets_count);
      const aWeeklyProfit = toNum(a.weekly_profit);
      const bWeeklyProfit = toNum(b.weekly_profit);
      const aBestStreak = toNum(a.best_win_streak);
      const bBestStreak = toNum(b.best_win_streak);
      const aUnderdogWins = toNum(a.underdog_wins);
      const bUnderdogWins = toNum(b.underdog_wins);
      const aUnderdogProfit = toNum(a.underdog_profit);
      const bUnderdogProfit = toNum(b.underdog_profit);
      const aWinningBets = toNum(a.winning_bets ?? a.won_bets);
      const bWinningBets = toNum(b.winning_bets ?? b.won_bets);

      if (sortBy === "profit") {
        if (bProfit !== aProfit) return bProfit - aProfit;
        if (bBalance !== aBalance) return bBalance - aBalance;
        return (a.username ?? "").localeCompare(b.username ?? "");
      }

      if (sortBy === "balance") {
        if (bBalance !== aBalance) return bBalance - aBalance;
        if (bProfit !== aProfit) return bProfit - aProfit;
        return (a.username ?? "").localeCompare(b.username ?? "");
      }

      if (sortBy === "roi") {
        const aEligible = aBets >= MIN_BETS_FOR_RATE_RANKING;
        const bEligible = bBets >= MIN_BETS_FOR_RATE_RANKING;

        if (aEligible !== bEligible) return aEligible ? -1 : 1;
        if (aEligible && bEligible && bRoi !== aRoi) return bRoi - aRoi;
        if (bProfit !== aProfit) return bProfit - aProfit;
        return bBets - aBets;
      }

      if (sortBy === "weekly") {
        if (bWeeklyProfit !== aWeeklyProfit) return bWeeklyProfit - aWeeklyProfit;
        if (bWinningBets !== aWinningBets) return bWinningBets - aWinningBets;
        return bProfit - aProfit;
      }

      if (sortBy === "streak") {
        if (bBestStreak !== aBestStreak) return bBestStreak - aBestStreak;
        if (bWinningBets !== aWinningBets) return bWinningBets - aWinningBets;
        return bProfit - aProfit;
      }

      if (sortBy === "underdog") {
        if (bUnderdogWins !== aUnderdogWins) return bUnderdogWins - aUnderdogWins;
        if (bUnderdogProfit !== aUnderdogProfit) {
          return bUnderdogProfit - aUnderdogProfit;
        }
        return bProfit - aProfit;
      }

      if (sortBy === "wins") {
        if (bWinningBets !== aWinningBets) return bWinningBets - aWinningBets;
        return bProfit - aProfit;
      }

      const aEligible = aBets >= MIN_BETS_FOR_RATE_RANKING;
      const bEligible = bBets >= MIN_BETS_FOR_RATE_RANKING;

      if (aEligible !== bEligible) return aEligible ? -1 : 1;
      if (aEligible && bEligible && bWinrate !== aWinrate) {
        return bWinrate - aWinrate;
      }

      if (bProfit !== aProfit) return bProfit - aProfit;
      return bBets - aBets;
    });

    return copy;
  }, [rows, sortBy]);

  const podiumRows = sortedRows.slice(0, 3);

  const stats = useMemo(() => {
    const totalPlayers = rows.length;
    const activePlayers = rows.filter((row) => toNum(row.bets_count) > 0).length;
    const totalBets = rows.reduce((sum, row) => sum + toNum(row.bets_count), 0);
    const activeBets = rows.reduce((sum, row) => sum + toNum(row.active_bets), 0);

    const leader = sortedRows[0] ?? null;
    const leaderUsername = leader?.username?.trim() || null;

    const totalProfit = rows.reduce((sum, row) => sum + toNum(row.profit), 0);
    const profitablePlayers = rows.filter((row) => toNum(row.profit) > 0).length;

    return {
      totalPlayers,
      activePlayers,
      totalBets,
      activeBets,
      leader,
      leaderUsername,
      totalProfit,
      profitablePlayers,
    };
  }, [rows, sortedRows]);

  if (loading) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="w-full min-w-0 space-y-5 overflow-x-hidden">
      <SurfaceCard className="overflow-hidden">
        <div className="border-b border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.96),rgba(5,5,5,0.99))] p-5 sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                VirtualBook Football
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                Ranking globalny
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-400">
                Porównanie wszystkich graczy według profitu, salda, ROI i
                skuteczności kuponów. Ranking pokazuje aktualną formę oraz
                historię wyników wirtualnych zakładów.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <SmallPill tone="blue">Gracze: {stats.totalPlayers}</SmallPill>
                <SmallPill>Aktywni: {stats.activePlayers}</SmallPill>
                <SmallPill tone="yellow">W grze: {stats.activeBets}</SmallPill>
                <SmallPill tone="green">
                  Na plusie: {stats.profitablePlayers}
                </SmallPill>
                {lastLoadedAt ? (
                  <SmallPill>
                    Aktualizacja:{" "}
                    {new Date(lastLoadedAt).toLocaleTimeString("pl-PL", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </SmallPill>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[520px]">
              <StatCard
                label="Lider"
                value={stats.leaderUsername ?? "—"}
                hint={stats.leader ? `${sortLabel(sortBy)} ranking` : "Brak danych"}
                tone="blue"
              />

              <StatCard
                label="Kupony"
                value={fmtInt(stats.totalBets)}
                hint="Łączna liczba kuponów graczy"
              />

              <StatCard
                label="Profit łącznie"
                value={`${stats.totalProfit >= 0 ? "+" : ""}${fmt(
                  stats.totalProfit
                )} VB`}
                hint="Suma profitu z rankingu"
                tone={
                  stats.totalProfit > 0
                    ? "green"
                    : stats.totalProfit < 0
                      ? "red"
                      : "neutral"
                }
              />

              <StatCard
                label="Sortowanie"
                value={sortLabel(sortBy)}
                hint={`ROI/Winrate od ${MIN_BETS_FOR_RATE_RANKING} kuponów`}
                tone="neutral"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <div className="text-xs font-medium text-neutral-500">
              Aktualne sortowanie
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <SortButton
                active={sortBy === "profit"}
                label="Profit"
                onClick={() => setSortBy("profit")}
              />

              <SortButton
                active={sortBy === "balance"}
                label="Saldo"
                onClick={() => setSortBy("balance")}
              />

              <SortButton
                active={sortBy === "roi"}
                label="ROI"
                onClick={() => setSortBy("roi")}
              />

              <SortButton
                active={sortBy === "winrate"}
                label="Winrate"
                onClick={() => setSortBy("winrate")}
              />

              <SortButton
                active={sortBy === "weekly"}
                label="Gracz tygodnia"
                onClick={() => setSortBy("weekly")}
              />

              <SortButton
                active={sortBy === "streak"}
                label="Seria"
                onClick={() => setSortBy("streak")}
              />

              <SortButton
                active={sortBy === "underdog"}
                label="Underdog"
                onClick={() => setSortBy("underdog")}
              />

              <SortButton
                active={sortBy === "wins"}
                label="Trafione"
                onClick={() => setSortBy("wins")}
              />
            </div>
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                void load(true);
              }}
              disabled={refreshing}
              className={cn(
                "w-full rounded-2xl border px-4 py-3 text-sm font-semibold transition lg:w-auto",
                refreshing
                  ? "cursor-not-allowed border-neutral-800 bg-neutral-950 text-neutral-500"
                  : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900"
              )}
            >
              {refreshing ? "Odświeżam..." : "Odśwież ranking"}
            </button>
          </div>
        </div>

        {loadError ? (
          <div className="px-4 pb-5 sm:px-5">
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
              {loadError}
            </div>
          </div>
        ) : null}
      </SurfaceCard>

      {rows.length === 0 ? (
        <SurfaceCard className="p-6">
          <div className="text-lg font-semibold text-white">
            Brak danych rankingu
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
            Ranking pojawi się, gdy użytkownicy zaczną stawiać i rozliczać
            wirtualne kupony.
          </p>
        </SurfaceCard>
      ) : (
        <>
          {podiumRows.length > 0 ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-white">Top 3</h2>
                  <SmallPill>{podiumRows.length}</SmallPill>
                </div>

                <div className="text-xs text-neutral-500">
                  Podium aktualnego rankingu
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {podiumRows.map((row, index) => (
                  <PodiumCard
                    key={row.id}
                    row={row}
                    index={index}
                    sortBy={sortBy}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <SurfaceCard className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-neutral-800 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <div className="text-xl font-semibold text-white">
                  Pełna tabela
                </div>
                <div className="mt-1 text-sm text-neutral-400">
                  Ranking według:{" "}
                  <span className="font-semibold text-white">
                    {sortLabel(sortBy)}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <SmallPill>Graczy: {sortedRows.length}</SmallPill>
                <SmallPill tone="yellow">
                  W grze: {stats.activeBets}
                </SmallPill>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1320px] text-sm">
                <thead className="border-b border-neutral-800 text-neutral-400">
                  <tr>
                    <th className="w-14 px-4 py-4 text-left font-medium">#</th>
                    <th className="min-w-[260px] px-4 py-4 text-left font-medium">
                      Użytkownik
                    </th>
                    <th className="px-4 py-4 text-right font-medium">
                      <HeaderLabel label="Saldo" active={sortBy === "balance"} />
                    </th>
                    <th className="px-4 py-4 text-right font-medium">
                      <HeaderLabel label="Profit" active={sortBy === "profit"} />
                    </th>
                    <th className="px-4 py-4 text-right font-medium">
                      <HeaderLabel label="ROI" active={sortBy === "roi"} />
                    </th>
                    <th className="px-4 py-4 text-right font-medium">
                      <HeaderLabel
                        label="Winrate"
                        active={sortBy === "winrate"}
                      />
                    </th>
                    <th className="px-4 py-4 text-right font-medium">
                      <HeaderLabel
                        label="Tydzień"
                        active={sortBy === "weekly"}
                      />
                    </th>
                    <th className="px-4 py-4 text-right font-medium">
                      <HeaderLabel
                        label="Seria"
                        active={sortBy === "streak"}
                      />
                    </th>
                    <th className="px-4 py-4 text-right font-medium">
                      <HeaderLabel
                        label="Underdog"
                        active={sortBy === "underdog"}
                      />
                    </th>
                    <th className="px-4 py-4 text-right font-medium">
                      <HeaderLabel label="Trafione" active={sortBy === "wins"} />
                    </th>
                    <th className="px-4 py-4 text-right font-medium">Kupony</th>
                    <th className="px-4 py-4 text-right font-medium">W grze</th>
                    <th className="px-4 py-4 text-right font-medium">Won</th>
                    <th className="px-4 py-4 text-right font-medium">Lost</th>
                    <th className="px-4 py-4 text-right font-medium">Void</th>
                  </tr>
                </thead>

                <tbody>
                  {sortedRows.map((row, index) => {
                    const profit = toNum(row.profit);
                    const roi = toNum(row.roi);
                    const winrate = toNum(row.winrate);
                    const betsCount = toNum(row.bets_count);
                    const activeBets = toNum(row.active_bets);
                    const weeklyProfit = toNum(row.weekly_profit);
                    const bestWinStreak = toNum(row.best_win_streak);
                    const underdogWins = toNum(row.underdog_wins);
                    const underdogProfit = toNum(row.underdog_profit);
                    const winningBets = toNum(row.winning_bets ?? row.won_bets);
                    const rateEligible =
                      betsCount >= MIN_BETS_FOR_RATE_RANKING;
                    const username = row.username?.trim() || "gracz";
                    const trend = trendLabel(profit, roi, winrate);

                    return (
                      <tr
                        key={row.id}
                        className="border-b border-neutral-800/70 transition hover:bg-neutral-900/50"
                      >
                        <td className="px-4 py-5 text-base font-semibold text-neutral-300">
                          {rankLabel(index)}
                        </td>

                        <td className="px-4 py-5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <Link
                                href={USER_PROFILE_PATH(username)}
                                className="block truncate font-semibold text-white transition hover:text-sky-300"
                                title={username}
                              >
                                {username}
                              </Link>

                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                                    trendClasses(trend)
                                  )}
                                >
                                  {trend}
                                </span>

                                <span className="text-xs text-neutral-500">
                                  {rateEligible
                                    ? "pełne statystyki rankingowe"
                                    : `za mało kuponów do ROI/Winrate (${betsCount}/${MIN_BETS_FOR_RATE_RANKING})`}
                                </span>
                              </div>
                            </div>

                            <Sparkline value={profit} positive={profit >= 0} />
                          </div>
                        </td>

                        <td className="px-4 py-5 text-right text-neutral-200">
                          {fmt(row.balance_vb)} VB
                        </td>

                        <td
                          className={cn(
                            "px-4 py-5 text-right font-semibold",
                            metricColor(profit)
                          )}
                        >
                          {profit > 0 ? "+" : ""}
                          {fmt(profit)} VB
                        </td>

                        <td
                          className={cn(
                            "px-4 py-5 text-right",
                            !rateEligible ? "text-neutral-500" : metricColor(roi)
                          )}
                          title={
                            rateEligible
                              ? undefined
                              : `ROI liczone rankingowo od ${MIN_BETS_FOR_RATE_RANKING} kuponów`
                          }
                        >
                          {rateEligible ? fmtPct(roi) : "—"}
                        </td>

                        <td
                          className={cn(
                            "px-4 py-5 text-right",
                            !rateEligible ? "text-neutral-500" : "text-neutral-200"
                          )}
                          title={
                            rateEligible
                              ? undefined
                              : `Winrate liczony rankingowo od ${MIN_BETS_FOR_RATE_RANKING} kuponów`
                          }
                        >
                          {rateEligible ? fmtPct(winrate) : "—"}
                        </td>

                        <td
                          className={cn(
                            "px-4 py-5 text-right font-semibold",
                            metricColor(weeklyProfit)
                          )}
                        >
                          {weeklyProfit > 0 ? "+" : ""}
                          {fmt(weeklyProfit)} VB
                        </td>

                        <td className="px-4 py-5 text-right text-violet-300">
                          {fmtInt(bestWinStreak)}
                        </td>

                        <td className="px-4 py-5 text-right text-sky-300">
                          <div className="font-semibold">{fmtInt(underdogWins)}</div>
                          <div className={cn("text-xs", metricColor(underdogProfit))}>
                            {underdogProfit > 0 ? "+" : ""}
                            {fmt(underdogProfit)} VB
                          </div>
                        </td>

                        <td className="px-4 py-5 text-right font-semibold text-green-300">
                          {fmtInt(winningBets)}
                        </td>

                        <td className="px-4 py-5 text-right text-neutral-200">
                          {betsCount}
                        </td>

                        <td className="px-4 py-5 text-right font-semibold text-yellow-300">
                          {activeBets}
                        </td>

                        <td className="px-4 py-5 text-right text-green-400">
                          {toNum(row.won_bets)}
                        </td>

                        <td className="px-4 py-5 text-right text-red-400">
                          {toNum(row.lost_bets)}
                        </td>

                        <td className="px-4 py-5 text-right text-neutral-200">
                          {toNum(row.void_bets)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SurfaceCard>
        </>
      )}
    </div>
  );
}
