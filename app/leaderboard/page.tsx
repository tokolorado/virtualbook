"use client";

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

export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"profit" | "balance" | "roi" | "winrate">("profit");

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("leaderboard_global").select("*");
      setRows((data ?? []) as LeaderboardRow[]);
      setLoading(false);
    };

    load();
  }, []);

  const sortedRows = useMemo(() => {
    const copy = [...rows];

    copy.sort((a, b) => {
      if (sortBy === "profit") return toNum(b.profit) - toNum(a.profit);
      if (sortBy === "balance") return toNum(b.balance_vb) - toNum(a.balance_vb);
      if (sortBy === "roi") return toNum(b.roi) - toNum(a.roi);
      return toNum(b.winrate) - toNum(a.winrate);
    });

    return copy;
  }, [rows, sortBy]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-semibold">Ranking globalny</h1>
        <p className="text-neutral-400 mt-2">Ładowanie...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Ranking globalny</h1>
        <p className="text-neutral-400 mt-1">
          Porównanie wszystkich graczy według wyniku i statystyk kuponów.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setSortBy("profit")}
          className="px-4 py-2 rounded-xl border border-neutral-700 hover:bg-neutral-800 text-[15px]"
        >
          Sortuj: Profit
        </button>

        <button
          onClick={() => setSortBy("balance")}
          className="px-4 py-2 rounded-xl border border-neutral-700 hover:bg-neutral-800 text-[15px]"
        >
          Sortuj: Saldo
        </button>

        <button
          onClick={() => setSortBy("roi")}
          className="px-4 py-2 rounded-xl border border-neutral-700 hover:bg-neutral-800 text-[15px]"
        >
          Sortuj: ROI
        </button>

        <button
          onClick={() => setSortBy("winrate")}
          className="px-4 py-2 rounded-xl border border-neutral-700 hover:bg-neutral-800 text-[15px]"
        >
          Sortuj: Winrate
        </button>
      </div>

      <div className="border border-neutral-800 rounded-2xl bg-neutral-900/40 px-3 py-2 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="border-b border-neutral-800 text-neutral-400">
            <tr>
              <th className="text-left px-5 py-3 w-16">#</th>
              <th className="text-left px-5 py-3">Użytkownik</th>
              <th className="text-right px-5 py-3">Saldo</th>
              <th className="text-right px-5 py-3">Profit</th>
              <th className="text-right px-5 py-3">ROI</th>
              <th className="text-right px-5 py-3">Winrate</th>
              <th className="text-right px-5 py-3">Kupony</th>
              <th className="text-right px-5 py-3">Won</th>
              <th className="text-right px-5 py-3">Lost</th>
              <th className="text-right px-5 py-3">Void</th>
            </tr>
          </thead>

          <tbody>
            {sortedRows.map((row, index) => {
              const profit = toNum(row.profit);
              const roi = toNum(row.roi);

              return (
                <tr
                  key={row.id}
                  className="border-b border-neutral-800 hover:bg-neutral-800/40 transition"
                >
                  <td className="px-5 py-7 text-base font-semibold text-neutral-300">
                    {rankLabel(index)}
                  </td>

                  <td className="px-5 py-7 align-middle">
                        <div className="text-xs leading-5 opacity-0 select-none">
                             &nbsp;
                         </div>
                        <div className="font-medium text-white">
                        {row.username}
                        </div>

                        <div className="text-xs leading-5 opacity-0 select-none">
                        &nbsp;
                        </div>
                  </td>

                  <td className="px-5 py-7 text-right text-neutral-200">
                    {fmt(row.balance_vb)} VB
                  </td>

                  <td
                    className={`px-5 py-7 text-right font-semibold ${
                      profit > 0
                        ? "text-green-400"
                        : profit < 0
                          ? "text-red-400"
                          : "text-neutral-200"
                    }`}
                  >
                    {profit > 0 ? "+" : ""}
                    {fmt(profit)} VB
                  </td>

                  <td
                    className={`px-5 py-7 text-right ${
                      roi > 0
                        ? "text-green-400"
                        : roi < 0
                          ? "text-red-400"
                          : "text-neutral-200"
                    }`}
                  >
                    {fmt(roi)}%
                  </td>

                  <td className="px-5 py-7 text-right text-neutral-200">
                    {fmt(row.winrate)}%
                  </td>

                  <td className="px-5 py-7 text-right text-neutral-200">
                    {toNum(row.bets_count)}
                  </td>

                  <td className="px-5 py-7 text-right text-green-400">
                    {toNum(row.won_bets)}
                  </td>

                  <td className="px-5 py-7 text-right text-red-400">
                    {toNum(row.lost_bets)}
                  </td>

                  <td className="px-5 py-7 text-right text-neutral-200">
                    {toNum(row.void_bets)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}