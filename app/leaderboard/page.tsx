"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type LeaderboardRow = {
  id: string;
  username: string | null;
  balance_vb: number | string | null;
  bets_count: number | string | null;
  won_bets: number | string | null;
  lost_bets: number | string | null;
  void_bets: number | string | null;
  profit: number | string | null;
  roi: number | string | null;
  winrate: number | string | null;
};

type SortKey = "profit" | "balance" | "roi" | "winrate";

const MIN_BETS_FOR_RATE_RANKING = 5;
const USER_PROFILE_PATH = (username: string) =>
  `/users/${encodeURIComponent(username)}`;

function toNum(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt(v: unknown) {
  return toNum(v).toFixed(2);
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
  return "Winrate";
}

function medalBg(index: number) {
  if (index === 0) return "from-yellow-500/20 to-amber-500/5 border-yellow-500/30";
  if (index === 1) return "from-slate-300/15 to-slate-500/5 border-slate-300/20";
  if (index === 2) return "from-orange-500/15 to-amber-700/5 border-orange-500/25";
  return "from-neutral-800/40 to-neutral-900/20 border-neutral-800";
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
  if (label === "HOT") return "border-green-500/30 bg-green-500/10 text-green-300";
  if (label === "UP") return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  if (label === "DOWN") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-neutral-700 bg-neutral-800/40 text-neutral-300";
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
    <svg
      viewBox="0 0 100 36"
      className="h-8 w-20 shrink-0"
      aria-hidden="true"
    >
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
      onClick={onClick}
      className={[
        "px-4 py-2 rounded-xl border text-[15px] transition",
        active
          ? "border-neutral-200 bg-white text-black"
          : "border-neutral-700 hover:bg-neutral-800 text-white",
      ].join(" ")}
    >
      <span className="inline-flex items-center gap-2">
        <span>Sortuj: {label}</span>
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
    <span className="inline-flex items-center gap-1">
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
  const rateEligible = betsCount >= MIN_BETS_FOR_RATE_RANKING;
  const trend = trendLabel(profit, roi, winrate);

  const primaryMetric =
    sortBy === "profit"
      ? `${profit > 0 ? "+" : ""}${fmt(profit)} VB`
      : sortBy === "balance"
        ? `${fmt(balance)} VB`
        : sortBy === "roi"
          ? rateEligible
            ? `${fmt(roi)}%`
            : "—"
          : rateEligible
            ? `${fmt(winrate)}%`
            : "—";

  return (
    <div
      className={[
        "rounded-2xl border bg-gradient-to-b p-4 transition",
        medalBg(index),
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl">{rankLabel(index)}</div>
          <Link
            href={USER_PROFILE_PATH(username)}
            className="mt-2 block text-lg font-semibold text-white hover:text-sky-300 transition break-words"
          >
            {username}
          </Link>
          <div className="mt-2 text-xs text-neutral-400">
            {rateEligible
              ? "pełne statystyki rankingowe"
              : `za mało kuponów do ROI/Winrate (${betsCount}/${MIN_BETS_FOR_RATE_RANKING})`}
          </div>
        </div>

        <span
          className={[
            "rounded-full border px-2 py-1 text-[11px] font-semibold",
            trendClasses(trend),
          ].join(" ")}
        >
          {trend}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-neutral-800 bg-black/20 p-3">
          <div className="text-xs text-neutral-400">Aktualna metryka</div>
          <div className="mt-1 font-semibold text-white">{primaryMetric}</div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-black/20 p-3">
          <div className="text-xs text-neutral-400">Saldo</div>
          <div className="mt-1 font-semibold text-white">{fmt(balance)} VB</div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-black/20 p-3">
          <div className="text-xs text-neutral-400">Profit</div>
          <div className={`mt-1 font-semibold ${metricColor(profit)}`}>
            {profit > 0 ? "+" : ""}
            {fmt(profit)} VB
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-black/20 p-3">
          <div className="text-xs text-neutral-400">Winrate</div>
          <div className="mt-1 font-semibold text-white">
            {rateEligible ? `${fmt(winrate)}%` : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("profit");

  const load = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    const { data } = await supabase.from("leaderboard_global").select("*");
    setRows((data ?? []) as LeaderboardRow[]);

    if (silent) setRefreshing(false);
    else setLoading(false);
  };

  useEffect(() => {
    load(false);
  }, []);

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
  const tableRows = sortedRows.slice(3);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4">
        <h1 className="text-3xl font-semibold">Ranking globalny</h1>
        <p className="text-neutral-400 mt-2">Ładowanie...</p>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-6 overflow-x-hidden">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Ranking globalny</h1>
          <p className="text-neutral-400 mt-1">
            Porównanie wszystkich graczy według wyniku i statystyk kuponów.
          </p>
        </div>

        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className={[
            "px-4 py-2 rounded-xl border text-sm transition",
            refreshing
              ? "border-neutral-800 bg-neutral-950 text-neutral-500 cursor-not-allowed"
              : "border-neutral-700 hover:bg-neutral-800 text-white",
          ].join(" ")}
        >
          {refreshing ? "Odświeżam..." : "Odśwież"}
        </button>
      </div>

      <div className="sticky top-20 z-10 rounded-2xl border border-neutral-800 bg-black/70 backdrop-blur supports-[backdrop-filter]:bg-black/55 p-3">
        <div className="flex gap-2 flex-wrap">
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
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-4 py-3 text-sm text-neutral-400">
        Aktualne sortowanie:{" "}
        <span className="text-white font-semibold">{sortLabel(sortBy)}</span>
      </div>

      {podiumRows.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Top 3</h2>
            <div className="text-xs text-neutral-500">Podium aktualnego rankingu</div>
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

      <div className="w-full min-w-0 border border-neutral-800 rounded-2xl bg-neutral-900/40 px-2 py-2 overflow-hidden">
        <table className="w-full min-w-0 table-fixed text-sm">
          <thead className="border-b border-neutral-800 text-neutral-400">
            <tr>
              <th className="text-left px-2 py-3 w-10">#</th>
              <th className="text-left px-2 py-3 w-[220px]">Użytkownik</th>
              <th className="text-right px-2 py-3 w-[90px]">
                <HeaderLabel label="Saldo" active={sortBy === "balance"} />
              </th>
              <th className="text-right px-2 py-3 w-[100px]">
                <HeaderLabel label="Profit" active={sortBy === "profit"} />
              </th>
              <th className="text-right px-2 py-3 w-[75px]">
                <HeaderLabel label="ROI" active={sortBy === "roi"} />
              </th>
              <th className="text-right px-2 py-3 w-[85px]">
                <HeaderLabel label="Winrate" active={sortBy === "winrate"} />
              </th>
              <th className="text-right px-2 py-3 w-[70px]">Kupony</th>
              <th className="text-right px-2 py-3 w-[55px]">Won</th>
              <th className="text-right px-2 py-3 w-[55px]">Lost</th>
              <th className="text-right px-2 py-3 w-[55px]">Void</th>
            </tr>
          </thead>

          <tbody>
            {tableRows.map((row, index) => {
              const profit = toNum(row.profit);
              const roi = toNum(row.roi);
              const winrate = toNum(row.winrate);
              const betsCount = toNum(row.bets_count);
              const rateEligible = betsCount >= MIN_BETS_FOR_RATE_RANKING;
              const username = row.username?.trim() || "gracz";
              const trend = trendLabel(profit, roi, winrate);

              return (
                <tr
                  key={row.id}
                  className="border-b border-neutral-800 hover:bg-neutral-800/40 transition animate-[fadeIn_.35s_ease]"
                >
                  <td className="px-3 py-6 text-base font-semibold text-neutral-300 align-top">
                    {rankLabel(index + 3)}
                  </td>

                  <td className="px-3 py-6 align-top">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={USER_PROFILE_PATH(username)}
                          className="block font-medium text-white hover:text-sky-300 transition truncate"
                          title={username}
                        >
                          {username}
                        </Link>

                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span
                            className={[
                              "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                              trendClasses(trend),
                            ].join(" ")}
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

                  <td className="px-3 py-6 text-right text-neutral-200 align-top">
                    {fmt(row.balance_vb)} VB
                  </td>

                  <td
                    className={`px-3 py-6 text-right font-semibold align-top ${metricColor(profit)}`}
                  >
                    {profit > 0 ? "+" : ""}
                    {fmt(profit)} VB
                  </td>

                  <td
                    className={`px-3 py-6 text-right align-top ${
                      !rateEligible ? "text-neutral-500" : metricColor(roi)
                    }`}
                    title={
                      rateEligible
                        ? undefined
                        : `ROI liczone rankingowo od ${MIN_BETS_FOR_RATE_RANKING} kuponów`
                    }
                  >
                    {rateEligible ? `${fmt(roi)}%` : "—"}
                  </td>

                  <td
                    className={`px-3 py-6 text-right align-top ${
                      !rateEligible ? "text-neutral-500" : "text-neutral-200"
                    }`}
                    title={
                      rateEligible
                        ? undefined
                        : `Winrate liczony rankingowo od ${MIN_BETS_FOR_RATE_RANKING} kuponów`
                    }
                  >
                    {rateEligible ? `${fmt(winrate)}%` : "—"}
                  </td>

                  <td className="px-3 py-6 text-right text-neutral-200 align-top">
                    {betsCount}
                  </td>

                  <td className="px-3 py-6 text-right text-green-400 align-top">
                    {toNum(row.won_bets)}
                  </td>

                  <td className="px-3 py-6 text-right text-red-400 align-top">
                    {toNum(row.lost_bets)}
                  </td>

                  <td className="px-3 py-6 text-right text-neutral-200 align-top">
                    {toNum(row.void_bets)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}