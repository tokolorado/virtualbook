"use client";

import { formatOdd, formatVB } from "@/lib/format";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Bet = {
  id: string;
  user_id: string;
  stake: number;
  total_odds: number;
  potential_win: number;
  status: string;
  settled: boolean;
  created_at: string;
};

type SettleStats = {
  ok: boolean;
  bufferMinutes: number;
  cutoffIso: string;
  readyItems: number;
  readyMatches: number;
};

type SystemHealth = {
  ok: boolean;
  error?: string;
  params?: { staleHours: number; limit: number };
  metrics?: {
    stuckMatches: number;
    finishedMatchesWithUnsettledItems: number;
    pendingButAllItemsSettled: number;
    missingPayoutLedger: number;
  };
  samples?: {
    stuckMatches: any[];
    finishedMatchesWithUnsettledItems: any[];
    pendingButAllItemsSettled: any[];
    missingPayoutLedger: any[];
  };
};


export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [bets, setBets] = useState<Bet[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  // Auto settlement state
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoResult, setAutoResult] = useState<any>(null);

  // Settle stats
  const [statsLoading, setStatsLoading] = useState(false);
  const [settleStats, setSettleStats] = useState<SettleStats | null>(null);

  // System health
  const [healthLoading, setHealthLoading] = useState(false);
  const [health, setHealth] = useState<SystemHealth | null>(null);

  const load = async () => {
    setLoading(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id;

    if (!uid) {
      setIsAdmin(false);
      setBets([]);
      setLoading(false);
      return;
    }

    const { data: adminRow } = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", uid)
      .maybeSingle();

    const okAdmin = !!adminRow;
    setIsAdmin(okAdmin);

    if (!okAdmin) {
      setBets([]);
      setLoading(false);
      return;
    }

    const { data: betsData, error } = await supabase
      .from("bets")
      .select("id,user_id,stake,total_odds,potential_win,status,settled,created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("ADMIN BETS LOAD ERROR:", error);
      setBets([]);
      setLoading(false);
      return;
    }

    setBets((betsData ?? []) as Bet[]);
    setLoading(false);
  };

  const refreshStats = async () => {
    try {
      setStatsLoading(true);
      const r = await fetch("/api/admin/settle-stats?bufferMinutes=10", { cache: "no-store" });
      const data = await r.json();
      setSettleStats(data);
    } catch (e) {
      setSettleStats(null);
    } finally {
      setStatsLoading(false);
    }
  };

  const refreshHealth = async () => {
    try {
      setHealthLoading(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("No session token");

      const r = await fetch("/api/admin/system-health-ui?staleHours=3&limit=20", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await r.json();
      setHealth(data);
    } catch (e) {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (isAdmin) {
      refreshStats();
      refreshHealth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const settle = async (betId: string, status: "won" | "lost" | "void") => {
    const ok = confirm(`Rozliczyć kupon jako: ${status.toUpperCase()} ?`);
    if (!ok) return;

    // ⚠️ UWAGA:
    // Jeśli Twoja funkcja settle_bet NIE przyjmuje p_status (bo status jest liczony automatycznie),
    // to te przyciski są "legacy".
    // Na razie zostawiamy jak było u Ciebie — jeśli wywali błąd, w następnym kroku robimy osobną RPC: settle_bet_admin.
    const { error } = await supabase.rpc("settle_bet", {
      p_bet_id: betId,
      p_status: status,
    } as any);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Rozliczono ✅");
    await load();
    await refreshStats();
    await refreshHealth();
  };

  const runAutoSettle = async () => {
    const ok = confirm("Uruchomić auto-rozliczanie zaległych meczów?");
    if (!ok) return;

    try {
      setAutoLoading(true);
      setAutoResult(null);

      const res = await fetch("/api/admin/run-settle", {
        method: "POST",
        cache: "no-store",
      });

      const data = await res.json();
      setAutoResult(data);

      if (!res.ok) {
        alert(data?.error ?? "Błąd auto-rozliczania");
        return;
      }

      alert("Auto-rozliczanie zakończone ✅");

      // odśwież listę i liczniki
      await load();
      await refreshStats();
      await refreshHealth();
    } catch (e: any) {
      console.error(e);
      alert("Błąd requestu do /api/admin/run-settle");
    } finally {
      setAutoLoading(false);
    }
  };

  if (loading) return <div className="text-neutral-400">Ładowanie...</div>;

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 text-neutral-300">
        Brak dostępu. To jest panel admina.
      </div>
    );
  }

  const readyMatches = settleStats?.readyMatches ?? 0;
  const readyItems = settleStats?.readyItems ?? 0;

  const hm = health?.metrics;
  const healthBad =
    (hm?.stuckMatches ?? 0) +
    (hm?.finishedMatchesWithUnsettledItems ?? 0) +
    (hm?.pendingButAllItemsSettled ?? 0) +
    (hm?.missingPayoutLedger ?? 0);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Admin — rozliczanie kuponów</h1>
        <p className="text-neutral-400 mt-1 text-sm">
          Kliknij WON/LOST/VOID — baza dopisze wypłatę do salda.
        </p>
      </div>

      {/* System Health */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold">System Health</div>
            <div className="text-xs text-neutral-400 mt-1">
              Monitoring spójności: mecze utkwione, nierozliczone pozycje, pominięte kupony, brak
              payout w ledger.
            </div>
          </div>

          <button
            onClick={refreshHealth}
            disabled={healthLoading}
            className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm disabled:opacity-50"
          >
            {healthLoading ? "..." : "Odśwież health"}
          </button>
        </div>

        {!health ? (
          <div className="text-xs text-neutral-400">Brak danych / nie udało się pobrać.</div>
        ) : !health.ok ? (
          <div className="text-xs text-red-400">Błąd: {health.error ?? "unknown"}</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-3 text-sm">
              <span>
                Status:{" "}
                <b className={healthBad === 0 ? "text-green-400" : "text-yellow-300"}>
                  {healthBad === 0 ? "HEALTHY" : "ATTENTION"}
                </b>
              </span>

              <span>
                stuckMatches:{" "}
                <b className={(hm?.stuckMatches ?? 0) > 0 ? "text-yellow-300" : "text-white"}>
                  {hm?.stuckMatches ?? 0}
                </b>
              </span>

              <span>
                finished+unsettled:{" "}
                <b
                  className={
                    (hm?.finishedMatchesWithUnsettledItems ?? 0) > 0
                      ? "text-yellow-300"
                      : "text-white"
                  }
                >
                  {hm?.finishedMatchesWithUnsettledItems ?? 0}
                </b>
              </span>

              <span>
                pending-ready:{" "}
                <b
                  className={
                    (hm?.pendingButAllItemsSettled ?? 0) > 0 ? "text-yellow-300" : "text-white"
                  }
                >
                  {hm?.pendingButAllItemsSettled ?? 0}
                </b>
              </span>

              <span>
                missing payout:{" "}
                <b className={(hm?.missingPayoutLedger ?? 0) > 0 ? "text-red-400" : "text-white"}>
                  {hm?.missingPayoutLedger ?? 0}
                </b>
              </span>
            </div>

            <details className="text-xs">
              <summary className="cursor-pointer text-neutral-300 hover:text-white">
                Pokaż sample (debug)
              </summary>
              <pre className="mt-2 bg-neutral-950/60 border border-neutral-800 rounded-xl p-3 overflow-auto">
                {JSON.stringify(health.samples, null, 2)}
              </pre>
            </details>
          </>
        )}
      </div>

      {/* Auto settlement + stats */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold">Auto-rozliczanie zaległych meczów</div>
            <div className="text-xs text-neutral-400 mt-1">
              Pobiera wyniki z football-data, zapisuje do match_results i rozlicza kupony (bez Edge/cron).
            </div>

            <div className="mt-2 text-xs text-neutral-300">
              {statsLoading ? (
                <span className="text-neutral-400">Sprawdzam mecze do rozliczenia…</span>
              ) : settleStats ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    Do rozliczenia:{" "}
                    <b className={readyMatches > 0 ? "text-green-400" : "text-white"}>
                      {readyMatches} mecz(e)
                    </b>
                  </span>
                  <span>
                    Pozycje: <b className="text-white">{readyItems}</b>
                  </span>
                  <span className="text-neutral-500">(buffer: {settleStats.bufferMinutes} min)</span>
                </div>
              ) : (
                <span className="text-neutral-400">Nie udało się pobrać statystyk.</span>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={refreshStats}
              disabled={statsLoading}
              className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm disabled:opacity-50"
            >
              {statsLoading ? "..." : "Sprawdź"}
            </button>

            <button
              onClick={runAutoSettle}
              disabled={autoLoading || readyMatches <= 0}
              className="px-4 py-2 rounded-xl border border-neutral-800 bg-green-700 hover:bg-green-600 transition text-sm disabled:opacity-50 disabled:hover:bg-green-700"
              title={readyMatches <= 0 ? "Brak meczów do rozliczenia" : "Uruchom auto-rozliczanie"}
            >
              {autoLoading ? "Rozliczanie..." : "Rozlicz zaległe mecze (auto)"}
            </button>
          </div>
        </div>

        {autoResult && (
          <pre className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-3 text-xs overflow-auto">
            {JSON.stringify(autoResult, null, 2)}
          </pre>
        )}
      </div>

      {bets.length === 0 ? (
        <div className="text-neutral-400">Brak kuponów.</div>
      ) : (
        <div className="space-y-3">
          {bets.map((b) => (
            <div key={b.id} className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-neutral-400">
                    {new Date(b.created_at).toLocaleString()}
                  </div>
                  <div className="mt-2 text-sm">
                    <div>
                      Bet ID: <span className="text-neutral-300">{b.id}</span>
                    </div>
                    <div>
                      User: <span className="text-neutral-300">{b.user_id}</span>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-neutral-400">Stawka</div>
                      <div className="font-semibold">{formatVB(b.stake)} VB</div>
                    </div>
                    <div>
                      <div className="text-xs text-neutral-400">Kurs</div>
                      <div className="font-semibold">{formatOdd(b.total_odds)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-neutral-400">Wygrana</div>
                      <div className="font-semibold">{formatVB(b.potential_win)} VB</div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div className="text-xs text-neutral-400">
                    Status: <b className="text-white">{String(b.status).toUpperCase()}</b>
                  </div>
                  <div className="text-xs text-neutral-400">
                    Settled: <b className="text-white">{b.settled ? "TAK" : "NIE"}</b>
                  </div>

                  <div className="flex gap-2 mt-2">
                    <button
                      disabled={b.settled}
                      onClick={() => settle(b.id, "won")}
                      className="px-3 py-2 rounded-xl text-sm border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 disabled:opacity-50"
                    >
                      WON
                    </button>
                    <button
                      disabled={b.settled}
                      onClick={() => settle(b.id, "lost")}
                      className="px-3 py-2 rounded-xl text-sm border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 disabled:opacity-50"
                    >
                      LOST
                    </button>
                    <button
                      disabled={b.settled}
                      onClick={() => settle(b.id, "void")}
                      className="px-3 py-2 rounded-xl text-sm border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 disabled:opacity-50"
                    >
                      VOID
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={async () => {
          await load();
          await refreshStats();
          await refreshHealth();
        }}
        className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
      >
        Odśwież
      </button>
    </div>
  );
}