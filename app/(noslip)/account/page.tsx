// app/(noslip)/account/page.tsx
"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type TabKey = "overview" | "stats" | "activity" | "security";

type ProfileRow = {
  id: string;
  balance_vb: number | null;
  username: string | null;
};

type LeaderboardSelfRow = {
  id: string;
  balance_vb: number | string | null;
  bets_count: number | string | null;
  active_bets: number | string | null;
  won_bets: number | string | null;
  lost_bets: number | string | null;
  void_bets: number | string | null;
  profit: number | string | null;
  roi: number | string | null;
  winrate: number | string | null;
};

type BetRow = {
  id: string;
  stake: number | null;
  total_odds: number | null;
  potential_win: number | null;
  payout: number | null;
  status: string;
  created_at: string;
};

type LedgerRow = {
  id: string;
  created_at: string;
  kind: string;
  amount: number;
  balance_after: number | null;
  ref_type: string | null;
  ref_id: string | null;
};

type Tone = "neutral" | "green" | "red" | "yellow" | "blue";

const BET_DETAILS_PATH = (betId: string) => `/bets/${betId}`;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function toNum(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt0(n: number | null | undefined) {
  return Number(n ?? 0).toFixed(0);
}

function fmt2(n: number | null | undefined) {
  return Number(n ?? 0).toFixed(2);
}

function fmtPct(n: number | null | undefined) {
  return `${Number(n ?? 0).toFixed(2)}%`;
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pl-PL");
}

function amountClass(amount: number) {
  if (amount > 0) return "text-green-400";
  if (amount < 0) return "text-red-400";
  return "text-neutral-200";
}

function kindLabel(kind: string) {
  switch (kind) {
    case "BET_PLACED":
      return "Postawiono kupon";
    case "BET_PAYOUT":
      return "Wypłata kuponu";
    case "WEEKLY_GRANT":
      return "Weekly bonus";
    case "MANUAL_RECONCILIATION":
      return "Korekta";
    default:
      return kind;
  }
}

function betStatusLabel(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "won") return "Wygrany";
  if (s === "lost") return "Przegrany";
  if (s === "void") return "Zwrot";
  return "W grze";
}

function getToneClass(tone: Tone) {
  if (tone === "green") return "border-green-500/20 bg-green-500/10";
  if (tone === "red") return "border-red-500/20 bg-red-500/10";
  if (tone === "yellow") return "border-yellow-500/20 bg-yellow-500/10";
  if (tone === "blue") return "border-sky-500/20 bg-sky-500/10";
  return "border-neutral-800 bg-neutral-950/70";
}

function getValueClass(tone: Tone) {
  if (tone === "green") return "text-green-300";
  if (tone === "red") return "text-red-300";
  if (tone === "yellow") return "text-yellow-300";
  if (tone === "blue") return "text-sky-300";
  return "text-white";
}

function betStatusClass(status: string) {
  const s = String(status || "").toLowerCase();

  if (s === "won") return "border-green-500/30 bg-green-500/10 text-green-300";
  if (s === "lost") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (s === "void") {
    return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
  }

  return "border-sky-500/30 bg-sky-500/10 text-sky-300";
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

function StatusPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  const cls =
    tone === "green"
      ? "border-green-500/30 bg-green-500/10 text-green-300"
      : tone === "red"
        ? "border-red-500/30 bg-red-500/10 text-red-300"
        : tone === "yellow"
          ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
          : tone === "blue"
            ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
            : "border-neutral-800 bg-neutral-950 text-neutral-300";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold",
        cls
      )}
    >
      {children}
    </span>
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
  tone?: Tone;
}) {
  return (
    <div className={cn("rounded-3xl border p-4", getToneClass(tone))}>
      <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">
        {label}
      </div>

      <div
        className={cn(
          "mt-3 text-2xl font-semibold leading-tight",
          getValueClass(tone)
        )}
      >
        {value}
      </div>

      {hint ? <div className="mt-2 text-xs text-neutral-500">{hint}</div> : null}
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <SurfaceCard className={cn("p-4 sm:p-5", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {subtitle ? (
            <div className="mt-1 text-sm leading-6 text-neutral-400">
              {subtitle}
            </div>
          ) : null}
        </div>

        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      <div className="mt-4">{children}</div>
    </SurfaceCard>
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
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </div>
      <div className="mt-2 break-words text-sm font-semibold text-white">
        {value}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  badge?: string | number | null;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={cn(
        "inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition",
        active
          ? "border-white bg-white text-black shadow-[0_12px_35px_rgba(255,255,255,0.08)]"
          : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-900 hover:text-white"
      )}
    >
      <span>{children}</span>

      {badge != null ? (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
            active ? "bg-black/10 text-black" : "bg-neutral-800 text-neutral-300"
          )}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function QuickAction({
  href,
  title,
  description,
  onClick,
}: {
  href?: string;
  title: string;
  description: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-1 text-xs leading-5 text-neutral-400">
        {description}
      </div>
    </>
  );

  const className =
    "rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 text-left transition hover:border-neutral-700 hover:bg-neutral-900";

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

function LoadingShell() {
  return (
    <div className="mx-auto max-w-7xl space-y-5 animate-pulse">
      <div className="h-64 rounded-3xl border border-neutral-800 bg-neutral-900/50" />
      <div className="h-20 rounded-3xl border border-neutral-800 bg-neutral-900/40" />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="h-80 rounded-3xl border border-neutral-800 bg-neutral-900/40" />
        <div className="h-80 rounded-3xl border border-neutral-800 bg-neutral-900/40" />
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-800 bg-black/20 p-6 text-sm text-neutral-500">
      {children}
    </div>
  );
}

export default function AccountPage() {
  const router = useRouter();

  const [isRecovery, setIsRecovery] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>("overview");

  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [emailConfirmedAt, setEmailConfirmedAt] = useState<string | null>(null);
  const [username, setUsername] = useState<string>("");
  const [balance, setBalance] = useState<number | null>(null);

  const [stats, setStats] = useState<LeaderboardSelfRow | null>(null);
  const [recentBets, setRecentBets] = useState<BetRow[]>([]);
  const [recentLedger, setRecentLedger] = useState<LedgerRow[]>([]);

  const [cpLoading, setCpLoading] = useState(false);
  const [cpError, setCpError] = useState<string | null>(null);
  const [cpOk, setCpOk] = useState<string | null>(null);
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");

  const displayName = useMemo(() => {
    if (username?.trim()) return username.trim();
    if (email?.trim()) return email.split("@")[0];
    return "Gracz";
  }, [username, email]);

  const passMismatch = useMemo(() => {
    if (!newPass || !newPass2) return false;
    return newPass !== newPass2;
  }, [newPass, newPass2]);

  const newPassTooShort = useMemo(() => {
    if (!newPass) return false;
    return newPass.length < 8;
  }, [newPass]);

  const sameAsOldPass = useMemo(() => {
    if (!oldPass || !newPass) return false;
    return oldPass === newPass;
  }, [oldPass, newPass]);

  const canSubmitPass = useMemo(() => {
    if (cpLoading) return false;

    if (isRecovery) {
      if (!newPass || !newPass2) return false;
      if (passMismatch || newPassTooShort) return false;
      return true;
    }

    if (!oldPass || !newPass || !newPass2) return false;
    if (passMismatch || newPassTooShort || sameAsOldPass) return false;
    return true;
  }, [
    cpLoading,
    isRecovery,
    oldPass,
    newPass,
    newPass2,
    passMismatch,
    newPassTooShort,
    sameAsOldPass,
  ]);

  const totalBets = toNum(stats?.bets_count);
  const activeBets = toNum(stats?.active_bets);
  const wonBets = toNum(stats?.won_bets);
  const lostBets = toNum(stats?.lost_bets);
  const voidBets = toNum(stats?.void_bets);
  const settledBets = wonBets + lostBets + voidBets;
  const profitValue = toNum(stats?.profit);
  const roiValue = toNum(stats?.roi);
  const winrateValue = toNum(stats?.winrate);

  const wonPct = totalBets > 0 ? (wonBets / totalBets) * 100 : 0;
  const lostPct = totalBets > 0 ? (lostBets / totalBets) * 100 : 0;
  const voidPct = totalBets > 0 ? (voidBets / totalBets) * 100 : 0;
  const activePct = totalBets > 0 ? (activeBets / totalBets) * 100 : 0;

  const profitTone: Tone =
    profitValue > 0 ? "green" : profitValue < 0 ? "red" : "neutral";

  const roiTone: Tone = roiValue > 0 ? "green" : roiValue < 0 ? "red" : "neutral";

  const publicProfileHref = username?.trim()
    ? `/users/${encodeURIComponent(username.trim())}`
    : null;

  const load = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const { data: sessionData, error: sessErr } =
        await supabase.auth.getSession();

      if (sessErr) {
        console.error(sessErr);
        router.replace("/login");
        return;
      }

      const u = sessionData.session?.user;

      if (!u?.id) {
        router.replace("/login");
        return;
      }

      setUserId(u.id);
      setEmail(u.email ?? "");
      setEmailConfirmedAt(
        ((u as any)?.email_confirmed_at as string | null) ??
          ((u as any)?.confirmed_at as string | null) ??
          null
      );

      const [profileRes, statsRes, betsRes, ledgerRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id,balance_vb,username")
          .eq("id", u.id)
          .maybeSingle<ProfileRow>(),
        supabase
          .from("leaderboard_global")
          .select(
            "id,balance_vb,bets_count,active_bets,won_bets,lost_bets,void_bets,profit,roi,winrate"
          )
          .eq("id", u.id)
          .maybeSingle<LeaderboardSelfRow>(),
        supabase
          .from("bets")
          .select("id,stake,total_odds,potential_win,payout,status,created_at")
          .eq("user_id", u.id)
          .order("created_at", { ascending: false })
          .limit(6),
        supabase
          .from("vb_ledger")
          .select("id,created_at,kind,amount,balance_after,ref_type,ref_id")
          .eq("user_id", u.id)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

      if (!profileRes.error) {
        setBalance(profileRes.data?.balance_vb ?? 0);
        setUsername(profileRes.data?.username ?? "");
      }

      if (!statsRes.error) {
        setStats(statsRes.data ?? null);
      } else {
        setStats(null);
      }

      if (!betsRes.error) {
        setRecentBets((betsRes.data ?? []) as BetRow[]);
      } else {
        setRecentBets([]);
      }

      if (!ledgerRes.error) {
        setRecentLedger((ledgerRes.data ?? []) as LedgerRow[]);
      } else {
        setRecentLedger([]);
      }
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
        setTab("security");
      }
    });

    const hash = window.location.hash;
    const search = window.location.search;

    if (hash.includes("type=recovery") || search.includes("type=recovery")) {
      setIsRecovery(true);
      setTab("security");
    }

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const onRefresh = (e?: Event) => {
      const ce = e as CustomEvent | undefined;
      const maybe = ce?.detail?.balance_vb ?? ce?.detail?.balanceAfter;

      if (maybe != null) {
        const n = Number(maybe);

        if (Number.isFinite(n)) {
          setBalance(n);
          return;
        }
      }

      void load(true);
    };

    window.addEventListener("vb:refresh-balance", onRefresh as any);

    return () => {
      window.removeEventListener("vb:refresh-balance", onRefresh as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const submitChangePassword = async () => {
    setCpError(null);
    setCpOk(null);

    if (!email) {
      setCpError("Brak emaila w sesji.");
      return;
    }

    if (!canSubmitPass) {
      setCpError(
        isRecovery
          ? "Uzupełnij poprawnie pola. Nowe hasło musi mieć minimum 8 znaków i musi zgadzać się w obu polach."
          : "Uzupełnij poprawnie pola. Nowe hasło musi mieć minimum 8 znaków, nie może być takie samo jak stare i musi zgadzać się w obu polach."
      );
      return;
    }

    try {
      setCpLoading(true);

      if (!isRecovery) {
        const { error: reauthErr } = await supabase.auth.signInWithPassword({
          email,
          password: oldPass,
        });

        if (reauthErr) {
          setCpError("Stare hasło jest nieprawidłowe.");
          return;
        }
      }

      const { error: updErr } = await supabase.auth.updateUser({
        password: newPass,
      });

      if (updErr) {
        setCpError(updErr.message);
        return;
      }

      setCpOk(
        isRecovery ? "Nowe hasło zostało ustawione ✅" : "Hasło zostało zmienione ✅"
      );

      setIsRecovery(false);
      setOldPass("");
      setNewPass("");
      setNewPass2("");
    } catch (e: any) {
      setCpError(e?.message ?? "Nie udało się zmienić hasła.");
    } finally {
      setCpLoading(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  if (loading) {
    return <LoadingShell />;
  }

  if (!userId) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <SurfaceCard className="overflow-hidden">
        <div className="border-b border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.95),rgba(5,5,5,0.98))] p-5 sm:p-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                VirtualBook Account
              </div>

              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Cześć, {displayName}
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-400">
                Centrum konta z podglądem salda, wyników, ostatniej aktywności
                i ustawień bezpieczeństwa.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <StatusPill tone="blue">Centrum konta</StatusPill>

                <StatusPill tone={emailConfirmedAt ? "green" : "yellow"}>
                  {emailConfirmedAt ? "Email potwierdzony" : "Email niepotwierdzony"}
                </StatusPill>

                <StatusPill>
                  Kupony w grze:{" "}
                  <span className="ml-1 font-semibold text-white">{activeBets}</span>
                </StatusPill>

                <StatusPill>
                  ID:{" "}
                  <span className="ml-1 max-w-[220px] truncate font-semibold text-white">
                    {userId}
                  </span>
                </StatusPill>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href="/wallet"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Otwórz wallet
                </Link>

                <Link
                  href="/bets"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Moje kupony
                </Link>

                <Link
                  href="/leaderboard"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Ranking
                </Link>

                {publicProfileHref ? (
                  <Link
                    href={publicProfileHref}
                    className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                  >
                    Profil publiczny
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[420px]">
              <MetricCard
                label="Saldo"
                value={`${fmt0(balance)} VB`}
                hint="Aktualny stan portfela"
                tone="blue"
              />

              <MetricCard
                label="Kupony w grze"
                value={activeBets}
                hint="Nierozliczone kupony"
                tone={activeBets > 0 ? "yellow" : "neutral"}
              />

              <MetricCard
                label="Profit"
                value={`${profitValue > 0 ? "+" : ""}${fmt2(profitValue)} VB`}
                hint="Tylko rozliczone kupony"
                tone={profitTone}
              />

              <MetricCard
                label="ROI"
                value={fmtPct(roiValue)}
                hint="Zwrot z rozliczonych stawek"
                tone={roiTone}
              />
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
                Przegląd
              </TabButton>

              <TabButton
                active={tab === "stats"}
                onClick={() => setTab("stats")}
                badge={totalBets}
              >
                Statystyki
              </TabButton>

              <TabButton
                active={tab === "activity"}
                onClick={() => setTab("activity")}
                badge={recentBets.length + recentLedger.length}
              >
                Aktywność
              </TabButton>

              <TabButton
                active={tab === "security"}
                onClick={() => setTab("security")}
              >
                Bezpieczeństwo
              </TabButton>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => load(true)}
                className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                type="button"
              >
                {refreshing ? "Odświeżam..." : "Odśwież"}
              </button>

              <button
                onClick={logout}
                className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                type="button"
              >
                Wyloguj
              </button>
            </div>
          </div>
        </div>
      </SurfaceCard>

      {tab === "overview" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-5">
            <SectionCard
              title="Szybkie akcje"
              subtitle="Najczęściej używane przejścia i skróty konta."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <QuickAction
                  href="/wallet"
                  title="Wallet"
                  description="Historia VB, filtry, wykresy i transakcje."
                />

                <QuickAction
                  href="/bets"
                  title="Moje kupony"
                  description="Szczegóły zakładów, statusy i historia typów."
                />

                <QuickAction
                  title="Statystyki"
                  description="ROI, skuteczność, aktywne kupony i wyniki."
                  onClick={() => setTab("stats")}
                />

                <QuickAction
                  title="Bezpieczeństwo"
                  description="Zmiana hasła, status emaila i sesja konta."
                  onClick={() => setTab("security")}
                />
              </div>
            </SectionCard>

            <SectionCard
              title="Ostatnie kupony"
              subtitle="Szybki podgląd najnowszych zakładów."
              action={
                <Link
                  href="/bets"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-300 transition hover:bg-neutral-900"
                >
                  Wszystkie kupony
                </Link>
              }
            >
              {recentBets.length === 0 ? (
                <EmptyState>Nie masz jeszcze żadnych kuponów.</EmptyState>
              ) : (
                <div className="space-y-3">
                  {recentBets.slice(0, 3).map((bet) => (
                    <Link
                      key={bet.id}
                      href={BET_DETAILS_PATH(bet.id)}
                      className="block rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 transition hover:bg-neutral-900"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs text-neutral-500">
                            {fmtDate(bet.created_at)}
                          </div>

                          <div className="mt-2 flex flex-wrap gap-2">
                            <span
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                                betStatusClass(bet.status)
                              )}
                            >
                              {betStatusLabel(bet.status)}
                            </span>

                            <span className="max-w-[240px] truncate rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-[11px] text-neutral-300">
                              ID: {bet.id}
                            </span>
                          </div>
                        </div>

                        <div className="text-right text-sm">
                          <div className="text-neutral-500">Stawka</div>
                          <div className="font-semibold text-white">
                            {fmt2(bet.stake)} VB
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          <div className="space-y-5">
            <SectionCard
              title="Stan konta"
              subtitle="Najważniejsze informacje o profilu i sesji."
            >
              <div className="space-y-3">
                <InfoField label="Email" value={email || "—"} />

                <InfoField
                  label="Status email"
                  value={
                    <StatusPill tone={emailConfirmedAt ? "green" : "yellow"}>
                      {emailConfirmedAt ? "Potwierdzony" : "Niepotwierdzony"}
                    </StatusPill>
                  }
                />

                <InfoField
                  label="Aktywność kuponów"
                  value={
                    activeBets > 0
                      ? `Masz obecnie ${activeBets} kupon(y) w grze.`
                      : "Nie masz teraz aktywnych kuponów."
                  }
                />

                <InfoField label="User ID" value={userId} />
              </div>
            </SectionCard>

            <SectionCard
              title="Wallet feed"
              subtitle="Ostatnie ruchy salda VB."
              action={
                <Link
                  href="/wallet"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-300 transition hover:bg-neutral-900"
                >
                  Pełny wallet
                </Link>
              }
            >
              {recentLedger.length === 0 ? (
                <EmptyState>Brak ostatnich transakcji.</EmptyState>
              ) : (
                <div className="space-y-2">
                  {recentLedger.slice(0, 4).map((row) => (
                    <div
                      key={row.id}
                      className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-neutral-100">
                            {kindLabel(row.kind)}
                          </div>
                          <div className="mt-1 text-xs text-neutral-500">
                            {fmtDate(row.created_at)}
                          </div>
                        </div>

                        <div
                          className={cn(
                            "shrink-0 text-sm font-semibold",
                            amountClass(Number(row.amount ?? 0))
                          )}
                        >
                          {Number(row.amount ?? 0) > 0 ? "+" : ""}
                          {fmt2(row.amount)} VB
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      ) : null}

      {tab === "stats" ? (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Wszystkie kupony"
              value={totalBets}
              hint="Łącznie z aktywnymi"
            />
            <MetricCard
              label="W grze"
              value={activeBets}
              hint="Jeszcze nierozliczone"
              tone="blue"
            />
            <MetricCard
              label="Wygrane"
              value={wonBets}
              hint="Rozliczone jako won"
              tone="green"
            />
            <MetricCard
              label="Przegrane"
              value={lostBets}
              hint="Rozliczone jako lost"
              tone="red"
            />
            <MetricCard label="Zwroty" value={voidBets} hint="Kupony void" />
            <MetricCard
              label="Rozliczone"
              value={settledBets}
              hint="Won + Lost + Void"
            />
            <MetricCard
              label="Winrate"
              value={fmtPct(winrateValue)}
              hint="Tylko rozliczone kupony"
            />
            <MetricCard
              label="ROI"
              value={fmtPct(roiValue)}
              hint="Zwrot z rozliczonych stawek"
              tone={roiTone}
            />
          </div>

          <SectionCard
            title="Rozkład wyników"
            subtitle="Szybki podgląd struktury Twoich kuponów."
          >
            <div className="space-y-4">
              <div className="h-4 overflow-hidden rounded-full border border-neutral-800 bg-neutral-950">
                <div className="flex h-full">
                  <div
                    className="bg-green-500"
                    style={{ width: `${wonPct}%` }}
                    title={`Wygrane: ${wonBets}`}
                  />
                  <div
                    className="bg-red-500"
                    style={{ width: `${lostPct}%` }}
                    title={`Przegrane: ${lostBets}`}
                  />
                  <div
                    className="bg-yellow-400"
                    style={{ width: `${voidPct}%` }}
                    title={`Zwroty: ${voidBets}`}
                  />
                  <div
                    className="bg-sky-500"
                    style={{ width: `${activePct}%` }}
                    title={`W grze: ${activeBets}`}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <InfoField label="Wygrane" value={`${wonBets} · ${fmtPct(wonPct)}`} />
                <InfoField
                  label="Przegrane"
                  value={`${lostBets} · ${fmtPct(lostPct)}`}
                />
                <InfoField label="Zwroty" value={`${voidBets} · ${fmtPct(voidPct)}`} />
                <InfoField label="W grze" value={`${activeBets} · ${fmtPct(activePct)}`} />
              </div>

              <div className="text-xs leading-6 text-neutral-500">
                Profit, ROI i winrate są liczone na podstawie rozliczonych
                kuponów, dzięki czemu aktywne zakłady nie zaniżają wyniku w
                trakcie gry.
              </div>
            </div>
          </SectionCard>
        </div>
      ) : null}

      {tab === "activity" ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <SectionCard
            title="Ostatnie kupony"
            subtitle="Najnowsze zakłady i ich status."
            action={
              <Link
                href="/bets"
                className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-300 transition hover:bg-neutral-900"
              >
                Wszystkie kupony
              </Link>
            }
          >
            {recentBets.length === 0 ? (
              <EmptyState>Nie masz jeszcze żadnych kuponów.</EmptyState>
            ) : (
              <div className="space-y-3">
                {recentBets.map((bet) => (
                  <Link
                    key={bet.id}
                    href={BET_DETAILS_PATH(bet.id)}
                    className="block rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 transition hover:bg-neutral-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-neutral-500">
                          {fmtDate(bet.created_at)}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          <span
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                              betStatusClass(bet.status)
                            )}
                          >
                            {betStatusLabel(bet.status)}
                          </span>

                          <span className="max-w-[260px] truncate rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-[11px] text-neutral-300">
                            ID: {bet.id}
                          </span>
                        </div>
                      </div>

                      <div className="text-right text-sm">
                        <div className="text-neutral-500">Stawka</div>
                        <div className="font-semibold text-white">
                          {fmt2(bet.stake)} VB
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                      <InfoField label="Kurs" value={fmt2(bet.total_odds)} />
                      <InfoField
                        label="Potencjalna"
                        value={`${fmt2(bet.potential_win)} VB`}
                      />
                      <InfoField
                        label="Wypłata"
                        value={
                          bet.payout != null ? `${fmt2(bet.payout)} VB` : "—"
                        }
                      />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Ostatnie ruchy w wallet"
            subtitle="Najświeższe zmiany salda VB."
            action={
              <Link
                href="/wallet"
                className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-300 transition hover:bg-neutral-900"
              >
                Pełny wallet
              </Link>
            }
          >
            {recentLedger.length === 0 ? (
              <EmptyState>Brak ostatnich transakcji.</EmptyState>
            ) : (
              <div className="space-y-2">
                {recentLedger.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-neutral-100">
                          {kindLabel(row.kind)}
                        </div>

                        <div className="mt-1 text-xs text-neutral-500">
                          {fmtDate(row.created_at)}
                        </div>

                        <div className="mt-2 text-xs text-neutral-400">
                          Saldo po:{" "}
                          <span className="text-neutral-200">
                            {row.balance_after == null
                              ? "—"
                              : `${fmt2(row.balance_after)} VB`}
                          </span>
                        </div>

                        {row.ref_type === "bet" && row.ref_id ? (
                          <Link
                            href={BET_DETAILS_PATH(row.ref_id)}
                            className="mt-2 inline-block text-xs font-semibold text-sky-300 underline underline-offset-4"
                          >
                            Otwórz kupon
                          </Link>
                        ) : null}
                      </div>

                      <div
                        className={cn(
                          "shrink-0 text-sm font-semibold",
                          amountClass(Number(row.amount ?? 0))
                        )}
                      >
                        {Number(row.amount ?? 0) > 0 ? "+" : ""}
                        {fmt2(row.amount)} VB
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      ) : null}

      {tab === "security" ? (
        <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
          <SectionCard
            title="Status konta"
            subtitle="Informacje bezpieczeństwa i sesji."
          >
            <div className="space-y-3">
              <InfoField label="Email" value={email || "—"} />

              <InfoField
                label="Potwierdzenie email"
                value={
                  <div className="space-y-2">
                    <StatusPill tone={emailConfirmedAt ? "green" : "yellow"}>
                      {emailConfirmedAt ? "Potwierdzony" : "Niepotwierdzony"}
                    </StatusPill>

                    <div className="text-xs text-neutral-500">
                      {emailConfirmedAt
                        ? `Potwierdzono: ${fmtDate(emailConfirmedAt)}`
                        : "Potwierdź email, aby w pełni korzystać z konta."}
                    </div>
                  </div>
                }
              />

              <InfoField
                label="Sesja"
                value={
                  <div>
                    Jesteś zalogowany jako{" "}
                    <span className="font-semibold">{displayName}</span>.
                  </div>
                }
              />

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => load(true)}
                  type="button"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  {refreshing ? "Odświeżam..." : "Odśwież dane"}
                </button>

                <button
                  onClick={logout}
                  type="button"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Wyloguj
                </button>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Zmiana hasła"
            subtitle={
              isRecovery
                ? "Ustaw nowe hasło po użyciu linku resetującego."
                : "Dla bezpieczeństwa wymagamy podania starego hasła."
            }
          >
            <div className="space-y-4">
              {cpError ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
                  {cpError}
                </div>
              ) : null}

              {cpOk ? (
                <div className="rounded-2xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-200">
                  {cpOk}
                </div>
              ) : null}

              {!isRecovery ? (
                <div className="space-y-1">
                  <div className="text-xs text-neutral-400">Stare hasło</div>
                  <input
                    type="password"
                    value={oldPass}
                    onChange={(e) => setOldPass(e.target.value)}
                    className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-white outline-none transition focus:border-neutral-600"
                    autoComplete="current-password"
                    placeholder="Wpisz stare hasło"
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 text-sm text-sky-200">
                  Jesteś w trybie resetowania hasła. Nie musisz znać starego
                  hasła — wpisz tylko nowe.
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-xs text-neutral-400">Nowe hasło</div>
                  <input
                    type="password"
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    className={cn(
                      "w-full rounded-2xl border bg-neutral-950 px-4 py-3 text-sm text-white outline-none transition focus:border-neutral-600",
                      newPassTooShort || (!isRecovery && sameAsOldPass)
                        ? "border-red-700"
                        : "border-neutral-800"
                    )}
                    autoComplete="new-password"
                    placeholder="Minimum 8 znaków"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-neutral-400">
                    Potwierdź nowe hasło
                  </div>
                  <input
                    type="password"
                    value={newPass2}
                    onChange={(e) => setNewPass2(e.target.value)}
                    className={cn(
                      "w-full rounded-2xl border bg-neutral-950 px-4 py-3 text-sm text-white outline-none transition focus:border-neutral-600",
                      passMismatch ? "border-red-700" : "border-neutral-800"
                    )}
                    autoComplete="new-password"
                    placeholder="Powtórz nowe hasło"
                  />
                </div>
              </div>

              <div className="grid gap-2 text-[11px] sm:grid-cols-3">
                {!isRecovery ? (
                  <div
                    className={cn(
                      "rounded-xl border px-3 py-2",
                      oldPass
                        ? "border-green-500/30 bg-green-500/10 text-green-300"
                        : "border-neutral-800 bg-neutral-950/70 text-neutral-400"
                    )}
                  >
                    Stare hasło wpisane
                  </div>
                ) : (
                  <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sky-300">
                    Tryb resetowania aktywny
                  </div>
                )}

                <div
                  className={cn(
                    "rounded-xl border px-3 py-2",
                    !newPassTooShort && !!newPass
                      ? "border-green-500/30 bg-green-500/10 text-green-300"
                      : "border-neutral-800 bg-neutral-950/70 text-neutral-400"
                  )}
                >
                  Minimum 8 znaków
                </div>

                <div
                  className={cn(
                    "rounded-xl border px-3 py-2",
                    !passMismatch &&
                      !!newPass &&
                      !!newPass2 &&
                      (isRecovery || !sameAsOldPass)
                      ? "border-green-500/30 bg-green-500/10 text-green-300"
                      : "border-neutral-800 bg-neutral-950/70 text-neutral-400"
                  )}
                >
                  Hasła zgodne i nowe
                </div>
              </div>

              {passMismatch ? (
                <div className="text-xs text-red-300">
                  Hasła nie są identyczne.
                </div>
              ) : null}

              {newPassTooShort ? (
                <div className="text-xs text-red-300">
                  Nowe hasło musi mieć co najmniej 8 znaków.
                </div>
              ) : null}

              {!isRecovery && sameAsOldPass ? (
                <div className="text-xs text-red-300">
                  Nowe hasło nie może być takie samo jak stare.
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={submitChangePassword}
                  disabled={!canSubmitPass}
                  type="button"
                  className="rounded-2xl border border-green-700/40 bg-green-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-green-700"
                >
                  {cpLoading
                    ? "Zmieniam..."
                    : isRecovery
                      ? "Ustaw nowe hasło"
                      : "Zmień hasło"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCpError(null);
                    setCpOk(null);
                    setOldPass("");
                    setNewPass("");
                    setNewPass2("");
                  }}
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Wyczyść
                </button>
              </div>

              <div className="text-xs leading-6 text-neutral-500">
                Po zmianie hasła sesja zwykle pozostaje aktywna. Później można
                dodać wymuszenie ponownego logowania na wszystkich urządzeniach.
              </div>
            </div>
          </SectionCard>
        </div>
      ) : null}
    </div>
  );
}