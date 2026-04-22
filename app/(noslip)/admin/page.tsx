"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SystemCheckPanel from "@/components/admin/SystemCheckPanel";
import { formatOdd, formatVB } from "@/lib/format";
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

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function fmtPct(v?: number | null) {
  return `${Number(v ?? 0).toFixed(2)}%`;
}

function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-3xl border border-neutral-800 bg-neutral-900/40 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]",
        className
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-neutral-400">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      <div className="mt-5">{children}</div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "green" | "yellow" | "red" | "blue";
}) {
  const toneClass =
    tone === "green"
      ? "border-green-500/20 bg-green-500/5"
      : tone === "yellow"
        ? "border-yellow-500/20 bg-yellow-500/5"
        : tone === "red"
          ? "border-red-500/20 bg-red-500/5"
          : tone === "blue"
            ? "border-blue-500/20 bg-blue-500/5"
            : "border-neutral-800 bg-neutral-950/70";

  return (
    <div className={cn("rounded-2xl border p-4", toneClass)}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
      {hint ? <div className="mt-2 text-xs text-neutral-400">{hint}</div> : null}
    </div>
  );
}

function StatusPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "yellow" | "red" | "blue";
}) {
  const toneClass =
    tone === "green"
      ? "border-green-500/30 bg-green-500/10 text-green-300"
      : tone === "yellow"
        ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
        : tone === "red"
          ? "border-red-500/30 bg-red-500/10 text-red-300"
          : tone === "blue"
            ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
            : "border-neutral-700 bg-neutral-950 text-neutral-300";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        toneClass
      )}
    >
      {children}
    </span>
  );
}

function SmallInfoCard({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium text-white break-words">{value}</div>
    </div>
  );
}

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [bets, setBets] = useState<Bet[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const [usersLoading, setUsersLoading] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [manualAmount, setManualAmount] = useState<string>("");
  const [userSearch, setUserSearch] = useState("");

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

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();

    if (!q) return users;

    return users.filter((u) => {
      const haystack = [
        u.username ?? "",
        u.email ?? "",
        u.id,
        u.email_status ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [users, userSearch]);

  const compactAuditLogs = useMemo(() => auditLogs.slice(0, 5), [auditLogs]);

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

      const token = await getAccessToken();

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
        setSurpriseEmail(nextUsers[0].email ?? "");
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

      const token = await getAccessToken();

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
    await loadAuditLogs();
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

      const token = await getAccessToken();

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

  const refreshEverything = async () => {
    await load();
    await refreshStats();
    await refreshHealth();
    await loadUsers();
    await loadAuditLogs();
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-8 text-neutral-400">
          Ładowanie...
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-8 text-neutral-300">
          Brak dostępu. To jest panel admina.
        </div>
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

  const selectedUserProfitTone =
    (selectedUser?.profit ?? 0) > 0
      ? "green"
      : (selectedUser?.profit ?? 0) < 0
        ? "red"
        : "neutral";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="rounded-[28px] border border-neutral-800 bg-gradient-to-br from-neutral-900 via-neutral-950 to-black p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
              VirtualBook Admin
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Control Center
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">
              Narzędziowy panel operacyjny do zarządzania użytkownikami, diagnostyką
              systemu, rozliczaniem zakładów i szybką kontrolą spójności wallet /
              ledger / bets / settlement.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={refreshEverything}
              className="rounded-2xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-white transition hover:bg-neutral-800"
            >
              Odśwież wszystko
            </button>

            <Link
              href="/admin/logs"
              className="rounded-2xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-white transition hover:bg-neutral-800"
            >
              Pełne logi
            </Link>

            <Link
              href="/admin/surprises"
              className="rounded-2xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-white transition hover:bg-neutral-800"
            >
              Centrum niespodzianek
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Użytkownicy"
            value={users.length}
            hint={usersLoading ? "Trwa synchronizacja listy users" : "Konta dostępne w panelu"}
            tone="blue"
          />

          <MetricCard
            label="Wybrany użytkownik"
            value={selectedUser ? formatVB(selectedUser.balance_vb) : "—"}
            hint={
              selectedUser
                ? `${selectedUser.username ?? "Brak username"} • ${selectedUser.email ?? "brak email"}`
                : "Wybierz użytkownika z tabeli"
            }
            tone={selectedUser ? "green" : "neutral"}
          />

          <MetricCard
            label="System Health"
            value={healthBad === 0 ? "HEALTHY" : `ALERT ${healthBad}`}
            hint="Szybki stan spójności systemu"
            tone={healthBad === 0 ? "green" : "yellow"}
          />

          <MetricCard
            label="Rozliczenie meczów"
            value={`${readyMatches}`}
            hint={`Gotowe mecze: ${readyMatches} • pozycje: ${readyItems}`}
            tone={readyMatches > 0 ? "yellow" : "neutral"}
          />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <SectionCard
          title="Użytkownicy i operacje na koncie"
          description="Tabela operacyjna użytkowników z wyszukiwaniem, kartą szczegółów i szybkimi akcjami administracyjnymi."
          action={
            <button
              onClick={loadUsers}
              disabled={usersLoading}
              className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-white transition hover:bg-neutral-800 disabled:opacity-50"
            >
              {usersLoading ? "Synchronizuję..." : "Odśwież użytkowników"}
            </button>
          }
        >
          <div className="grid gap-5 2xl:grid-cols-[1.3fr_0.95fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">Wyszukiwarka users</div>
                    <div className="mt-1 text-xs text-neutral-400">
                      Szukaj po username, emailu, ID lub statusie maila.
                    </div>
                  </div>

                  <div className="w-full sm:w-80">
                    <input
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Szukaj użytkownika..."
                      className="w-full rounded-2xl border border-neutral-800 bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-neutral-600"
                    />
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-neutral-800">
                <div className="max-h-[560px] overflow-auto">
                  <table className="w-full min-w-[980px] text-sm">
                    <thead className="sticky top-0 z-10 bg-neutral-950 text-neutral-400">
                      <tr className="border-b border-neutral-800">
                        <th className="px-4 py-3 text-left font-medium">User</th>
                        <th className="px-4 py-3 text-left font-medium">Email</th>
                        <th className="px-4 py-3 text-right font-medium">Saldo</th>
                        <th className="px-4 py-3 text-left font-medium">Mail</th>
                        <th className="px-4 py-3 text-left font-medium">Ban</th>
                        <th className="px-4 py-3 text-right font-medium">Kupony</th>
                        <th className="px-4 py-3 text-right font-medium">ROI</th>
                        <th className="px-4 py-3 text-right font-medium">Winrate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-4 py-10 text-center text-sm text-neutral-500"
                          >
                            Brak użytkowników pasujących do filtra.
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((u) => (
                          <tr
                            key={u.id}
                            onClick={() => {
                              setSelectedUserId(u.id);
                              setSurpriseEmail(u.email ?? "");
                            }}
                            className={cn(
                              "cursor-pointer border-b border-neutral-800/70 transition hover:bg-neutral-950/40",
                              selectedUserId === u.id && "bg-neutral-950/60"
                            )}
                          >
                            <td className="px-4 py-3">
                              <div className="font-medium text-white">
                                {u.username ?? "—"}
                              </div>
                              <div className="mt-1 text-xs text-neutral-500">{u.id}</div>
                            </td>

                            <td className="px-4 py-3 text-neutral-200">{u.email ?? "—"}</td>

                            <td className="px-4 py-3 text-right font-semibold text-white">
                              {formatVB(u.balance_vb)}
                            </td>

                            <td className="px-4 py-3">
                              {u.email_confirmed_at ? (
                                <StatusPill tone="green">mail confirmed</StatusPill>
                              ) : (
                                <StatusPill tone="yellow">confirmation sent</StatusPill>
                              )}
                            </td>

                            <td className="px-4 py-3">
                              {u.is_banned ? (
                                <StatusPill tone="red">banned</StatusPill>
                              ) : (
                                <StatusPill>active</StatusPill>
                              )}
                            </td>

                            <td className="px-4 py-3 text-right text-white">{u.bets_count}</td>
                            <td className="px-4 py-3 text-right text-white">
                              {fmtPct(u.roi)}
                            </td>
                            <td className="px-4 py-3 text-right text-white">
                              {fmtPct(u.winrate)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">
                      Karta wybranego użytkownika
                    </div>
                    <div className="mt-1 text-xs text-neutral-400">
                      Szybkie informacje i operacje kontekstowe.
                    </div>
                  </div>

                  {selectedUser ? (
                    selectedUser.is_banned ? (
                      <StatusPill tone="red">konto zbanowane</StatusPill>
                    ) : (
                      <StatusPill tone="green">konto aktywne</StatusPill>
                    )
                  ) : (
                    <StatusPill>brak wyboru</StatusPill>
                  )}
                </div>

                {!selectedUser ? (
                  <div className="mt-4 rounded-2xl border border-dashed border-neutral-800 bg-black/20 p-6 text-sm text-neutral-500">
                    Wybierz użytkownika z tabeli po lewej stronie.
                  </div>
                ) : (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <SmallInfoCard
                        label="Username"
                        value={selectedUser.username ?? "—"}
                      />
                      <SmallInfoCard label="Email" value={selectedUser.email ?? "—"} />
                      <SmallInfoCard
                        label="Saldo"
                        value={`${formatVB(selectedUser.balance_vb)} VB`}
                      />
                      <SmallInfoCard
                        label="Mail status"
                        value={selectedUser.email_status}
                      />
                      <SmallInfoCard
                        label="Email sent"
                        value={fmtDate(selectedUser.email_confirmation_sent_at)}
                      />
                      <SmallInfoCard
                        label="Email confirmed"
                        value={fmtDate(selectedUser.email_confirmed_at)}
                      />
                      <SmallInfoCard
                        label="Created at"
                        value={fmtDate(selectedUser.created_at)}
                      />
                      <SmallInfoCard
                        label="Last sign in"
                        value={fmtDate(selectedUser.last_sign_in_at)}
                      />
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <MetricCard
                        label="Kupony"
                        value={selectedUser.bets_count}
                        hint={`Won: ${selectedUser.won_bets} • Lost: ${selectedUser.lost_bets} • Void: ${selectedUser.void_bets}`}
                        tone="blue"
                      />
                      <MetricCard
                        label="Profit"
                        value={`${selectedUser.profit > 0 ? "+" : ""}${selectedUser.profit.toFixed(2)} VB`}
                        hint={`ROI: ${fmtPct(selectedUser.roi)}`}
                        tone={selectedUserProfitTone}
                      />
                      <MetricCard
                        label="Winrate"
                        value={fmtPct(selectedUser.winrate)}
                        hint={`ID: ${selectedUser.id.slice(0, 8)}...`}
                        tone="neutral"
                      />
                    </div>

                    <div className="mt-4 rounded-2xl border border-neutral-800 bg-black/20 p-4">
                      <div className="text-sm font-medium text-white">Akcje konta</div>
                      <div className="mt-1 text-xs text-neutral-400">
                        Operacje finansowe i statusowe na wybranym użytkowniku.
                      </div>

                      <div className="mt-4 grid gap-3 lg:grid-cols-[190px_1fr]">
                        <div>
                          <div className="mb-1.5 text-xs text-neutral-400">Kwota VB</div>
                          <input
                            value={manualAmount}
                            onChange={(e) =>
                              setManualAmount(e.target.value.replace(/[^\d.,-]/g, ""))
                            }
                            placeholder="np. 500"
                            className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-neutral-600"
                          />
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => runUserAction("add_vb")}
                            disabled={actionLoading === "add_vb"}
                            className="rounded-2xl border border-green-700/40 bg-green-700 px-4 py-2.5 text-sm text-white transition hover:bg-green-600 disabled:opacity-50"
                          >
                            {actionLoading === "add_vb" ? "Trwa..." : "Dodaj VB"}
                          </button>

                          <button
                            onClick={() => runUserAction("reset_balance")}
                            disabled={actionLoading === "reset_balance"}
                            className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm text-white transition hover:bg-neutral-800 disabled:opacity-50"
                          >
                            {actionLoading === "reset_balance" ? "Trwa..." : "Reset salda"}
                          </button>

                          <button
                            onClick={() =>
                              runUserAction(
                                selectedUser.is_banned ? "unban_user" : "ban_user"
                              )
                            }
                            disabled={
                              actionLoading === "ban_user" ||
                              actionLoading === "unban_user"
                            }
                            className="rounded-2xl border border-yellow-700/40 bg-yellow-700 px-4 py-2.5 text-sm text-white transition hover:bg-yellow-600 disabled:opacity-50"
                          >
                            {actionLoading === "ban_user" ||
                            actionLoading === "unban_user"
                              ? "Trwa..."
                              : selectedUser.is_banned
                                ? "Unban user"
                                : "Ban user"}
                          </button>

                          <button
                            disabled
                            title="Hard delete tymczasowo wyłączony do czasu wdrożenia bezpiecznego RPC"
                            className="cursor-not-allowed rounded-2xl border border-red-900/30 bg-red-900/10 px-4 py-2.5 text-sm text-red-300/70 opacity-60"
                          >
                            Delete disabled
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-neutral-800 bg-black/20 p-4">
                      <div className="text-sm font-medium text-white">Szybka niespodzianka</div>
                      <div className="mt-1 text-xs text-neutral-400">
                        Szybka wysyłka do aktualnie wybranego użytkownika.
                      </div>

                      <div className="mt-4 grid gap-3">
                        <input
                          value={surpriseEmail}
                          onChange={(e) => setSurpriseEmail(e.target.value)}
                          placeholder="Email użytkownika"
                          className="rounded-2xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-neutral-600"
                        />

                        <textarea
                          value={surpriseMessage}
                          onChange={(e) => setSurpriseMessage(e.target.value)}
                          placeholder="Treść niespodzianki"
                          className="min-h-[120px] rounded-2xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-neutral-600"
                        />

                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={sendSurprise}
                            disabled={sendingSurprise}
                            className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm text-white transition hover:bg-neutral-800 disabled:opacity-50"
                          >
                            {sendingSurprise ? "Wysyłanie..." : "Wyślij niespodziankę"}
                          </button>

                          <Link
                            href="/admin/surprises"
                            className="rounded-2xl border border-neutral-800 bg-black/20 px-4 py-2.5 text-sm text-neutral-300 transition hover:bg-neutral-900"
                          >
                            Otwórz pełny moduł
                          </Link>
                        </div>

                        {surpriseResult ? (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-neutral-400 hover:text-white">
                              Pokaż wynik requestu
                            </summary>
                            <pre className="mt-2 overflow-auto rounded-xl border border-neutral-800 bg-black/30 p-3">
                              {JSON.stringify(surpriseResult, null, 2)}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </SectionCard>

        <div className="space-y-6">
          <SectionCard
            title="Centrum operacyjne"
            description="Najważniejsze akcje diagnostyczne i rozliczeniowe zebrane w jednym miejscu."
          >
            <div className="space-y-4">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">System Health</div>
                    <div className="mt-1 text-xs text-neutral-400">
                      Monitoring spójności: mecze utkwione, nierozliczone pozycje,
                      pominięte kupony, brak payout w ledger.
                    </div>
                  </div>

                  <button
                    onClick={refreshHealth}
                    disabled={healthLoading}
                    className="rounded-2xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white transition hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {healthLoading ? "..." : "Odśwież"}
                  </button>
                </div>

                {!health ? (
                  <div className="mt-4 text-sm text-neutral-500">
                    Brak danych / nie udało się pobrać.
                  </div>
                ) : !health.ok ? (
                  <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                    Błąd: {health.error ?? "unknown"}
                  </div>
                ) : (
                  <>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <StatusPill tone={healthBad === 0 ? "green" : "yellow"}>
                        {healthBad === 0 ? "HEALTHY" : "ATTENTION"}
                      </StatusPill>
                      <StatusPill>stuck: {hm?.stuckMatches ?? 0}</StatusPill>
                      <StatusPill>
                        finished+unsettled: {hm?.finishedMatchesWithUnsettledItems ?? 0}
                      </StatusPill>
                      <StatusPill>
                        pending-ready: {hm?.pendingButAllItemsSettled ?? 0}
                      </StatusPill>
                      <StatusPill tone={(hm?.missingPayoutLedger ?? 0) > 0 ? "red" : "neutral"}>
                        missing payout: {hm?.missingPayoutLedger ?? 0}
                      </StatusPill>
                    </div>

                    <details className="mt-4 text-xs">
                      <summary className="cursor-pointer text-neutral-400 hover:text-white">
                        Pokaż sample (debug)
                      </summary>
                      <pre className="mt-2 overflow-auto rounded-xl border border-neutral-800 bg-black/30 p-3">
                        {JSON.stringify(health.samples, null, 2)}
                      </pre>
                    </details>
                  </>
                )}
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">
                      Auto-rozliczanie zaległych meczów
                    </div>
                    <div className="mt-1 text-xs text-neutral-400">
                      Pobiera wyniki z football-data, zapisuje do match_results i rozlicza
                      kupony bez edge/cron.
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={refreshStats}
                      disabled={statsLoading}
                      className="rounded-2xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white transition hover:bg-neutral-800 disabled:opacity-50"
                    >
                      {statsLoading ? "..." : "Sprawdź"}
                    </button>

                    <button
                      onClick={runAutoSettle}
                      disabled={autoLoading || readyMatches <= 0}
                      title={
                        readyMatches <= 0
                          ? "Brak meczów do rozliczenia"
                          : "Uruchom auto-rozliczanie"
                      }
                      className="rounded-2xl border border-green-700/40 bg-green-700 px-3 py-2 text-sm text-white transition hover:bg-green-600 disabled:opacity-50"
                    >
                      {autoLoading ? "Rozliczanie..." : "Uruchom"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <MetricCard
                    label="Do rozliczenia"
                    value={readyMatches}
                    hint="Liczba meczów gotowych do settle"
                    tone={readyMatches > 0 ? "yellow" : "neutral"}
                  />
                  <MetricCard
                    label="Pozycje"
                    value={readyItems}
                    hint="Łączna liczba pozycji kuponów"
                    tone="blue"
                  />
                  <MetricCard
                    label="Buffer"
                    value={`${settleStats?.bufferMinutes ?? 10} min`}
                    hint={settleStats?.cutoffIso ? `cutoff: ${fmtDate(settleStats.cutoffIso)}` : "Brak cutoff"}
                    tone="neutral"
                  />
                </div>

                {autoResult ? (
                  <details className="mt-4 text-xs">
                    <summary className="cursor-pointer text-neutral-400 hover:text-white">
                      Pokaż wynik auto-rozliczania
                    </summary>
                    <pre className="mt-2 overflow-auto rounded-xl border border-neutral-800 bg-black/30 p-3">
                      {JSON.stringify(autoResult, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Link
                  href="/admin/logs"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 transition hover:bg-neutral-900"
                >
                  <div className="text-sm font-semibold text-white">Pełne logi</div>
                  <div className="mt-1 text-xs text-neutral-400">
                    Otwórz dedykowaną stronę z logami systemowymi.
                  </div>
                </Link>

                <Link
                  href="/admin/surprises"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 transition hover:bg-neutral-900"
                >
                  <div className="text-sm font-semibold text-white">Niespodzianki</div>
                  <div className="mt-1 text-xs text-neutral-400">
                    Osobny moduł do zarządzania wiadomościami i akcjami specjalnymi.
                  </div>
                </Link>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Ostatnie działania admina"
            description="Kompaktowy podgląd ostatnich wpisów. Pełna historia jest na osobnej stronie."
            action={
              <div className="flex gap-2">
                <button
                  onClick={loadAuditLogs}
                  disabled={auditLoading}
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-white transition hover:bg-neutral-800 disabled:opacity-50"
                >
                  {auditLoading ? "..." : "Odśwież"}
                </button>

                <Link
                  href="/admin/logs"
                  className="rounded-2xl border border-neutral-800 bg-black/20 px-4 py-2 text-sm text-neutral-300 transition hover:bg-neutral-900"
                >
                  Zobacz wszystko
                </Link>
              </div>
            }
          >
            {compactAuditLogs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-neutral-800 bg-black/20 p-6 text-sm text-neutral-500">
                Brak wpisów audit log.
              </div>
            ) : (
              <div className="space-y-3">
                {compactAuditLogs.map((log) => (
                  <details
                    key={log.id}
                    className="group rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4"
                  >
                    <summary className="flex cursor-pointer list-none flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-white">{log.action}</span>
                          <StatusPill>{fmtDate(log.created_at)}</StatusPill>
                        </div>

                        <div className="mt-2 text-xs text-neutral-500">
                          admin: {log.admin_user_id}
                        </div>
                        <div className="text-xs text-neutral-500">
                          target: {log.target_user_id ?? "—"}
                        </div>
                      </div>

                      <span className="text-xs text-neutral-500 transition group-open:rotate-180">
                        ▼
                      </span>
                    </summary>

                    <pre className="mt-4 overflow-auto rounded-xl border border-neutral-800 bg-black/30 p-3 text-xs">
                      {JSON.stringify(log.details ?? {}, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <SystemCheckPanel />

      <SectionCard
        title="Ostatnie kupony"
        description="Skrócony stół operacyjny do szybkiej weryfikacji i ręcznego rozliczania kuponów."
        action={
          <button
            onClick={load}
            className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-white transition hover:bg-neutral-800"
          >
            Odśwież kupony
          </button>
        }
      >
        {bets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-800 bg-black/20 p-8 text-sm text-neutral-500">
            Brak kuponów.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-neutral-800">
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <thead className="sticky top-0 z-10 bg-neutral-950 text-neutral-400">
                  <tr className="border-b border-neutral-800">
                    <th className="px-4 py-3 text-left font-medium">Czas</th>
                    <th className="px-4 py-3 text-left font-medium">Bet ID</th>
                    <th className="px-4 py-3 text-left font-medium">User</th>
                    <th className="px-4 py-3 text-right font-medium">Stawka</th>
                    <th className="px-4 py-3 text-right font-medium">Kurs</th>
                    <th className="px-4 py-3 text-right font-medium">Wygrana</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Settled</th>
                    <th className="px-4 py-3 text-right font-medium">Akcje</th>
                  </tr>
                </thead>
                <tbody>
                  {bets.map((b) => (
                    <tr
                      key={b.id}
                      className="border-b border-neutral-800/70 hover:bg-neutral-950/40"
                    >
                      <td className="px-4 py-3 text-neutral-300">
                        {fmtDate(b.created_at)}
                      </td>

                      <td className="px-4 py-3 text-neutral-300">{b.id}</td>

                      <td className="px-4 py-3 text-neutral-300">{b.user_id}</td>

                      <td className="px-4 py-3 text-right font-semibold text-white">
                        {formatVB(b.stake)} VB
                      </td>

                      <td className="px-4 py-3 text-right font-semibold text-white">
                        {formatOdd(b.total_odds)}
                      </td>

                      <td className="px-4 py-3 text-right font-semibold text-white">
                        {formatVB(b.potential_win)} VB
                      </td>

                      <td className="px-4 py-3">
                        <StatusPill
                          tone={
                            b.status === "won"
                              ? "green"
                              : b.status === "lost"
                                ? "red"
                                : b.status === "void"
                                  ? "yellow"
                                  : "neutral"
                          }
                        >
                          {String(b.status).toUpperCase()}
                        </StatusPill>
                      </td>

                      <td className="px-4 py-3">
                        {b.settled ? (
                          <StatusPill tone="green">TAK</StatusPill>
                        ) : (
                          <StatusPill>NIe</StatusPill>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            disabled={b.settled}
                            onClick={() => settle(b.id, "won")}
                            className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white transition hover:bg-neutral-800 disabled:opacity-50"
                          >
                            WON
                          </button>

                          <button
                            disabled={b.settled}
                            onClick={() => settle(b.id, "lost")}
                            className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white transition hover:bg-neutral-800 disabled:opacity-50"
                          >
                            LOST
                          </button>

                          <button
                            disabled={b.settled}
                            onClick={() => settle(b.id, "void")}
                            className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white transition hover:bg-neutral-800 disabled:opacity-50"
                          >
                            VOID
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}