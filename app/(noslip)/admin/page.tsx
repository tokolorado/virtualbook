// app/(noslip)/admin/page.tsx
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

type SystemCheckRun = {
  id: number;
  started_at: string;
  finished_at: string | null;
  started_by: string | null;
  source: string;
  status: "running" | "success" | "failed";
  ok: boolean | null;
  checks_total: number;
  checks_passed: number;
  checks_failed: number;
  summary: any;
  error: string | null;
};

type SystemCheckResult = {
  id: number;
  run_id: number;
  check_key: string;
  severity: "info" | "warning" | "critical";
  ok: boolean;
  rows_count: number;
  sample: unknown[];
  details: Record<string, unknown>;
  created_at: string;
};

type ViewKey =
  | "overview"
  | "users"
  | "diagnostics"
  | "settlement"
  | "audit"
  | "bets";

type NoticeTone = "success" | "error" | "info";
type MetricTone = "neutral" | "green" | "yellow" | "red" | "blue";

const NAV_ITEMS: Array<{
  key: ViewKey;
  label: string;
  short: string;
  description: string;
}> = [
  {
    key: "overview",
    label: "Przegląd",
    short: "OV",
    description: "Główne KPI, skróty i stan operacyjny",
  },
  {
    key: "users",
    label: "Użytkownicy",
    short: "US",
    description: "Lista users, karta konta i akcje",
  },
  {
    key: "diagnostics",
    label: "Diagnostyka",
    short: "DG",
    description: "System Health i System Check",
  },
  {
    key: "settlement",
    label: "Settlement",
    short: "ST",
    description: "Auto-settle i rozliczanie kuponów",
  },
  {
    key: "audit",
    label: "Audit",
    short: "AU",
    description: "Ostatnie działania administratorów",
  },
  {
    key: "bets",
    label: "Kupony",
    short: "BT",
    description: "Ostatnie kupony i szybka kontrola",
  },
];

const VIEW_META: Record<
  ViewKey,
  { title: string; description: string; helper: string }
> = {
  overview: {
    title: "Control Center",
    description:
      "Jedno miejsce do zarządzania użytkownikami, zdrowiem systemu i operacjami krytycznymi.",
    helper: "Widok strategiczny",
  },
  users: {
    title: "Użytkownicy",
    description:
      "Karta operacyjna users z wyszukiwaniem, danymi konta i akcjami administracyjnymi.",
    helper: "Praca na kontach",
  },
  diagnostics: {
    title: "Diagnostyka",
    description:
      "Monitoring spójności wallet / ledger / bets / settlement oraz szybkie checki systemowe.",
    helper: "Health + checks",
  },
  settlement: {
    title: "Settlement",
    description:
      "Auto-rozliczanie zaległych meczów i ręczne operacje na kuponach.",
    helper: "Rozliczenia",
  },
  audit: {
    title: "Audit",
    description:
      "Kompaktowy wgląd w ostatnie działania administratorów i szybkie przejście do pełnych logów.",
    helper: "Historia operacji",
  },
  bets: {
    title: "Kupony",
    description:
      "Ostatnie kupony, statusy i szybka weryfikacja najnowszych wpisów.",
    helper: "Monitoring kuponów",
  },
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pl-PL");
}

function fmtDateCompact(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function fmtPct(v?: number | null) {
  return `${Number(v ?? 0).toFixed(2)}%`;
}

function getNoticeToneClass(tone: NoticeTone) {
  if (tone === "success") {
    return "border-green-500/30 bg-green-500/10 text-green-300";
  }
  if (tone === "error") {
    return "border-red-500/30 bg-red-500/10 text-red-300";
  }
  return "border-blue-500/30 bg-blue-500/10 text-blue-300";
}

function severityRank(severity: "info" | "warning" | "critical") {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function getSeverityTone(
  severity: "info" | "warning" | "critical"
): MetricTone {
  if (severity === "critical") return "red";
  if (severity === "warning") return "yellow";
  return "blue";
}

function getBetStatusTone(status: string): MetricTone {
  const s = String(status || "").toLowerCase();
  if (s === "won") return "green";
  if (s === "lost") return "red";
  if (s === "void") return "yellow";
  return "neutral";
}

function SurfaceCard({
  children,
  className,
}: {
  children: ReactNode;
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

function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
  valueClassName = "",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: MetricTone;
  valueClassName?: string;
}) {
  const toneClass =
    tone === "green"
      ? "border-green-500/20 bg-green-500/10"
      : tone === "yellow"
        ? "border-yellow-500/20 bg-yellow-500/10"
        : tone === "red"
          ? "border-red-500/20 bg-red-500/10"
          : tone === "blue"
            ? "border-sky-500/20 bg-sky-500/10"
            : "border-neutral-800 bg-neutral-950/80";

  return (
    <div className={cn("rounded-3xl border p-4", toneClass)}>
      <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">
        {label}
      </div>

      <div
        className={cn(
          "mt-3 break-words text-2xl font-semibold leading-tight text-white",
          valueClassName
        )}
      >
        {value}
      </div>

      {hint ? <div className="mt-2 text-xs text-neutral-400">{hint}</div> : null}
    </div>
  );
}

function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <SurfaceCard className={cn("p-4 sm:p-5", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-neutral-400">
              {description}
            </p>
          ) : null}
        </div>

        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>

      <div className="mt-4">{children}</div>
    </SurfaceCard>
  );
}

function StatusPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: MetricTone;
}) {
  const toneClass =
    tone === "green"
      ? "border-green-500/30 bg-green-500/10 text-green-300"
      : tone === "yellow"
        ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
        : tone === "red"
          ? "border-red-500/30 bg-red-500/10 text-red-300"
          : tone === "blue"
            ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
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

function AttentionDot({ show }: { show: boolean }) {
  if (!show) return null;

  return (
    <span
      className="inline-flex h-2.5 w-2.5 rounded-full bg-yellow-400 shadow-[0_0_18px_rgba(250,204,21,0.65)]"
      title="Są mecze wymagające review"
    />
  );
}

function InfoField({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </div>
      <div className="mt-2 break-words text-sm font-medium text-white">
        {value}
      </div>
    </div>
  );
}

function SidebarItem({
  active,
  label,
  description,
  short,
  onClick,
}: {
  active: boolean;
  label: string;
  description: string;
  short: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-2xl border px-3 py-3 text-left transition",
        active
          ? "border-white/15 bg-white text-black shadow-[0_12px_40px_rgba(255,255,255,0.08)]"
          : "border-neutral-800 bg-neutral-950/80 text-neutral-200 hover:border-neutral-700 hover:bg-neutral-900"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-2xl border text-xs font-semibold",
            active
              ? "border-black/10 bg-black/5 text-black"
              : "border-neutral-800 bg-neutral-950 text-neutral-400"
          )}
        >
          {short}
        </div>

        <div className="min-w-0">
          <div className="font-semibold">{label}</div>
          <div
            className={cn(
              "mt-1 text-xs leading-5",
              active ? "text-black/60" : "text-neutral-500"
            )}
          >
            {description}
          </div>
        </div>
      </div>
    </button>
  );
}

function ActionCard({
  title,
  description,
  children,
  onClick,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-3xl border border-neutral-800 bg-neutral-950/80 p-4 text-left transition hover:border-neutral-700 hover:bg-neutral-900"
    >
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-1 text-xs leading-5 text-neutral-400">
        {description}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </button>
  );
}

function LinkCard({
  href,
  title,
  description,
  children,
}: {
  href: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-3xl border border-neutral-800 bg-neutral-950/80 p-4 transition hover:border-neutral-700 hover:bg-neutral-900"
    >
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-1 text-xs leading-5 text-neutral-400">
        {description}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </Link>
  );
}

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [bets, setBets] = useState<Bet[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [settleStats, setSettleStats] = useState<SettleStats | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [mappingReviewCount, setMappingReviewCount] = useState(0);

  const [usersLoading, setUsersLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [autoResult, setAutoResult] = useState<any>(null);

  const [selectedUserId, setSelectedUserId] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [userSearch, setUserSearch] = useState("");

  const [surpriseEmail, setSurpriseEmail] = useState("");
  const [surpriseMessage, setSurpriseMessage] = useState("");
  const [sendingSurprise, setSendingSurprise] = useState(false);
  const [surpriseResult, setSurpriseResult] = useState<any>(null);

  const [activeView, setActiveView] = useState<ViewKey>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [systemCheckLoading, setSystemCheckLoading] = useState(false);
  const [systemCheckRunning, setSystemCheckRunning] = useState(false);
  const [systemCheckError, setSystemCheckError] = useState<string | null>(null);
  const [systemCheckRun, setSystemCheckRun] = useState<SystemCheckRun | null>(
    null
  );
  const [systemCheckResults, setSystemCheckResults] = useState<
    SystemCheckResult[]
  >([]);

  const [betFilter, setBetFilter] = useState<
    "all" | "pending" | "won" | "lost" | "void"
  >("all");
  const [betSearch, setBetSearch] = useState("");

  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    tone: NoticeTone;
    message: string;
  } | null>(null);

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

  const filteredBets = useMemo(() => {
    const q = betSearch.trim().toLowerCase();

    return bets.filter((b) => {
      const statusMatch =
        betFilter === "all"
          ? true
          : String(b.status).toLowerCase() === betFilter;

      const queryMatch = q
        ? [b.id, b.user_id, b.status, String(b.stake), String(b.total_odds)]
            .join(" ")
            .toLowerCase()
            .includes(q)
        : true;

      return statusMatch && queryMatch;
    });
  }, [bets, betFilter, betSearch]);

  const sortedSystemCheckResults = useMemo(() => {
    return [...systemCheckResults].sort((a, b) => {
      if (a.ok !== b.ok) return a.ok ? 1 : -1;
      return severityRank(a.severity) - severityRank(b.severity);
    });
  }, [systemCheckResults]);

  const recentAuditLogs = useMemo(() => auditLogs.slice(0, 6), [auditLogs]);

  const pendingBetsCount = useMemo(
    () => bets.filter((b) => !b.settled).length,
    [bets]
  );

  const bannedUsersCount = useMemo(
    () => users.filter((u) => u.is_banned).length,
    [users]
  );

  const confirmedUsersCount = useMemo(
    () => users.filter((u) => !!u.email_confirmed_at).length,
    [users]
  );

  const selectedUserProfitTone: MetricTone =
    (selectedUser?.profit ?? 0) > 0
      ? "green"
      : (selectedUser?.profit ?? 0) < 0
        ? "red"
        : "neutral";

  const readyMatches = settleStats?.readyMatches ?? 0;
  const readyItems = settleStats?.readyItems ?? 0;

  const hm = health?.metrics;
  const healthBad =
    (hm?.stuckMatches ?? 0) +
    (hm?.finishedMatchesWithUnsettledItems ?? 0) +
    (hm?.pendingButAllItemsSettled ?? 0) +
    (hm?.missingPayoutLedger ?? 0);

  const activeMeta = VIEW_META[activeView];

  const getAccessToken = async (): Promise<string> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("No session token");
    return token;
  };

  const loadMappingReviewCount = async () => {
    try {
      const token = await getAccessToken();

      const res = await fetch("/api/admin/match-mapping/review-count", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setMappingReviewCount(0);
        return;
      }

      const count = Number(data?.count ?? 0);
      setMappingReviewCount(Number.isFinite(count) ? count : 0);
    } catch {
      setMappingReviewCount(0);
    }
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
      .select(
        "id,user_id,stake,total_odds,potential_win,status,settled,created_at"
      )
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
      setNotice({
        tone: "error",
        message: "Nie udało się pobrać listy użytkowników.",
      });
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

  const loadSystemCheckLatest = async () => {
    try {
      setSystemCheckLoading(true);
      setSystemCheckError(null);

      const token = await getAccessToken();

      const res = await fetch("/api/admin/system-check/latest", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data?.error ?? "Nie udało się pobrać wyników System Check."
        );
      }

      setSystemCheckRun((data.run ?? null) as SystemCheckRun | null);
      setSystemCheckResults((data.results ?? []) as SystemCheckResult[]);
    } catch (e: any) {
      setSystemCheckError(
        e?.message ?? "Nie udało się pobrać wyników System Check."
      );
      setSystemCheckRun(null);
      setSystemCheckResults([]);
    } finally {
      setSystemCheckLoading(false);
    }
  };

  const runSystemCheck = async () => {
    try {
      setSystemCheckRunning(true);
      setSystemCheckError(null);

      const token = await getAccessToken();

      const res = await fetch("/api/admin/system-check/run", {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error ?? "Nie udało się uruchomić System Check.");
      }

      await Promise.allSettled([loadSystemCheckLatest(), loadAuditLogs()]);
      setNotice({
        tone: "success",
        message: "System Check zakończony ✅",
      });
      setActiveView("diagnostics");
    } catch (e: any) {
      const message = e?.message ?? "Nie udało się uruchomić System Check.";
      setSystemCheckError(message);
      setNotice({
        tone: "error",
        message,
      });
    } finally {
      setSystemCheckRunning(false);
    }
  };

  const settle = async (betId: string, status: "won" | "lost" | "void") => {
    const ok = confirm(`Rozliczyć kupon jako: ${status.toUpperCase()} ?`);
    if (!ok) return;

    const { error } = await supabase.rpc("settle_bet", {
      p_bet_id: betId,
      p_status: status,
    } as any);

    if (error) {
      setNotice({
        tone: "error",
        message: error.message,
      });
      return;
    }

    setNotice({
      tone: "success",
      message: "Rozliczono kupon ✅",
    });

    await Promise.allSettled([
      load(),
      refreshStats(),
      refreshHealth(),
      loadAuditLogs(),
      loadSystemCheckLatest(),
    ]);
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
        setNotice({
          tone: "error",
          message: data?.error ?? "Błąd auto-rozliczania.",
        });
        return;
      }

      setNotice({
        tone: "success",
        message: "Auto-rozliczanie zakończone ✅",
      });

      await Promise.allSettled([
        load(),
        refreshStats(),
        refreshHealth(),
        loadAuditLogs(),
        loadSystemCheckLatest(),
      ]);
    } catch (e: any) {
      console.error(e);
      setNotice({
        tone: "error",
        message: "Błąd requestu do /api/admin/run-settle",
      });
    } finally {
      setAutoLoading(false);
    }
  };

  const sendSurprise = async () => {
    const email = surpriseEmail.trim().toLowerCase();
    const message = surpriseMessage.trim();

    if (!email) {
      setNotice({
        tone: "error",
        message: "Podaj email użytkownika.",
      });
      return;
    }

    if (!message) {
      setNotice({
        tone: "error",
        message: "Podaj treść niespodzianki.",
      });
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
        setNotice({
          tone: "error",
          message: data?.error ?? "Nie udało się wysłać niespodzianki.",
        });
        return;
      }

      setNotice({
        tone: "success",
        message: "Niespodzianka zapisana ✅",
      });

      await loadAuditLogs();
    } catch {
      setNotice({
        tone: "error",
        message: "Błąd requestu do /api/admin/send-surprise",
      });
    } finally {
      setSendingSurprise(false);
    }
  };

  const runUserAction = async (
    action: "add_vb" | "reset_balance" | "ban_user" | "unban_user" | "delete_user"
  ) => {
    if (!selectedUserId) {
      setNotice({
        tone: "error",
        message: "Wybierz użytkownika.",
      });
      return;
    }

    if (action === "delete_user") {
      setNotice({
        tone: "info",
        message:
          "Hard delete użytkownika jest tymczasowo wyłączony. Zrobimy później bezpieczne RPC do archiwizacji/usuwania konta.",
      });
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
      setNotice({
        tone: "error",
        message: "Podaj poprawną dodatnią kwotę VB.",
      });
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
        setNotice({
          tone: "error",
          message: data?.error ?? "Nie udało się wykonać akcji.",
        });
        return;
      }

      if (action === "add_vb") {
        setManualAmount("");
      }

      setNotice({
        tone: "success",
        message: "Akcja wykonana ✅",
      });

      await Promise.allSettled([loadUsers(), loadAuditLogs()]);
    } catch (e: any) {
      setNotice({
        tone: "error",
        message: e?.message ?? "Błąd akcji admina.",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const refreshEverything = async () => {
    await Promise.allSettled([
      load(),
      refreshStats(),
      refreshHealth(),
      loadUsers(),
      loadAuditLogs(),
      loadSystemCheckLatest(),
      loadMappingReviewCount(),
    ]);

    setLastRefreshAt(new Date().toISOString());
    setNotice({
      tone: "success",
      message: "Panel odświeżony ✅",
    });
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;

    const boot = async () => {
      await Promise.allSettled([
        refreshStats(),
        refreshHealth(),
        loadUsers(),
        loadAuditLogs(),
        loadSystemCheckLatest(),
        loadMappingReviewCount(),
      ]);

      setLastRefreshAt(new Date().toISOString());
    };

    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const renderOverview = () => (
    <div className="space-y-5">

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.15fr)_360px]">
        <Panel
          title="Szybkie ścieżki pracy"
          description="Najczęściej używane obszary panelu i skróty do operacji."
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <ActionCard
              title="Users workspace"
              description="Wyszukiwanie users, saldo, ban/unban i szybka niespodzianka."
              onClick={() => setActiveView("users")}
            />

            <ActionCard
              title="Diagnostyka"
              description="System Health, System Check i sample błędów."
              onClick={() => setActiveView("diagnostics")}
            />

            <LinkCard
              href="/admin/match-mapping"
              title="Match mapping review"
              description="Ręczne przypinanie SofaScore event ID dla meczów wymagających review."
            >
              <div className="flex items-center justify-between gap-2">
                {mappingReviewCount > 0 ? (
                  <span className="text-xs font-semibold text-yellow-300">
                    Do review: {mappingReviewCount}
                  </span>
                ) : (
                  <span className="text-xs text-neutral-500">
                    Brak aktywnych review.
                  </span>
                )}
                <AttentionDot show={mappingReviewCount > 0} />
              </div>
            </LinkCard>

            <ActionCard
              title="Settlement"
              description="Auto-settle i ręczne rozliczanie kuponów."
              onClick={() => setActiveView("settlement")}
            />

            <ActionCard
              title="Audit"
              description="Ostatnie działania administratorów i szybki podgląd historii."
              onClick={() => setActiveView("audit")}
            />

            <LinkCard
              href="/admin/logs"
              title="Pełne logi"
              description="Otwórz dedykowaną stronę z pełną historią."
            />

            <LinkCard
              href="/admin/surprises"
              title="Centrum niespodzianek"
              description="Osobny moduł do wiadomości i akcji specjalnych."
            />
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel
            title="Wybrany użytkownik"
            description="Skrócony snapshot aktualnie zaznaczonego konta."
          >
            {!selectedUser ? (
              <div className="rounded-2xl border border-dashed border-neutral-800 bg-black/20 p-5 text-sm text-neutral-500">
                Wybierz użytkownika w sekcji Users.
              </div>
            ) : (
              <div className="space-y-3">
                <InfoField label="Username" value={selectedUser.username ?? "—"} />
                <InfoField label="Email" value={selectedUser.email ?? "—"} />
                <InfoField
                  label="Saldo"
                  value={`${formatVB(selectedUser.balance_vb)} VB`}
                />
                <div className="flex flex-wrap gap-2">
                  {selectedUser.is_banned ? (
                    <StatusPill tone="red">konto zbanowane</StatusPill>
                  ) : (
                    <StatusPill tone="green">konto aktywne</StatusPill>
                  )}

                  {selectedUser.email_confirmed_at ? (
                    <StatusPill tone="green">mail confirmed</StatusPill>
                  ) : (
                    <StatusPill tone="yellow">mail pending</StatusPill>
                  )}
                </div>
              </div>
            )}
          </Panel>

          <Panel
            title="Ostatnie działania"
            description="Kompaktowy skrót ostatnich wpisów audit log."
          >
            {recentAuditLogs.length === 0 ? (
              <div className="text-sm text-neutral-500">
                Brak wpisów audit log.
              </div>
            ) : (
              <div className="space-y-2">
                {recentAuditLogs.slice(0, 4).map((log) => (
                  <div
                    key={log.id}
                    className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-white">{log.action}</div>
                        <div className="mt-1 break-all text-xs text-neutral-500">
                          target: {log.target_user_id ?? "—"}
                        </div>
                      </div>

                      <div className="shrink-0 text-[11px] text-neutral-500">
                        {fmtDate(log.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );

  const renderUsers = () => (
    <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.1fr)_420px]">
      <Panel
        title="Lista users"
        description="Wybierz użytkownika z listy, aby zobaczyć kartę operacyjną po prawej."
        actions={
          <button
            type="button"
            onClick={loadUsers}
            disabled={usersLoading}
            className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-white transition hover:bg-neutral-800 disabled:opacity-50"
          >
            {usersLoading ? "Synchronizuję..." : "Odśwież użytkowników"}
          </button>
        }
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-3">
            <input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Szukaj użytkownika..."
              className="w-full rounded-2xl border border-neutral-800 bg-black/20 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-neutral-600"
            />
          </div>

          <div className="grid gap-3">
            {filteredUsers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-neutral-800 bg-black/20 p-6 text-sm text-neutral-500">
                Brak użytkowników pasujących do filtra.
              </div>
            ) : (
              filteredUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setSelectedUserId(u.id);
                    setSurpriseEmail(u.email ?? "");
                  }}
                  className={cn(
                    "rounded-3xl border p-4 text-left transition",
                    selectedUserId === u.id
                      ? "border-white/20 bg-white/[0.07]"
                      : "border-neutral-800 bg-neutral-950/80 hover:border-neutral-700 hover:bg-neutral-900"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-white">
                        {u.username ?? "—"}
                      </div>
                      <div className="mt-1 break-all text-xs text-neutral-500">
                        {u.email ?? "—"}
                      </div>
                      <div className="mt-2 break-all text-[11px] text-neutral-600">
                        {u.id}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-lg font-semibold text-white">
                        {formatVB(u.balance_vb)}
                      </div>
                      <div className="mt-1 text-xs text-neutral-500">VB</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {u.email_confirmed_at ? (
                      <StatusPill tone="green">mail confirmed</StatusPill>
                    ) : (
                      <StatusPill tone="yellow">mail pending</StatusPill>
                    )}

                    {u.is_banned ? (
                      <StatusPill tone="red">banned</StatusPill>
                    ) : (
                      <StatusPill>active</StatusPill>
                    )}

                    <StatusPill tone="blue">kupony: {u.bets_count}</StatusPill>
                    <StatusPill>ROI: {fmtPct(u.roi)}</StatusPill>
                    <StatusPill>winrate: {fmtPct(u.winrate)}</StatusPill>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </Panel>

      <Panel
        title="Karta wybranego użytkownika"
        description="Szybkie informacje, statystyki konta i akcje administracyjne."
      >
        {!selectedUser ? (
          <div className="rounded-2xl border border-dashed border-neutral-800 bg-black/20 p-6 text-sm text-neutral-500">
            Wybierz użytkownika z listy po lewej stronie.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {selectedUser.is_banned ? (
                <StatusPill tone="red">konto zbanowane</StatusPill>
              ) : (
                <StatusPill tone="green">konto aktywne</StatusPill>
              )}

              {selectedUser.email_confirmed_at ? (
                <StatusPill tone="green">mail confirmed</StatusPill>
              ) : (
                <StatusPill tone="yellow">confirmation pending</StatusPill>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <InfoField label="Username" value={selectedUser.username ?? "—"} />
              <InfoField label="Email" value={selectedUser.email ?? "—"} />
              <InfoField
                label="Saldo"
                value={`${formatVB(selectedUser.balance_vb)} VB`}
              />
              <InfoField label="Mail status" value={selectedUser.email_status} />
              <InfoField
                label="Email sent"
                value={fmtDate(selectedUser.email_confirmation_sent_at)}
              />
              <InfoField
                label="Email confirmed"
                value={fmtDate(selectedUser.email_confirmed_at)}
              />
              <InfoField
                label="Created at"
                value={fmtDate(selectedUser.created_at)}
              />
              <InfoField
                label="Last sign in"
                value={fmtDate(selectedUser.last_sign_in_at)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
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

            <div className="rounded-3xl border border-neutral-800 bg-neutral-950/80 p-4">
              <div className="text-sm font-semibold text-white">Akcje konta</div>
              <div className="mt-1 text-xs text-neutral-400">
                Operacje finansowe i statusowe na bieżąco wybranym użytkowniku.
              </div>

              <div className="mt-4 grid gap-3">
                <input
                  value={manualAmount}
                  onChange={(e) =>
                    setManualAmount(e.target.value.replace(/[^\d.,-]/g, ""))
                  }
                  placeholder="Kwota VB, np. 500"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-neutral-600"
                />

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => runUserAction("add_vb")}
                    disabled={actionLoading === "add_vb"}
                    className="rounded-2xl border border-green-700/40 bg-green-700 px-4 py-2.5 text-sm text-white transition hover:bg-green-600 disabled:opacity-50"
                  >
                    {actionLoading === "add_vb" ? "Trwa..." : "Dodaj VB"}
                  </button>

                  <button
                    type="button"
                    onClick={() => runUserAction("reset_balance")}
                    disabled={actionLoading === "reset_balance"}
                    className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm text-white transition hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {actionLoading === "reset_balance"
                      ? "Trwa..."
                      : "Reset salda"}
                  </button>

                  <button
                    type="button"
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
                    type="button"
                    disabled
                    title="Hard delete tymczasowo wyłączony do czasu wdrożenia bezpiecznego RPC"
                    className="cursor-not-allowed rounded-2xl border border-red-900/30 bg-red-900/10 px-4 py-2.5 text-sm text-red-300/70 opacity-60"
                  >
                    Delete disabled
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-neutral-800 bg-neutral-950/80 p-4">
              <div className="text-sm font-semibold text-white">
                Szybka niespodzianka
              </div>
              <div className="mt-1 text-xs text-neutral-400">
                Wiadomość przypięta do aktualnie wybranego użytkownika.
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
                    type="button"
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
          </div>
        )}
      </Panel>
    </div>
  );

  const renderDiagnostics = () => (
    <div className="grid gap-5 2xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-5">
        <Panel
          title="System Health"
          actions={
            <button
              type="button"
              onClick={refreshHealth}
              disabled={healthLoading}
              className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-white transition hover:bg-neutral-800 disabled:opacity-50"
            >
              {healthLoading ? "..." : "Odśwież"}
            </button>
          }
        >
          {!health ? (
            <div className="rounded-2xl border border-dashed border-neutral-800 bg-black/20 p-6 text-sm text-neutral-500">
              Brak danych / nie udało się pobrać.
            </div>
          ) : !health.ok ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
              Błąd: {health.error ?? "unknown"}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusPill tone={healthBad === 0 ? "green" : "yellow"}>
                  {healthBad === 0 ? "HEALTHY" : "ATTENTION"}
                </StatusPill>
                <StatusPill>stuck: {hm?.stuckMatches ?? 0}</StatusPill>
                <StatusPill>
                  finished+unsettled:{" "}
                  {hm?.finishedMatchesWithUnsettledItems ?? 0}
                </StatusPill>
                <StatusPill>
                  pending-ready: {hm?.pendingButAllItemsSettled ?? 0}
                </StatusPill>
                <StatusPill
                  tone={(hm?.missingPayoutLedger ?? 0) > 0 ? "red" : "neutral"}
                >
                  missing payout: {hm?.missingPayoutLedger ?? 0}
                </StatusPill>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <MetricCard
                  label="stuck matches"
                  value={hm?.stuckMatches ?? 0}
                  tone={(hm?.stuckMatches ?? 0) > 0 ? "yellow" : "neutral"}
                />
                <MetricCard
                  label="finished + unsettled"
                  value={hm?.finishedMatchesWithUnsettledItems ?? 0}
                  tone={
                    (hm?.finishedMatchesWithUnsettledItems ?? 0) > 0
                      ? "yellow"
                      : "neutral"
                  }
                />
                <MetricCard
                  label="pending ready"
                  value={hm?.pendingButAllItemsSettled ?? 0}
                  tone={
                    (hm?.pendingButAllItemsSettled ?? 0) > 0
                      ? "yellow"
                      : "neutral"
                  }
                />
                <MetricCard
                  label="missing payout"
                  value={hm?.missingPayoutLedger ?? 0}
                  tone={(hm?.missingPayoutLedger ?? 0) > 0 ? "red" : "neutral"}
                />
              </div>

              <details className="text-xs">
                <summary className="cursor-pointer text-neutral-400 hover:text-white">
                  Pokaż sample (debug)
                </summary>
                <pre className="mt-2 overflow-auto rounded-xl border border-neutral-800 bg-black/30 p-3">
                  {JSON.stringify(health.samples, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </Panel>

        <Panel title="Skróty diagnostyczne">
          <div className="grid gap-3">
            <ActionCard
              title={systemCheckRunning ? "Uruchamianie..." : "Uruchom System Check"}
              description="Pakiet kontroli spójności wallet / ledger / bets / settlement."
              onClick={systemCheckRunning ? undefined : runSystemCheck}
            />

            <LinkCard
              href="/admin/match-mapping"
              title="Match mapping review"
              description="Sprawdź mecze z kolejki match_mapping_queue oznaczone jako needs_review albo failed."
            >
              {mappingReviewCount > 0 ? (
                <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1 text-xs font-semibold text-yellow-300">
                  {mappingReviewCount}
                </span>
              ) : (
                <span className="text-xs text-neutral-500">Brak aktywnych review.</span>
              )}
            </LinkCard>

            <ActionCard
              title="Odśwież wszystkie dane"
              description="Szybki refresh wszystkich modułów dashboardu."
              onClick={refreshEverything}
            />

            <LinkCard
              href="/admin/logs"
              title="Przejdź do pełnych logów"
              description="Dedykowana strona do analizy logów i cronów."
            />
          </div>
        </Panel>
      </div>

      <Panel
        title="System Check"
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadSystemCheckLatest}
              disabled={systemCheckLoading || systemCheckRunning}
              className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-white transition hover:bg-neutral-800 disabled:opacity-50"
            >
              {systemCheckLoading ? "..." : "Odśwież"}
            </button>

            <button
              type="button"
              onClick={runSystemCheck}
              disabled={systemCheckRunning}
              className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-white transition hover:bg-neutral-800 disabled:opacity-50"
            >
              {systemCheckRunning ? "Uruchamianie..." : "Uruchom System Check"}
            </button>
          </div>
        }
      >
        {systemCheckError ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
            {systemCheckError}
          </div>
        ) : null}

        {!systemCheckRun ? (
          <div className="rounded-2xl border border-dashed border-neutral-800 bg-black/20 p-6 text-sm text-neutral-500">
            {systemCheckLoading
              ? "Ładowanie wyników..."
              : "Brak wcześniejszych uruchomień."}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <MetricCard
                label="Run status"
                value={systemCheckRun.ok ? "OK" : "FAILED"}
                hint={systemCheckRun.status}
                tone={systemCheckRun.ok ? "green" : "red"}
              />

              <MetricCard
                label="Start"
                value={fmtDateCompact(systemCheckRun.started_at)}
                tone="neutral"
                valueClassName="text-base sm:text-lg"
              />

              <MetricCard
                label="Koniec"
                value={fmtDateCompact(systemCheckRun.finished_at)}
                tone="neutral"
                valueClassName="text-base sm:text-lg"
              />

              <MetricCard
                label="Passed"
                value={systemCheckRun.checks_passed}
                hint={`z ${systemCheckRun.checks_total}`}
                tone="green"
              />

              <MetricCard
                label="Failed"
                value={systemCheckRun.checks_failed}
                tone={systemCheckRun.checks_failed > 0 ? "red" : "neutral"}
              />
            </div>

            <div className="space-y-3">
              {sortedSystemCheckResults.map((result) => (
                <div
                  key={result.id}
                  className="rounded-3xl border border-neutral-800 bg-neutral-950/80 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="break-all text-lg font-semibold text-white">
                          {result.check_key}
                        </div>

                        <StatusPill tone={getSeverityTone(result.severity)}>
                          poziom: {result.severity}
                        </StatusPill>

                        <StatusPill tone={result.ok ? "green" : "red"}>
                          wynik: {result.ok ? "PASS" : "FAIL"}
                        </StatusPill>
                      </div>

                      <div className="mt-2 text-xs text-neutral-400">
                        rows_count:{" "}
                        <b className="text-white">{result.rows_count}</b>
                      </div>
                    </div>

                    <div className="text-xs text-neutral-500">
                      {fmtDate(result.created_at)}
                    </div>
                  </div>

                  {((Array.isArray(result.sample) &&
                    result.sample.length > 0) ||
                    (result.details &&
                      Object.keys(result.details ?? {}).length > 0)) && (
                    <details className="mt-4 text-xs">
                      <summary className="cursor-pointer text-neutral-400 hover:text-white">
                        Pokaż szczegóły
                      </summary>

                      {Array.isArray(result.sample) &&
                      result.sample.length > 0 ? (
                        <pre className="mt-2 overflow-auto rounded-xl border border-neutral-800 bg-black/30 p-3">
                          {JSON.stringify(result.sample, null, 2)}
                        </pre>
                      ) : null}

                      {result.details &&
                      Object.keys(result.details ?? {}).length > 0 ? (
                        <pre className="mt-2 overflow-auto rounded-xl border border-neutral-800 bg-black/30 p-3">
                          {JSON.stringify(result.details, null, 2)}
                        </pre>
                      ) : null}
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );

  const renderSettlement = () => (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Do rozliczenia"
          value={readyMatches}
          hint="Gotowe mecze do settle"
          tone={readyMatches > 0 ? "yellow" : "neutral"}
        />
        <MetricCard
          label="Pozycje"
          value={readyItems}
          hint="Łączna liczba pozycji"
          tone="blue"
        />
        <MetricCard
          label="Buffer"
          value={`${settleStats?.bufferMinutes ?? 10} min`}
          hint={
            settleStats?.cutoffIso
              ? `cutoff: ${fmtDate(settleStats.cutoffIso)}`
              : "Brak cutoff"
          }
          tone="neutral"
        />
        <MetricCard
          label="Pending bets"
          value={pendingBetsCount}
          hint="Nierozliczone kupony"
          tone={pendingBetsCount > 0 ? "yellow" : "neutral"}
        />
      </div>

      <Panel
        title="Auto-settlement engine"
        description="Pobiera wyniki z football-data, zapisuje do match_results i uruchamia rozliczenie."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={refreshStats}
              disabled={statsLoading}
              className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-white transition hover:bg-neutral-800 disabled:opacity-50"
            >
              {statsLoading ? "..." : "Sprawdź"}
            </button>

            <button
              type="button"
              onClick={runAutoSettle}
              disabled={autoLoading || readyMatches <= 0}
              title={
                readyMatches <= 0
                  ? "Brak meczów do rozliczenia"
                  : "Uruchom auto-rozliczanie"
              }
              className="rounded-2xl border border-green-700/40 bg-green-700 px-4 py-2 text-sm text-white transition hover:bg-green-600 disabled:opacity-50"
            >
              {autoLoading ? "Rozliczanie..." : "Uruchom auto-settle"}
            </button>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <InfoField
            label="Ready matches"
            value={<span className="text-2xl font-semibold">{readyMatches}</span>}
          />
          <InfoField
            label="Ready items"
            value={<span className="text-2xl font-semibold">{readyItems}</span>}
          />
          <InfoField
            label="Status"
            value={
              readyMatches > 0 ? (
                <StatusPill tone="yellow">wymaga uwagi</StatusPill>
              ) : (
                <StatusPill tone="green">nic nie czeka</StatusPill>
              )
            }
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
      </Panel>

      <Panel
        title="Szybkie ręczne rozliczenie"
        description="Ostatnie kupony w skrócie. Możesz ręcznie nadać status wynikowy."
      >
        <div className="grid gap-3 xl:grid-cols-2">
          {bets.slice(0, 12).map((b) => (
            <div
              key={b.id}
              className="rounded-3xl border border-neutral-800 bg-neutral-950/80 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="break-all text-sm font-semibold text-white">
                    {b.id}
                  </div>
                  <div className="mt-1 break-all text-xs text-neutral-500">
                    user: {b.user_id}
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {fmtDate(b.created_at)}
                  </div>
                </div>

                <StatusPill tone={getBetStatusTone(b.status)}>
                  {String(b.status).toUpperCase()}
                </StatusPill>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <InfoField label="Stawka" value={`${formatVB(b.stake)} VB`} />
                <InfoField label="Kurs" value={formatOdd(b.total_odds)} />
                <InfoField
                  label="Wygrana"
                  value={`${formatVB(b.potential_win)} VB`}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={b.settled}
                  onClick={() => settle(b.id, "won")}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-white transition hover:bg-neutral-800 disabled:opacity-50"
                >
                  WON
                </button>
                <button
                  type="button"
                  disabled={b.settled}
                  onClick={() => settle(b.id, "lost")}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-white transition hover:bg-neutral-800 disabled:opacity-50"
                >
                  LOST
                </button>
                <button
                  type="button"
                  disabled={b.settled}
                  onClick={() => settle(b.id, "void")}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-white transition hover:bg-neutral-800 disabled:opacity-50"
                >
                  VOID
                </button>
                <StatusPill tone={b.settled ? "green" : "neutral"}>
                  settled: {b.settled ? "TAK" : "NIE"}
                </StatusPill>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );

  const renderAudit = () => (
    <Panel
      title="Audit log"
      description="Kompaktowy podgląd ostatnich działań admina. Pełne logi są dostępne na osobnej stronie."
      actions={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
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
            Otwórz pełne logi
          </Link>
        </div>
      }
    >
      {auditLogs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-800 bg-black/20 p-6 text-sm text-neutral-500">
          Brak wpisów audit log.
        </div>
      ) : (
        <div className="space-y-3">
          {auditLogs.map((log) => (
            <details
              key={log.id}
              className="group rounded-3xl border border-neutral-800 bg-neutral-950/80 p-4"
            >
              <summary className="flex cursor-pointer list-none flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white">{log.action}</span>
                    <StatusPill>{fmtDate(log.created_at)}</StatusPill>
                  </div>

                  <div className="mt-2 break-all text-xs text-neutral-500">
                    admin: {log.admin_user_id}
                  </div>
                  <div className="break-all text-xs text-neutral-500">
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
    </Panel>
  );

  const renderBets = () => (
    <div className="space-y-5">
      <Panel
        title="Filtry kuponów"
        description="Szukaj po ID, user ID, statusie lub parametrach kuponu."
      >
        <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <input
            value={betSearch}
            onChange={(e) => setBetSearch(e.target.value)}
            placeholder="Szukaj kuponu..."
            className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-neutral-600"
          />

          <div className="flex flex-wrap gap-2">
            {(["all", "pending", "won", "lost", "void"] as const).map(
              (filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setBetFilter(filter)}
                  className={cn(
                    "rounded-2xl border px-4 py-2 text-sm transition",
                    betFilter === filter
                      ? "border-white/15 bg-white text-black"
                      : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-800"
                  )}
                >
                  {filter.toUpperCase()}
                </button>
              )
            )}
          </div>
        </div>
      </Panel>

      <Panel
        title="Ostatnie kupony"
        description="Karta operacyjna najnowszych kuponów z możliwością szybkiego rozliczenia."
      >
        {filteredBets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-800 bg-black/20 p-6 text-sm text-neutral-500">
            Brak kuponów pasujących do filtra.
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {filteredBets.map((b) => (
              <div
                key={b.id}
                className="rounded-3xl border border-neutral-800 bg-neutral-950/80 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="break-all text-sm font-semibold text-white">
                      {b.id}
                    </div>
                    <div className="mt-1 break-all text-xs text-neutral-500">
                      user: {b.user_id}
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {fmtDate(b.created_at)}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <StatusPill tone={getBetStatusTone(b.status)}>
                      {String(b.status).toUpperCase()}
                    </StatusPill>
                    <StatusPill tone={b.settled ? "green" : "neutral"}>
                      {b.settled ? "SETTLED" : "PENDING"}
                    </StatusPill>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3">
                  <InfoField label="Stawka" value={`${formatVB(b.stake)} VB`} />
                  <InfoField label="Kurs" value={formatOdd(b.total_odds)} />
                  <InfoField
                    label="Wygrana"
                    value={`${formatVB(b.potential_win)} VB`}
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={b.settled}
                    onClick={() => settle(b.id, "won")}
                    className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-white transition hover:bg-neutral-800 disabled:opacity-50"
                  >
                    WON
                  </button>
                  <button
                    type="button"
                    disabled={b.settled}
                    onClick={() => settle(b.id, "lost")}
                    className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-white transition hover:bg-neutral-800 disabled:opacity-50"
                  >
                    LOST
                  </button>
                  <button
                    type="button"
                    disabled={b.settled}
                    onClick={() => settle(b.id, "void")}
                    className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-white transition hover:bg-neutral-800 disabled:opacity-50"
                  >
                    VOID
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );

  const renderCurrentView = () => {
    switch (activeView) {
      case "overview":
        return renderOverview();
      case "users":
        return renderUsers();
      case "diagnostics":
        return renderDiagnostics();
      case "settlement":
        return renderSettlement();
      case "audit":
        return renderAudit();
      case "bets":
        return renderBets();
      default:
        return renderOverview();
    }
  };

  if (loading) {
    return (
      <div className="rounded-3xl border border-neutral-800 bg-neutral-950/70 p-8 text-neutral-400">
        Ładowanie...
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="rounded-3xl border border-neutral-800 bg-neutral-950/70 p-8 text-neutral-300">
        Brak dostępu. To jest panel admina.
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10 text-white">
      <SurfaceCard className="overflow-hidden">
        <div className="border-b border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.96),rgba(5,5,5,0.98))] p-5 sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                VirtualBook Admin
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                Admin Center
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-400">
                Premium control room do użytkowników, settlementu, diagnostyki,
                logów i operacji wymagających ręcznej uwagi.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <StatusPill tone={healthBad === 0 ? "green" : "yellow"}>
                  {healthBad === 0 ? "System healthy" : `Attention ${healthBad}`}
                </StatusPill>

                <StatusPill tone={readyMatches > 0 ? "yellow" : "neutral"}>
                  Ready matches: {readyMatches}
                </StatusPill>

                <StatusPill tone={mappingReviewCount > 0 ? "yellow" : "neutral"}>
                  Mapping review: {mappingReviewCount}
                </StatusPill>

                {lastRefreshAt ? (
                  <StatusPill>Refresh: {fmtDateCompact(lastRefreshAt)}</StatusPill>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 xl:hidden"
              >
                Sekcje
              </button>

              <button
                type="button"
                onClick={refreshEverything}
                className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-neutral-200"
              >
                Odśwież wszystko
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Użytkownicy"
              value={users.length}
              hint={`confirmed: ${confirmedUsersCount} • banned: ${bannedUsersCount}`}
              tone="blue"
            />
            <MetricCard
              label="Pending bets"
              value={pendingBetsCount}
              hint={`ready matches: ${readyMatches} • items: ${readyItems}`}
              tone={pendingBetsCount > 0 ? "yellow" : "neutral"}
            />
            <MetricCard
              label="System health"
              value={healthBad === 0 ? "HEALTHY" : `ALERT ${healthBad}`}
              hint="wallet / ledger / bets / settlement"
              tone={healthBad === 0 ? "green" : "yellow"}
            />
            <MetricCard
              label="Match mapping"
              value={mappingReviewCount}
              hint={
                mappingReviewCount > 0
                  ? "needs review / failed"
                  : "brak aktywnych review"
              }
              tone={mappingReviewCount > 0 ? "yellow" : "neutral"}
            />
          </div>

          <div className="mt-5 overflow-x-auto pb-1 xl:hidden">
            <div className="flex w-max gap-2">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveView(item.key)}
                  className={cn(
                    "rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                    activeView === item.key
                      ? "border-white bg-white text-black"
                      : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {notice ? (
          <div className="p-4 sm:p-5">
            <div
              className={cn(
                "rounded-2xl border px-4 py-3 text-sm",
                getNoticeToneClass(notice.tone)
              )}
            >
              {notice.message}
            </div>
          </div>
        ) : null}
      </SurfaceCard>

      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="hidden xl:block">
          <div className="sticky top-24 space-y-5">
            <SurfaceCard className="p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                Sekcje admina
              </div>

              <div className="mt-3 text-2xl font-semibold text-white">
                Control Center
              </div>

              <p className="mt-3 text-sm leading-6 text-neutral-400">
                Wybierz moduł roboczy i przejdź do konkretnej operacji.
              </p>

              <div className="mt-5 space-y-2">
                {NAV_ITEMS.map((item) => (
                  <SidebarItem
                    key={item.key}
                    active={activeView === item.key}
                    label={item.label}
                    short={item.short}
                    description={item.description}
                    onClick={() => setActiveView(item.key)}
                  />
                ))}
              </div>
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                Quick links
              </div>

              <div className="mt-3 grid gap-2">
                <Link
                  href="/admin/logs"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950/80 px-3 py-2.5 text-sm text-neutral-300 transition hover:bg-neutral-900"
                >
                  Pełne logi
                </Link>

                <Link
                  href="/admin/surprises"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950/80 px-3 py-2.5 text-sm text-neutral-300 transition hover:bg-neutral-900"
                >
                  Centrum niespodzianek
                </Link>

                <Link
                  href="/admin/match-mapping"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950/80 px-3 py-2.5 text-sm text-neutral-300 transition hover:bg-neutral-900"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span>Match mapping</span>
                    <AttentionDot show={mappingReviewCount > 0} />
                  </span>
                </Link>
              </div>
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                Live state
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill tone={healthBad === 0 ? "green" : "yellow"}>
                  {healthBad === 0 ? "HEALTHY" : "ATTENTION"}
                </StatusPill>
                <StatusPill tone={readyMatches > 0 ? "yellow" : "neutral"}>
                  ready matches: {readyMatches}
                </StatusPill>
                <StatusPill tone={mappingReviewCount > 0 ? "yellow" : "neutral"}>
                  mapping: {mappingReviewCount}
                </StatusPill>
              </div>

              <div className="mt-3 text-xs text-neutral-500">
                {lastRefreshAt
                  ? `Ostatni refresh: ${fmtDate(lastRefreshAt)}`
                  : "Brak refreshu"}
              </div>
            </SurfaceCard>
          </div>
        </aside>

        <main className="min-w-0 space-y-5">
          {activeView !== "overview" ? (
            <SurfaceCard className="p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                    {activeMeta.helper}
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">
                    {activeMeta.title}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
                    {activeMeta.description}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={refreshEverything}
                  className="shrink-0 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-white transition hover:bg-neutral-800"
                >
                  Odśwież
                </button>
              </div>
            </SurfaceCard>
          ) : null}

          {renderCurrentView()}
        </main>
      </div>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setSidebarOpen(false)}
          />

          <div className="absolute inset-y-0 left-0 w-[86vw] max-w-[360px] overflow-hidden border-r border-neutral-800 bg-neutral-950">
            <div className="flex items-center justify-between border-b border-neutral-800 p-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                  Admin menu
                </div>
                <div className="mt-1 text-xl font-semibold text-white">
                  Control Center
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="rounded-2xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white transition hover:bg-neutral-800"
              >
                Zamknij
              </button>
            </div>

            <div className="space-y-5 overflow-y-auto p-4">
              <div className="space-y-2">
                {NAV_ITEMS.map((item) => (
                  <SidebarItem
                    key={item.key}
                    active={activeView === item.key}
                    label={item.label}
                    short={item.short}
                    description={item.description}
                    onClick={() => {
                      setActiveView(item.key);
                      setSidebarOpen(false);
                    }}
                  />
                ))}
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                  Quick links
                </div>

                <div className="mt-3 grid gap-2">
                  <Link
                    href="/admin/logs"
                    onClick={() => setSidebarOpen(false)}
                    className="rounded-2xl border border-neutral-800 bg-black/20 px-3 py-2.5 text-sm text-neutral-300 transition hover:bg-neutral-900"
                  >
                    Pełne logi
                  </Link>

                  <Link
                    href="/admin/surprises"
                    onClick={() => setSidebarOpen(false)}
                    className="rounded-2xl border border-neutral-800 bg-black/20 px-3 py-2.5 text-sm text-neutral-300 transition hover:bg-neutral-900"
                  >
                    Centrum niespodzianek
                  </Link>

                  <Link
                    href="/admin/match-mapping"
                    onClick={() => setSidebarOpen(false)}
                    className="rounded-2xl border border-neutral-800 bg-black/20 px-3 py-2.5 text-sm text-neutral-300 transition hover:bg-neutral-900"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span>Match mapping</span>
                      <AttentionDot show={mappingReviewCount > 0} />
                    </span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}