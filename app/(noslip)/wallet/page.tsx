//(noslip)/wallet/page.tsx
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

type ProfileRow = {
  id: string;
  balance_vb: number | null;
};

const fmt2 = (n: number | null | undefined) => Number(n ?? 0).toFixed(2);

function kindLabel(kind: string) {
  switch (kind) {
    case "BET_PLACED":
      return "Postawiono kupon";
    case "BET_PAYOUT":
      return "Wypłata kuponu";
    case "WEEKLY_GRANT":
      return "Weekly bonus";
    case "MANUAL_RECONCILIATION":
      return "Korekta (manual)";
    default:
      return kind;
  }
}

function amountClass(amount: number) {
  if (amount > 0) return "text-green-400";
  if (amount < 0) return "text-red-400";
  return "text-neutral-200";
}

type KindFilter = "all" | "bets" | "bonus" | "adjustments";
type DatePreset = "all" | "24h" | "7d" | "30d" | "custom";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function isoDateOnly(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const BET_DETAILS_PATH = (betId: string) => `/bets/${betId}`;

export default function WalletPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [uid, setUid] = useState<string | null>(null);

  const [balance, setBalance] = useState<number | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("7d");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const [limit, setLimit] = useState<number>(100);

  const computedRange = useMemo(() => {
    if (datePreset === "all") return { from: null as Date | null, to: null as Date | null };

    const now = new Date();
    if (datePreset === "24h") return { from: new Date(now.getTime() - 24 * 3600 * 1000), to: now };
    if (datePreset === "7d") return { from: new Date(now.getTime() - 7 * 24 * 3600 * 1000), to: now };
    if (datePreset === "30d") return { from: new Date(now.getTime() - 30 * 24 * 3600 * 1000), to: now };

    if (!fromDate && !toDate) return { from: null, to: null };

    const from = fromDate ? startOfDay(new Date(fromDate)) : null;
    const to = toDate ? endOfDay(new Date(toDate)) : null;

    return { from, to };
  }, [datePreset, fromDate, toDate]);

  const quickSums = useMemo(() => {
    let income = 0;
    let expense = 0;

    for (const r of rows) {
      const a = Number(r.amount ?? 0);
      if (a > 0) income += a;
      else if (a < 0) expense += Math.abs(a);
    }

    const net = income - expense;
    return { income, expense, net };
  }, [rows]);

  const chartData = useMemo(() => {
    const asc = [...rows]
      .filter((r) => r.balance_after !== null)
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

    return asc.map((r) => ({
      time: new Date(r.created_at).toLocaleDateString(),
      balance: Number(r.balance_after ?? 0),
      change: Number(r.amount ?? 0),
    }));
  }, [rows]);

  const stats = useMemo(() => {
    const spent = quickSums.expense;
    const profit = quickSums.net;
    const roi = spent > 0 ? (profit / spent) * 100 : 0;

    return {
      spent,
      profit,
      roi,
      transactions: rows.length,
    };
  }, [quickSums, rows]);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id ?? null;

      if (!userId) {
        router.replace("/login");
        return;
      }

      setUid(userId);

      const { data: prof } = await supabase
        .from("profiles")
        .select("id,balance_vb")
        .eq("id", userId)
        .maybeSingle<ProfileRow>();

      setBalance(prof?.balance_vb ?? 0);

      let q = supabase
        .from("vb_ledger")
        .select("id,created_at,kind,amount,balance_after,ref_type,ref_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (computedRange.from) q = q.gte("created_at", computedRange.from.toISOString());
      if (computedRange.to) q = q.lte("created_at", computedRange.to.toISOString());

      if (kindFilter === "bets") q = q.in("kind", ["BET_PLACED", "BET_PAYOUT"]);
      if (kindFilter === "bonus") q = q.eq("kind", "WEEKLY_GRANT");
      if (kindFilter === "adjustments") q = q.eq("kind", "MANUAL_RECONCILIATION");

      const { data } = await q;

      setRows((data ?? []) as LedgerRow[]);
    } catch (e: any) {
      setError(e?.message ?? "Błąd pobierania danych");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    setFromDate(isoDateOnly(d7));
    setToDate(isoDateOnly(now));
  }, []);

  useEffect(() => {
    load();
  }, [kindFilter, datePreset, fromDate, toDate, limit]);

  if (loading) return <div className="text-neutral-400">Ładowanie...</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      <div>
        <h1 className="text-2xl font-semibold">Portfel</h1>
        <p className="text-neutral-400 text-sm mt-1">
          Historia salda i statystyki gracza
        </p>
      </div>

      {/* SALDO */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 flex justify-between items-center">
        <div>
          <div className="text-sm text-neutral-400">Aktualne saldo</div>
          <div className="text-3xl font-semibold mt-1">{fmt2(balance)} VB</div>
        </div>
      </div>

      {/* WYKRES SALDA */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
        <div className="font-semibold mb-3">Saldo w czasie</div>

        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
              <XAxis dataKey="time" stroke="#888" />
              <YAxis stroke="#888" />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="balance"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* PROFIT LOSS */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
        <div className="font-semibold mb-3">Profit / Loss</div>

        <div className="h-56">
          <ResponsiveContainer>
            <AreaChart data={chartData}>
              <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
              <XAxis dataKey="time" stroke="#888" />
              <YAxis stroke="#888" />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="change"
                stroke="#22c55e"
                fill="#22c55e33"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* STATYSTYKI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

        <div className="p-4 border border-neutral-800 rounded-xl bg-neutral-900/40">
          <div className="text-xs text-neutral-400">Profit</div>
          <div className="text-lg font-semibold text-green-400">
            {fmt2(stats.profit)} VB
          </div>
        </div>

        <div className="p-4 border border-neutral-800 rounded-xl bg-neutral-900/40">
          <div className="text-xs text-neutral-400">Wydane</div>
          <div className="text-lg font-semibold text-red-400">
            {fmt2(stats.spent)} VB
          </div>
        </div>

        <div className="p-4 border border-neutral-800 rounded-xl bg-neutral-900/40">
          <div className="text-xs text-neutral-400">ROI</div>
          <div className="text-lg font-semibold">
            {stats.roi.toFixed(2)} %
          </div>
        </div>

        <div className="p-4 border border-neutral-800 rounded-xl bg-neutral-900/40">
          <div className="text-xs text-neutral-400">Transakcje</div>
          <div className="text-lg font-semibold">
            {stats.transactions}
          </div>
        </div>

      </div>

      {/* QUICK SUMS */}
      <div className="grid grid-cols-3 gap-4">

        <div className="p-4 border border-neutral-800 rounded-xl">
          <div className="text-xs text-neutral-400">Przychody</div>
          <div className="text-green-400 font-semibold">
            +{fmt2(quickSums.income)} VB
          </div>
        </div>

        <div className="p-4 border border-neutral-800 rounded-xl">
          <div className="text-xs text-neutral-400">Wydatki</div>
          <div className="text-red-400 font-semibold">
            -{fmt2(quickSums.expense)} VB
          </div>
        </div>

        <div className="p-4 border border-neutral-800 rounded-xl">
          <div className="text-xs text-neutral-400">Netto</div>
          <div className="font-semibold">
            {fmt2(quickSums.net)} VB
          </div>
        </div>

      </div>

      {/* HISTORIA */}
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
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-neutral-800/70">

                  <td className="px-4 py-3">
                    {new Date(r.created_at).toLocaleString()}
                  </td>

                  <td className="px-4 py-3">
                    {kindLabel(r.kind)}
                  </td>

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