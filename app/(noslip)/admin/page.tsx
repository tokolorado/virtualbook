"use client";

import Link from "next/link";
import { formatOdd, formatVB } from "@/lib/format";
import { useEffect, useMemo, useState } from "react";
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

type AdminUser = {
  id: string;
  username: string | null;
  email: string | null;
  balance_vb: number;
  is_banned: boolean;
  email_confirmation_sent_at: string | null;
  email_confirmed_at: string | null;
  email_status: "confirmation mail sent" | "mail confirmed";
  created_at: string | null;
  last_sign_in_at: string | null;
  bets_count: number;
  won_bets: number;
  lost_bets: number;
  void_bets: number;
  profit: number;
  roi: number;
  winrate: number;
};

type AuditLog = {
  id: string;
  admin_user_id: string;
  action: string;
  target_user_id: string | null;
  details: any;
  created_at: string;
};

function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function fmtPct(v?: number | null) {
  return `${Number(v ?? 0).toFixed(2)}%`;
}

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [bets, setBets] = useState<Bet[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const [usersLoading, setUsersLoading] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [manualAmount, setManualAmount] = useState<string>("");

  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [autoLoading, setAutoLoading] = useState(false);
  const [autoResult, setAutoResult] = useState<any>(null);

  const [statsLoading, setStatsLoading] = useState(false);
  const [settleStats, setSettleStats] = useState<SettleStats | null>(null);

  const [healthLoading, setHealthLoading] = useState(false);
  const [health, setHealth] = useState<SystemHealth | null>(null);

  const [surpriseEmail, setSurpriseEmail] = useState("");
  const [surpriseMessage, setSurpriseMessage] = useState("");
  const [sendingSurprise, setSendingSurprise] = useState(false);
  const [surpriseResult, setSurpriseResult] = useState<any>(null);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId]
  );

const getAccessToken = async (): Promise<string> => {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("No session token");
  return token;
};


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

  const loadUsers = async () => {
    try {
      setUsersLoading(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("No session token");

      const res = await fetch("/api/admin/users", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error ?? "Nie udało się pobrać użytkowników.");
      }

      const nextUsers = (data.users ?? []) as AdminUser[];
      setUsers(nextUsers);

      if (!selectedUserId && nextUsers.length) {
        setSelectedUserId(nextUsers[0].id);
      }
    } catch (e) {
      console.error(e);
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    try {
      setAuditLoading(true);

      const { data, error } = await supabase
        .from("admin_audit_logs")
        .select("id,admin_user_id,action,target_user_id,details,created_at")
        .order("created_at", { ascending: false })
        .limit(25);

      if (error) {
        console.error(error);
        setAuditLogs([]);
        return;
      }

      setAuditLogs((data ?? []) as AuditLog[]);
    } catch (e) {
      console.error(e);
      setAuditLogs([]);
    } finally {
      setAuditLoading(false);
    }
  };

  const refreshStats = async () => {
    try {
      setStatsLoading(true);

      const token = await getAccessToken();

      const r = await fetch("/api/admin/settle-stats?bufferMinutes=10", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await r.json();
      setSettleStats(data);
    } catch {
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
    } catch {
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
      loadUsers();
      loadAuditLogs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const settle = async (betId: string, status: "won" | "lost" | "void") => {
    const ok = confirm(`Rozliczyć kupon jako: ${status.toUpperCase()} ?`);
    if (!ok) return;

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

      const token = await getAccessToken();

      const res = await fetch("/api/admin/run-settle", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      setAutoResult(data);

      if (!res.ok) {
        alert(data?.error ?? "Błąd auto-rozliczania");
        return;
      }

      alert("Auto-rozliczanie zakończone ✅");

      await load();
      await refreshStats();
      await refreshHealth();
      await loadAuditLogs();
    } catch (e: any) {
      console.error(e);
      alert("Błąd requestu do /api/admin/run-settle");
    } finally {
      setAutoLoading(false);
    }
  };

  const sendSurprise = async () => {
    const email = surpriseEmail.trim().toLowerCase();
    const message = surpriseMessage.trim();

    if (!email) {
      alert("Podaj email użytkownika.");
      return;
    }

    if (!message) {
      alert("Podaj treść niespodzianki.");
      return;
    }

    try {
      setSendingSurprise(true);
      setSurpriseResult(null);

      const token = await getAccessToken();

      const res = await fetch("/api/admin/send-surprise", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email,
          message,
        }),
      });

      const data = await res.json();
      setSurpriseResult(data);

      if (!res.ok) {
        alert(data?.error ?? "Nie udało się wysłać niespodzianki");
        return;
      }

      alert("Niespodzianka zapisana ✅");
      await loadAuditLogs();
    } catch {
      alert("Błąd requestu do /api/admin/send-surprise");
    } finally {
      setSendingSurprise(false);
    }
  };

  const runUserAction = async (
    action: "add_vb" | "reset_balance" | "ban_user" | "unban_user" | "delete_user"
  ) => {
    if (!selectedUserId) {
      alert("Wybierz użytkownika.");
      return;
    }

    if (action === "delete_user") {
  alert(
    "Hard delete użytkownika jest tymczasowo wyłączony. Zrobimy później bezpieczne RPC do archiwizacji/usuwania konta."
  );
  return;
}

    if (action === "reset_balance") {
      const ok = confirm("Wyzerować saldo użytkownika?");
      if (!ok) return;
    }

    if (action === "ban_user") {
      const ok = confirm("Zbanować użytkownika?");
      if (!ok) return;
    }

    if (action === "unban_user") {
      const ok = confirm("Odbanować użytkownika?");
      if (!ok) return;
    }

    const normalizedAmount = manualAmount.replace(",", ".");
    const amount = Number(normalizedAmount);

    if (action === "add_vb" && (!Number.isFinite(amount) || amount <= 0)) {
      alert("Podaj poprawną dodatnią kwotę VB.");
      return;
    }

    try {
      setActionLoading(action);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("No session token");

      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action,
          targetUserId: selectedUserId,
          amount: action === "add_vb" ? amount : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data?.error ?? "Nie udało się wykonać akcji.");
        return;
      }

      if (action === "add_vb") {
        setManualAmount("");
      }

      alert("Akcja wykonana ✅");

      await loadUsers();
      await loadAuditLogs();
    } catch (e: any) {
      alert(e?.message ?? "Błąd akcji admina.");
    } finally {
      setActionLoading(null);
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
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin — rozliczanie kuponów</h1>
          <p className="text-neutral-400 mt-1 text-sm">
            Kliknij WON/LOST/VOID — baza dopisze wypłatę do salda.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/logs"
            className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
          >
            Zobacz logi cronów
          </Link>

          <Link
            href="/admin/surprises"
            className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
          >
            Wyślij niespodziankę
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold">Użytkownicy</div>
            <div className="text-xs text-neutral-400 mt-1">
              Saldo, status maila, statystyki, akcje admina i pełne usuwanie konta.
            </div>
          </div>

          <button
            onClick={loadUsers}
            disabled={usersLoading}
            className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm disabled:opacity-50"
          >
            {usersLoading ? "..." : "Odśwież users"}
          </button>
        </div>

        {users.length === 0 ? (
          <div className="text-sm text-neutral-400">
            Brak użytkowników lub nie udało się pobrać listy.
          </div>
        ) : (
          <>
            <div className="overflow-auto rounded-2xl border border-neutral-800">
              <table className="w-full text-sm min-w-[1200px]">
                <thead className="bg-neutral-950/70 text-neutral-400">
                  <tr className="border-b border-neutral-800">
                    <th className="text-left px-4 py-3">User</th>
                    <th className="text-left px-4 py-3">Email</th>
                    <th className="text-right px-4 py-3">Saldo</th>
                    <th className="text-left px-4 py-3">Mail status</th>
                    <th className="text-left px-4 py-3">Sent at</th>
                    <th className="text-left px-4 py-3">Confirmed at</th>
                    <th className="text-left px-4 py-3">Ban</th>
                    <th className="text-right px-4 py-3">Kupony</th>
                    <th className="text-right px-4 py-3">Profit</th>
                    <th className="text-right px-4 py-3">ROI</th>
                    <th className="text-right px-4 py-3">Winrate</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      onClick={() => {
                        setSelectedUserId(u.id);
                        setSurpriseEmail(u.email ?? "");
                      }}
                      className={[
                        "border-b border-neutral-800/70 cursor-pointer hover:bg-neutral-950/40",
                        selectedUserId === u.id ? "bg-neutral-950/50" : "",
                      ].join(" ")}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{u.username ?? "—"}</div>
                        <div className="text-xs text-neutral-500 mt-1">{u.id}</div>
                      </td>
                      <td className="px-4 py-3 text-neutral-200">{u.email ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold text-white">
                        {formatVB(u.balance_vb)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={[
                            "inline-flex rounded-full px-2.5 py-1 text-xs border",
                            u.email_confirmed_at
                              ? "border-green-500/30 bg-green-500/10 text-green-300"
                              : "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
                          ].join(" ")}
                        >
                          {u.email_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-300">
                        {fmtDate(u.email_confirmation_sent_at)}
                      </td>
                      <td className="px-4 py-3 text-neutral-300">
                        {fmtDate(u.email_confirmed_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={[
                            "inline-flex rounded-full px-2.5 py-1 text-xs border",
                            u.is_banned
                              ? "border-red-500/30 bg-red-500/10 text-red-300"
                              : "border-neutral-700 bg-neutral-950 text-neutral-300",
                          ].join(" ")}
                        >
                          {u.is_banned ? "banned" : "active"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-white">{u.bets_count}</td>
                      <td
                        className={[
                          "px-4 py-3 text-right font-semibold",
                          u.profit > 0
                            ? "text-green-400"
                            : u.profit < 0
                              ? "text-red-400"
                              : "text-white",
                        ].join(" ")}
                      >
                        {u.profit > 0 ? "+" : ""}
                        {u.profit.toFixed(2)} VB
                      </td>
                      <td className="px-4 py-3 text-right text-white">{fmtPct(u.roi)}</td>
                      <td className="px-4 py-3 text-right text-white">{fmtPct(u.winrate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-4">
              <div className="font-semibold">Akcje na wybranym użytkowniku</div>

              {!selectedUser ? (
                <div className="text-sm text-neutral-400">Wybierz użytkownika z tabeli.</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                      <div className="text-xs text-neutral-400">Username</div>
                      <div className="mt-1 font-semibold text-white">
                        {selectedUser.username ?? "—"}
                      </div>
                    </div>

                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                      <div className="text-xs text-neutral-400">Email</div>
                      <div className="mt-1 font-semibold text-white">
                        {selectedUser.email ?? "—"}
                      </div>
                    </div>

                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                      <div className="text-xs text-neutral-400">Saldo</div>
                      <div className="mt-1 font-semibold text-white">
                        {formatVB(selectedUser.balance_vb)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                      <div className="text-xs text-neutral-400">Status maila</div>
                      <div className="mt-1 font-semibold text-white">
                        {selectedUser.email_status}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-3 items-start">
                    <div className="space-y-1">
                      <div className="text-xs text-neutral-400">Dodaj VB</div>
                      <input
                        value={manualAmount}
                        onChange={(e) => setManualAmount(e.target.value.replace(/[^\d.,-]/g, ""))}
                        placeholder="np. 500"
                        className="w-full px-3 py-2 rounded-xl border border-neutral-800 bg-neutral-950 text-sm"
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => runUserAction("add_vb")}
                        disabled={actionLoading === "add_vb"}
                        className="px-4 py-2 rounded-xl border border-neutral-800 bg-green-700 hover:bg-green-600 transition text-sm disabled:opacity-50"
                      >
                        {actionLoading === "add_vb" ? "..." : "Dodaj VB"}
                      </button>

                      <button
                        onClick={() => runUserAction("reset_balance")}
                        disabled={actionLoading === "reset_balance"}
                        className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm disabled:opacity-50"
                      >
                        {actionLoading === "reset_balance" ? "..." : "Reset balance"}
                      </button>

                      <button
                        onClick={() =>
                          runUserAction(selectedUser.is_banned ? "unban_user" : "ban_user")
                        }
                        disabled={actionLoading === "ban_user" || actionLoading === "unban_user"}
                        className="px-4 py-2 rounded-xl border border-neutral-800 bg-yellow-700 hover:bg-yellow-600 transition text-sm disabled:opacity-50"
                      >
                        {actionLoading === "ban_user" || actionLoading === "unban_user"
                          ? "..."
                          : selectedUser.is_banned
                            ? "Unban user"
                            : "Ban user"}
                      </button>

                      <button
                          disabled
                          className="px-4 py-2 rounded-xl border border-red-900/30 bg-red-900/10 text-red-300/70 text-sm opacity-60 cursor-not-allowed"
                          title="Hard delete tymczasowo wyłączony do czasu wdrożenia bezpiecznego RPC"
                        >
                          Delete disabled
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold">Audit log admina</div>
            <div className="text-xs text-neutral-400 mt-1">
              Historia działań administracyjnych: podgląd users, dopisania VB, bany, usunięcia.
            </div>
          </div>

          <button
            onClick={loadAuditLogs}
            disabled={auditLoading}
            className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm disabled:opacity-50"
          >
            {auditLoading ? "..." : "Odśwież audit log"}
          </button>
        </div>

        {auditLogs.length === 0 ? (
          <div className="text-sm text-neutral-400">Brak wpisów audit log.</div>
        ) : (
          <div className="space-y-2">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-medium text-white">{log.action}</div>
                    <div className="text-xs text-neutral-500 mt-1">
                      admin: {log.admin_user_id}
                    </div>
                    <div className="text-xs text-neutral-500">
                      target: {log.target_user_id ?? "—"}
                    </div>
                  </div>

                  <div className="text-xs text-neutral-400">{fmtDate(log.created_at)}</div>
                </div>

                <pre className="mt-3 bg-black/30 border border-neutral-800 rounded-xl p-3 text-xs overflow-auto">
                  {JSON.stringify(log.details ?? {}, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>

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

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold">Auto-rozliczanie zaległych meczów</div>
            <div className="text-xs text-neutral-400 mt-1">
              Pobiera wyniki z football-data, zapisuje do match_results i rozlicza kupony (bez
              Edge/cron).
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
                  <span className="text-neutral-500">
                    (buffer: {settleStats.bufferMinutes} min)
                  </span>
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

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
        <div className="font-semibold">Wyślij niespodziankę</div>

        <div className="grid grid-cols-1 gap-3">
          <input
            value={surpriseEmail}
            onChange={(e) => setSurpriseEmail(e.target.value)}
            placeholder="Email użytkownika"
            className="px-3 py-2 rounded-xl border border-neutral-800 bg-neutral-950 text-sm"
          />

          <textarea
            value={surpriseMessage}
            onChange={(e) => setSurpriseMessage(e.target.value)}
            placeholder="Treść niespodzianki"
            className="px-3 py-2 rounded-xl border border-neutral-800 bg-neutral-950 text-sm min-h-[110px]"
          />

          <div>
            <button
              onClick={sendSurprise}
              disabled={sendingSurprise}
              className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm disabled:opacity-50"
            >
              {sendingSurprise ? "Wysyłanie..." : "Wyślij niespodziankę"}
            </button>
          </div>
        </div>

        {surpriseResult && (
          <pre className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-3 text-xs overflow-auto">
            {JSON.stringify(surpriseResult, null, 2)}
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
          await loadUsers();
          await loadAuditLogs();
        }}
        className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
      >
        Odśwież wszystko
      </button>
    </div>
  );
}