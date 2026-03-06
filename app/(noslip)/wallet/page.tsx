"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

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

// ✅ jeśli route kuponu masz inny, podmień tutaj:
const BET_DETAILS_PATH = (betId: string) => `/bets/${betId}`;

export default function WalletPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [uid, setUid] = useState<string | null>(null);

  const [balance, setBalance] = useState<number | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // --- Filters
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("7d");
  const [fromDate, setFromDate] = useState<string>(""); // YYYY-MM-DD
  const [toDate, setToDate] = useState<string>(""); // YYYY-MM-DD
  const [limit, setLimit] = useState<number>(100);

  const computedRange = useMemo(() => {
    if (datePreset === "all") return { from: null as Date | null, to: null as Date | null };

    const now = new Date();
    if (datePreset === "24h") return { from: new Date(now.getTime() - 24 * 3600 * 1000), to: now };
    if (datePreset === "7d") return { from: new Date(now.getTime() - 7 * 24 * 3600 * 1000), to: now };
    if (datePreset === "30d") return { from: new Date(now.getTime() - 30 * 24 * 3600 * 1000), to: now };

    // custom
    if (!fromDate && !toDate) return { from: null, to: null };
    const from = fromDate ? startOfDay(new Date(fromDate)) : null;
    const to = toDate ? endOfDay(new Date(toDate)) : null;
    return { from, to };
  }, [datePreset, fromDate, toDate]);

  // ✅ szybkie sumy z aktualnej listy
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

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;

      const userId = sessionData.session?.user?.id ?? null;

      // ✅ GUARD: wallet dostępny tylko po zalogowaniu
      if (!userId) {
        setUid(null);
        setRows([]);
        setBalance(null);
        router.replace("/login");
        return;
      }

      setUid(userId);

      // 1) balance_vb z profiles
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("id,balance_vb")
        .eq("id", userId)
        .maybeSingle<ProfileRow>();

      if (profErr) throw profErr;
      setBalance(prof?.balance_vb ?? 0);

      // 2) vb_ledger (z filtrami)
      let q = supabase
        .from("vb_ledger")
        .select("id,created_at,kind,amount,balance_after,ref_type,ref_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(Math.max(10, Math.min(500, Number(limit) || 100)));

      // filtr dat
      if (computedRange.from) q = q.gte("created_at", computedRange.from.toISOString());
      if (computedRange.to) q = q.lte("created_at", computedRange.to.toISOString());

      // filtr kind
      if (kindFilter === "bets") q = q.in("kind", ["BET_PLACED", "BET_PAYOUT"]);
      if (kindFilter === "bonus") q = q.eq("kind", "WEEKLY_GRANT");
      if (kindFilter === "adjustments") q = q.eq("kind", "MANUAL_RECONCILIATION");

      const { data: led, error: ledErr } = await q;
      if (ledErr) throw ledErr;

      setRows((led ?? []) as LedgerRow[]);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Nie udało się pobrać historii VB.");
      setRows([]);
      setBalance(null);
    } finally {
      setLoading(false);
    }
  };

  // Inicjalne ustawienie custom dat na dziś-7d .. dziś
  useEffect(() => {
    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    setFromDate(isoDateOnly(d7));
    setToDate(isoDateOnly(now));
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh po zmianie filtrów
  useEffect(() => {
    if (!uid) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindFilter, datePreset, fromDate, toDate, limit]);

  // ✅ nie pokazujemy “musisz być zalogowany” — robimy redirect
  if (loading) return <div className="text-neutral-400">Ładowanie...</div>;
  if (!uid) return null;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Portfel — historia VB</h1>
          <p className="text-neutral-400 mt-1 text-sm">
            Wszystkie zmiany salda wynikające z kuponów, bonusów i korekt.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => router.push("/account")}
            className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
          >
            Moje konto
          </button>

          <button
            onClick={load}
            className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
          >
            Odśwież
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 flex items-center justify-between">
        <div className="text-sm text-neutral-300">
          Aktualne saldo
          <div className="text-2xl font-semibold text-white mt-1">{fmt2(balance)} VB</div>
        </div>

        <div className="text-xs text-neutral-500 text-right">
          Źródło: <span className="text-neutral-300">profiles.balance_vb</span>
          <div className="mt-1">
            Historia: <span className="text-neutral-300">vb_ledger</span>
          </div>
        </div>
      </div>

      {/* ✅ Quick sums */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-semibold">Szybkie sumy (dla aktualnych filtrów)</div>
          <div className="text-xs text-neutral-500">na bazie: {rows.length} wpisów</div>
        </div>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-xs text-neutral-400">Przychody</div>
            <div className="text-lg font-semibold text-green-400">+{fmt2(quickSums.income)} VB</div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-xs text-neutral-400">Wydatki</div>
            <div className="text-lg font-semibold text-red-400">-{fmt2(quickSums.expense)} VB</div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-xs text-neutral-400">Netto</div>
            <div
              className={`text-lg font-semibold ${
                quickSums.net >= 0 ? "text-green-400" : "text-red-400"
              }`}
            >
              {quickSums.net >= 0 ? "+" : ""}
              {fmt2(quickSums.net)} VB
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="font-semibold">Filtry</div>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <div className="text-xs text-neutral-400">Typ</div>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as KindFilter)}
              className="w-full px-3 py-2 rounded-xl border border-neutral-800 bg-neutral-950 text-sm"
            >
              <option value="all">Wszystkie</option>
              <option value="bets">Kupony (stawka + wypłata)</option>
              <option value="bonus">Bonusy (weekly)</option>
              <option value="adjustments">Korekty (manual)</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-neutral-400">Zakres</div>
            <select
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value as DatePreset)}
              className="w-full px-3 py-2 rounded-xl border border-neutral-800 bg-neutral-950 text-sm"
            >
              <option value="7d">Ostatnie 7 dni</option>
              <option value="24h">Ostatnie 24h</option>
              <option value="30d">Ostatnie 30 dni</option>
              <option value="all">Cała historia</option>
              <option value="custom">Własny zakres</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-neutral-400">Od</div>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              disabled={datePreset !== "custom"}
              className="w-full px-3 py-2 rounded-xl border border-neutral-800 bg-neutral-950 text-sm disabled:opacity-50"
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-neutral-400">Do</div>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              disabled={datePreset !== "custom"}
              className="w-full px-3 py-2 rounded-xl border border-neutral-800 bg-neutral-950 text-sm disabled:opacity-50"
            />
          </div>

          <div className="space-y-1 lg:col-span-1">
            <div className="text-xs text-neutral-400">Limit wpisów</div>
            <select
              value={String(limit)}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl border border-neutral-800 bg-neutral-950 text-sm"
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="500">500</option>
            </select>
          </div>

          <div className="lg:col-span-3 rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-xs text-neutral-400">Aktywne filtry</div>
            <div className="mt-1 text-sm text-neutral-200 flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Typ: <b className="text-white">{kindFilter}</b>
              </span>
              <span>
                Zakres: <b className="text-white">{datePreset}</b>
              </span>
              {datePreset === "custom" ? (
                <span>
                  {fromDate || "—"} → {toDate || "—"}
                </span>
              ) : (
                <span className="text-neutral-400">
                  {computedRange.from ? new Date(computedRange.from).toLocaleString() : "—"} →{" "}
                  {computedRange.to ? new Date(computedRange.to).toLocaleString() : "—"}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-900/50 bg-red-900/10 p-4 text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
          <div className="font-semibold">Ostatnie operacje</div>
          <div className="text-xs text-neutral-500">pobrane: {rows.length}</div>
        </div>

        {rows.length === 0 ? (
          <div className="p-4 text-neutral-400 text-sm">Brak wpisów dla wybranych filtrów.</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-neutral-400">
                <tr className="border-b border-neutral-800">
                  <th className="text-left font-medium px-4 py-3">Czas</th>
                  <th className="text-left font-medium px-4 py-3">Typ</th>
                  <th className="text-right font-medium px-4 py-3">Kwota</th>
                  <th className="text-right font-medium px-4 py-3">Saldo po</th>
                  <th className="text-left font-medium px-4 py-3">Referencja</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-neutral-800/70 hover:bg-neutral-950/40"
                  >
                    <td className="px-4 py-3 text-neutral-300 whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </td>

                    <td className="px-4 py-3 text-neutral-200">
                      <div className="font-medium">{kindLabel(r.kind)}</div>
                      <div className="text-xs text-neutral-500">{r.kind}</div>
                    </td>

                    <td className={`px-4 py-3 text-right font-semibold ${amountClass(r.amount)}`}>
                      {r.amount > 0 ? "+" : ""}
                      {fmt2(r.amount)} VB
                    </td>

                    <td className="px-4 py-3 text-right text-neutral-200">
                      {r.balance_after == null ? (
                        <span className="text-neutral-500">—</span>
                      ) : (
                        <span className="font-semibold">{fmt2(r.balance_after)} VB</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-neutral-300">
                      {r.ref_type ? (
                        <div className="text-xs">
                          <span className="text-neutral-500">{r.ref_type}</span>
                          {r.ref_id ? (
                            <>
                              <span className="text-neutral-500"> · </span>

                              {r.ref_type === "bet" ? (
                                <Link
                                  href={BET_DETAILS_PATH(r.ref_id)}
                                  className="text-sky-300 hover:text-sky-200 underline underline-offset-2"
                                  title="Otwórz kupon"
                                >
                                  {r.ref_id}
                                </Link>
                              ) : (
                                <span className="text-neutral-300">{r.ref_id}</span>
                              )}
                            </>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-neutral-500">—</span>
                      )}
                      <div className="text-[10px] text-neutral-600 mt-1">id: {r.id}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-xs text-neutral-500">
        Tip: sumy liczone są z aktualnie pobranych wpisów (po filtrach). Jeśli kiedyś będziesz
        chciał „sumy po całej historii” niezależnie od limitu, zrobimy osobny endpoint / RPC z
        agregacją.
      </div>
    </div>
  );
}