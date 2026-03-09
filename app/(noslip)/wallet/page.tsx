// (noslip)/wallet/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
  Brush,
  ReferenceLine,
} from "recharts";

type LedgerRow = {
  id: string;
  created_at: string;
  kind: string;
  amount: number;
  balance_after: number | null;
  ref_type: string | null;
  ref_id: string | null;
};

const fmt2 = (n: number | null | undefined) => Number(n ?? 0).toFixed(2);

function kindLabel(kind: string) {
  switch (kind) {
    case "BET_PLACED":
      return "Postawiono kupon";
    case "BET_PAYOUT":
      return "Wygrany kupon";
    case "WEEKLY_GRANT":
      return "Weekly bonus";
    case "MANUAL_RECONCILIATION":
      return "Korekta";
    default:
      return kind;
  }
}

function amountClass(amount: number) {
  if (amount > 0) return "text-green-400";
  if (amount < 0) return "text-red-400";
  return "";
}

const BET_DETAILS_PATH = (betId: string) => `/bets/${betId}`;

function isBetKind(kind: string) {
  return kind === "BET_PLACED" || kind === "BET_PAYOUT";
}

function isWeeklyKind(kind: string) {
  return kind === "WEEKLY_GRANT";
}

function startOfLocalDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function WalletPage() {
  const router = useRouter();

  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;

    if (!userId) {
      router.replace("/login");
      return;
    }

    const { data: prof } = await supabase
      .from("profiles")
      .select("balance_vb")
      .eq("id", userId)
      .single();

    setBalance(prof?.balance_vb ?? 0);

    const { data } = await supabase
      .from("vb_ledger")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1000);

    const normalized = ((data ?? []) as LedgerRow[]).slice().sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();

      if (ta !== tb) return ta - tb;

      const ba = Number(a.balance_after ?? 0);
      const bb = Number(b.balance_after ?? 0);

      if (ba !== bb) return ba - bb;

      return String(a.id).localeCompare(String(b.id));
    });

    setRows(normalized);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const chartData = useMemo(() => {
    let cumulativePnl = 0;

    return rows
      .filter((r) => r.balance_after !== null)
      .map((r, index) => {
        if (isBetKind(r.kind)) cumulativePnl += Number(r.amount ?? 0);

        return {
          x: index,
          time: new Date(r.created_at).toLocaleString(),
          rawTime: r.created_at,
          balance: Number(r.balance_after ?? 0),
          change: Number(r.amount ?? 0),
          cumulativePnl,
          kind: r.kind,
          ref_id: r.ref_id ?? null,
          ref_type: r.ref_type ?? null,
          isWeekly: isWeeklyKind(r.kind),
        };
      });
  }, [rows]);

  const weeklyGrantPoints = useMemo(() => {
    return chartData.filter((r) => r.isWeekly);
  }, [chartData]);

  const quick = useMemo(() => {
    let income = 0;
    let expense = 0;

    for (const r of rows) {
      if (r.amount > 0) income += r.amount;
      if (r.amount < 0) expense += Math.abs(r.amount);
    }

    return {
      income,
      expense,
      net: income - expense,
    };
  }, [rows]);

  const betStats = useMemo(() => {
    const betPlaced = rows.filter((r) => r.kind === "BET_PLACED");
    const betPayout = rows.filter((r) => r.kind === "BET_PAYOUT");

    const stakeAbs = betPlaced.reduce(
      (sum, r) => sum + Math.abs(Number(r.amount ?? 0)),
      0
    );
    const payoutSum = betPayout.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

    const winrate = betPlaced.length > 0 ? (betPayout.length / betPlaced.length) * 100 : 0;
    const roi = stakeAbs > 0 ? ((payoutSum - stakeAbs) / stakeAbs) * 100 : 0;

    const now = new Date();
    const startToday = startOfLocalDay(now);
    const startWeek = startOfLocalDay(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));

    const betPlacedToday = betPlaced.filter((r) => new Date(r.created_at) >= startToday);
    const betPayoutToday = betPayout.filter((r) => new Date(r.created_at) >= startToday);

    const stakeToday = betPlacedToday.reduce(
      (sum, r) => sum + Math.abs(Number(r.amount ?? 0)),
      0
    );
    const payoutToday = betPayoutToday.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
    const roiDay = stakeToday > 0 ? ((payoutToday - stakeToday) / stakeToday) * 100 : 0;

    const betPlacedWeek = betPlaced.filter((r) => new Date(r.created_at) >= startWeek);
    const betPayoutWeek = betPayout.filter((r) => new Date(r.created_at) >= startWeek);

    const stakeWeek = betPlacedWeek.reduce(
      (sum, r) => sum + Math.abs(Number(r.amount ?? 0)),
      0
    );
    const payoutWeek = betPayoutWeek.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
    const roiWeek = stakeWeek > 0 ? ((payoutWeek - stakeWeek) / stakeWeek) * 100 : 0;

    return {
      stakesTotal: stakeAbs,
      payoutsTotal: payoutSum,
      winrate,
      roi,
      roiDay,
      roiWeek,
      betCount: betPlaced.length,
      settledWinningCount: betPayout.length,
    };
  }, [rows]);

  const drawdownStats = useMemo(() => {
    let peak = Number.NEGATIVE_INFINITY;
    let peakX: number | null = null;
    let peakTime = "";
    let maxDrawdown = 0;
    let troughX: number | null = null;
    let troughTime = "";
    let troughBalance = 0;

    for (const p of chartData) {
      if (p.balance > peak) {
        peak = p.balance;
        peakX = p.x;
        peakTime = p.time;
      }

      const dd = peak - p.balance;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        troughX = p.x;
        troughTime = p.time;
        troughBalance = p.balance;
      }
    }

    return {
      peakBalance: peak === Number.NEGATIVE_INFINITY ? 0 : peak,
      peakX,
      peakTime,
      maxDrawdown,
      troughX,
      troughTime,
      troughBalance,
    };
  }, [chartData]);

  const TooltipBox = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;

    const p = payload[0].payload;
    const color =
      p.change > 0
        ? "text-green-400"
        : p.change < 0
          ? "text-red-400"
          : "text-white";

    return (
      <div className="bg-black border border-neutral-700 rounded-xl p-3 shadow-lg text-sm">
        <div className="text-white font-semibold">{p.time}</div>

        <div className="mt-1 text-neutral-300">
          Saldo: <span className="text-white">{fmt2(p.balance)} VB</span>
        </div>

        <div className={`font-semibold ${color}`}>
          Zmiana: {p.change > 0 ? "+" : ""}
          {fmt2(p.change)} VB
        </div>

        <div className="text-neutral-400 text-xs mt-1">
          Typ: {kindLabel(p.kind)}
        </div>

        {p.ref_type === "bet" && p.ref_id ? (
          <div className="text-neutral-400 text-xs mt-1">
            Bet ID: <span className="text-white">{p.ref_id}</span>
          </div>
        ) : null}
      </div>
    );
  };

  if (loading) return <div className="text-neutral-400">Ładowanie...</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Portfel</h1>
        <p className="text-neutral-400 text-sm">Historia salda i statystyki</p>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <div className="text-sm text-neutral-400">Aktualne saldo</div>
        <div className="text-3xl font-semibold mt-1">{fmt2(balance)} VB</div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="font-semibold">Saldo w czasie</div>
          <div className="text-xs text-neutral-500">
            Weekly grant oznaczony żółtą linią
          </div>
        </div>

        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid stroke="#262626" strokeDasharray="3 3" />

              <XAxis
                dataKey="x"
                stroke="#888"
                minTickGap={30}
                tickFormatter={(value) => {
                  const row = chartData[value];
                  if (!row) return "";
                  return new Date(row.rawTime).toLocaleDateString();
                }}
              />

              <YAxis stroke="#888" />

              <Tooltip content={<TooltipBox />} />

              {weeklyGrantPoints.map((p) => (
                <ReferenceLine
                  key={`wg-${p.x}-${p.ref_id ?? p.time}`}
                  x={p.x}
                  stroke="#facc15"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                />
              ))}

              {drawdownStats.peakX != null ? (
                <ReferenceLine
                  y={drawdownStats.peakBalance}
                  stroke="#22c55e"
                  strokeDasharray="3 3"
                  ifOverflow="extendDomain"
                />
              ) : null}

              <Line
                type="monotone"
                dataKey="balance"
                stroke="#38bdf8"
                strokeWidth={3}
                dot={(props: any) => {
                  const { cx, cy, payload } = props;

                  let color = "#38bdf8";
                  if (payload.kind === "BET_PLACED") color = "#ef4444";
                  if (payload.kind === "BET_PAYOUT") color = "#22c55e";
                  if (payload.kind === "WEEKLY_GRANT") color = "#facc15";
                  if (payload.kind === "MANUAL_RECONCILIATION") color = "#a78bfa";

                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={3.5}
                      fill={color}
                      stroke="#0a0a0a"
                      strokeWidth={1.5}
                    />
                  );
                }}
                activeDot={(props: any) => {
                  const { cx, cy, payload } = props;

                  let color = "#38bdf8";
                  if (payload.kind === "BET_PLACED") color = "#ef4444";
                  if (payload.kind === "BET_PAYOUT") color = "#22c55e";
                  if (payload.kind === "WEEKLY_GRANT") color = "#facc15";
                  if (payload.kind === "MANUAL_RECONCILIATION") color = "#a78bfa";

                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={6}
                      fill={color}
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                  );
                }}
              />

              <Brush
                dataKey="x"
                height={30}
                stroke="#38bdf8"
                tickFormatter={(value) => {
                  const row = chartData[value];
                  if (!row) return "";
                  return new Date(row.rawTime).toLocaleDateString();
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
        <div className="font-semibold mb-3">Profit (PnL kumulacyjny)</div>

        <div className="h-56">
          <ResponsiveContainer>
            <AreaChart data={chartData}>
              <CartesianGrid stroke="#262626" strokeDasharray="3 3" />

              <XAxis
                dataKey="x"
                stroke="#888"
                minTickGap={30}
                tickFormatter={(value) => {
                  const row = chartData[value];
                  if (!row) return "";
                  return new Date(row.rawTime).toLocaleDateString();
                }}
              />

              <YAxis stroke="#888" />
              <Tooltip content={<TooltipBox />} />

              <Area
                type="monotone"
                dataKey="cumulativePnl"
                stroke="#22c55e"
                fill="#22c55e22"
                strokeWidth={2}
              />

              <ReferenceLine y={0} stroke="#666" strokeDasharray="4 4" />

              <Brush
                dataKey="x"
                height={30}
                stroke="#38bdf8"
                tickFormatter={(value) => {
                  const row = chartData[value];
                  if (!row) return "";
                  return new Date(row.rawTime).toLocaleDateString();
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
          title="Profit"
          value={`${fmt2(quick.net)} VB`}
          color={quick.net >= 0 ? "text-green-400" : "text-red-400"}
        />
        <Stat
          title="Winrate z betów"
          value={`${betStats.winrate.toFixed(2)} %`}
        />
        <Stat title="ROI całkowite" value={`${betStats.roi.toFixed(2)} %`} />
        <Stat title="Transakcje" value={rows.length} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat title="ROI dzisiaj" value={`${betStats.roiDay.toFixed(2)} %`} />
        <Stat title="ROI 7 dni" value={`${betStats.roiWeek.toFixed(2)} %`} />
        <Stat
          title="Peak balance"
          value={`${fmt2(drawdownStats.peakBalance)} VB`}
          color="text-green-400"
        />
        <Stat
          title="Max drawdown"
          value={`${fmt2(drawdownStats.maxDrawdown)} VB`}
          color="text-red-400"
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat
          title="Przychody"
          value={`+${fmt2(quick.income)} VB`}
          color="text-green-400"
        />

        <Stat
          title="Wydatki"
          value={`-${fmt2(quick.expense)} VB`}
          color="text-red-400"
        />

        <Stat title="Netto" value={`${fmt2(quick.net)} VB`} />
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-800 font-semibold">
          Historia transakcji
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-neutral-400 text-xs">
              <tr className="border-b border-neutral-800">
                <th className="px-4 py-3 text-left">Czas</th>
                <th className="px-4 py-3 text-left">Typ</th>
                <th className="px-4 py-3 text-right">Kwota</th>
                <th className="px-4 py-3 text-right">Saldo</th>
                <th className="px-4 py-3 text-left">Ref</th>
              </tr>
            </thead>

            <tbody>
              {rows
                .slice()
                .reverse()
                .map((r) => (
                  <tr key={r.id} className="border-b border-neutral-800/70">
                    <td className="px-4 py-3">
                      {new Date(r.created_at).toLocaleString()}
                    </td>

                    <td className="px-4 py-3">{kindLabel(r.kind)}</td>

                    <td className={`px-4 py-3 text-right ${amountClass(r.amount)}`}>
                      {r.amount > 0 ? "+" : ""}
                      {fmt2(r.amount)} VB
                    </td>

                    <td className="px-4 py-3 text-right">
                      {fmt2(r.balance_after)}
                    </td>

                    <td className="px-4 py-3 text-xs">
                      {r.ref_type === "bet" && r.ref_id ? (
                        <Link
                          href={BET_DETAILS_PATH(r.ref_id)}
                          className="text-sky-300 underline"
                        >
                          {r.ref_id}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({
  title,
  value,
  color,
}: {
  title: string;
  value: any;
  color?: string;
}) {
  return (
    <div className="p-4 border border-neutral-800 rounded-xl bg-neutral-900/40">
      <div className="text-xs text-neutral-400">{title}</div>
      <div className={`text-lg font-semibold ${color ?? ""}`}>{value}</div>
    </div>
  );
}