//app/(noslip)/account/page.tsx
"use client";

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

const BET_DETAILS_PATH = (betId: string) => `/bets/${betId}`;


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

function betStatusClass(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "won") return "border-green-500/30 bg-green-500/10 text-green-300";
  if (s === "lost") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (s === "void") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
  return "border-sky-500/30 bg-sky-500/10 text-sky-300";
}

function toneClass(tone?: "neutral" | "positive" | "negative" | "accent") {
  if (tone === "positive") return "text-green-400";
  if (tone === "negative") return "text-red-400";
  if (tone === "accent") return "text-sky-300";
  return "text-white";
}

function TabButton({
  active,
  onClick,
  children,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: string | number | null;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={[
        "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition",
        active
          ? "border-sky-500/40 bg-sky-500/10 text-white"
          : "border-neutral-800 bg-neutral-950 hover:bg-neutral-900 text-neutral-200",
      ].join(" ")}
    >
      <span>{children}</span>
      {badge != null ? (
        <span
          className={[
            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
            active ? "bg-white/10 text-white" : "bg-neutral-800 text-neutral-300",
          ].join(" ")}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function StatCard({
  title,
  value,
  hint,
  tone = "neutral",
}: {
  title: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "neutral" | "positive" | "negative" | "accent";
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/50 p-4">
      <div className="text-xs text-neutral-400">{title}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass(tone)}`}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-neutral-500">{hint}</div> : null}
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{title}</div>
          {subtitle ? <div className="mt-1 text-sm text-neutral-400">{subtitle}</div> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 animate-pulse">
      <div className="h-40 rounded-3xl border border-neutral-800 bg-neutral-900/50" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 rounded-2xl border border-neutral-800 bg-neutral-900/40"
          />
        ))}
      </div>
      <div className="h-16 rounded-2xl border border-neutral-800 bg-neutral-900/40" />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="h-72 rounded-2xl border border-neutral-800 bg-neutral-900/40" />
        <div className="h-72 rounded-2xl border border-neutral-800 bg-neutral-900/40" />
      </div>
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

  // password form
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

  const publicProfileHref = username?.trim()
    ? `/users/${encodeURIComponent(username.trim())}`
    : null;

  const load = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
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
    load(false);
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

      load(true);
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
        isRecovery
          ? "Nowe hasło zostało ustawione ✅"
          : "Hasło zostało zmienione ✅"
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
    <div className="mx-auto max-w-6xl space-y-4">
      <section className="rounded-3xl border border-neutral-800 bg-gradient-to-br from-neutral-900 via-neutral-900 to-sky-950/20 p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-300">
              Centrum konta
            </div>

            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Cześć, {displayName}</h1>
              <p className="mt-2 max-w-2xl text-sm text-neutral-400">
                Tutaj masz szybki dostęp do salda, statystyk kuponów, ostatniej aktywności
                oraz ustawień bezpieczeństwa konta.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <span className="rounded-full border border-neutral-800 bg-neutral-950/70 px-3 py-1 text-xs text-neutral-300">
                {email || "—"}
              </span>

              <span
                className={[
                  "rounded-full border px-3 py-1 text-xs font-semibold",
                  emailConfirmedAt
                    ? "border-green-500/30 bg-green-500/10 text-green-300"
                    : "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
                ].join(" ")}
              >
                {emailConfirmedAt ? "Email potwierdzony" : "Email niepotwierdzony"}
              </span>

              <span className="rounded-full border border-neutral-800 bg-neutral-950/70 px-3 py-1 text-xs text-neutral-400">
                ID: {userId}
              </span>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Link
                href="/wallet"
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-900"
              >
                Otwórz wallet
              </Link>

              <Link
                href="/bets"
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-900"
              >
                Moje kupony
              </Link>

              <Link
                href="/leaderboard"
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-900"
              >
                Ranking
              </Link>

              {publicProfileHref ? (
                <Link
                  href={publicProfileHref}
                  className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-900"
                >
                  Profil publiczny
                </Link>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:min-w-[340px]">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
              <div className="text-xs text-neutral-400">Aktualne saldo</div>
              <div className="mt-1 text-3xl font-semibold text-white">
                {balance == null ? "..." : `${fmt0(balance)} VB`}
              </div>
              <div className="mt-1 text-[11px] text-neutral-500">
                Stan portfela z profilu użytkownika
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
              <div className="text-xs text-neutral-400">Kupony w grze</div>
              <div className="mt-1 text-3xl font-semibold text-sky-300">{activeBets}</div>
              <div className="mt-1 text-[11px] text-neutral-500">
                Aktywne kupony, które nie zostały jeszcze rozliczone
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="sticky top-20 z-10 rounded-2xl border border-neutral-800 bg-black/60 p-3 backdrop-blur supports-[backdrop-filter]:bg-black/45">
        <div className="flex flex-wrap items-center gap-2">
          <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
            Przegląd
          </TabButton>

          <TabButton active={tab === "stats"} onClick={() => setTab("stats")} badge={totalBets}>
            Statystyki
          </TabButton>

          <TabButton
            active={tab === "activity"}
            onClick={() => setTab("activity")}
            badge={recentBets.length + recentLedger.length}
          >
            Aktywność
          </TabButton>

          <TabButton active={tab === "security"} onClick={() => setTab("security")}>
            Bezpieczeństwo
          </TabButton>

          <div className="ml-auto flex gap-2">
            <button
              onClick={() => load(true)}
              className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-900"
              type="button"
            >
              {refreshing ? "Odświeżam..." : "Odśwież"}
            </button>

            <button
              onClick={logout}
              className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-900"
              type="button"
            >
              Wyloguj
            </button>
          </div>
        </div>
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              title="Saldo"
              value={`${fmt0(balance)} VB`}
              hint="Aktualny stan portfela"
              tone="accent"
            />
            <StatCard
              title="Profit"
              value={`${profitValue > 0 ? "+" : ""}${fmt2(profitValue)} VB`}
              hint="Tylko z rozliczonych kuponów"
              tone={profitValue > 0 ? "positive" : profitValue < 0 ? "negative" : "neutral"}
            />
            <StatCard
              title="Winrate"
              value={fmtPct(winrateValue)}
              hint="Skuteczność z rozliczonych kuponów"
            />
            <StatCard
              title="ROI"
              value={fmtPct(roiValue)}
              hint="Zwrot z rozliczonych stawek"
              tone={roiValue > 0 ? "positive" : roiValue < 0 ? "negative" : "neutral"}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <SectionCard
              title="Szybkie akcje"
              subtitle="Najczęściej używane przejścia i skróty"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Link
                  href="/wallet"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950/50 p-4 transition hover:bg-neutral-900"
                >
                  <div className="font-semibold">Wallet</div>
                  <div className="mt-1 text-sm text-neutral-400">
                    Historia VB, filtry, wykresy i transakcje.
                  </div>
                </Link>

                <Link
                  href="/bets"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950/50 p-4 transition hover:bg-neutral-900"
                >
                  <div className="font-semibold">Moje kupony</div>
                  <div className="mt-1 text-sm text-neutral-400">
                    Szczegóły zakładów, statusy i historia typów.
                  </div>
                </Link>

                <button
                  onClick={() => setTab("stats")}
                  type="button"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950/50 p-4 text-left transition hover:bg-neutral-900"
                >
                  <div className="font-semibold">Statystyki</div>
                  <div className="mt-1 text-sm text-neutral-400">
                    ROI, skuteczność, aktywne kupony i wyniki.
                  </div>
                </button>

                <button
                  onClick={() => setTab("security")}
                  type="button"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950/50 p-4 text-left transition hover:bg-neutral-900"
                >
                  <div className="font-semibold">Bezpieczeństwo</div>
                  <div className="mt-1 text-sm text-neutral-400">
                    Zmiana hasła i status konta.
                  </div>
                </button>
              </div>
            </SectionCard>

            <SectionCard
              title="Stan konta"
              subtitle="Najważniejsze informacje o profilu i sesji"
            >
              <div className="space-y-3 text-sm">
                <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
                  <div className="text-xs text-neutral-400">Email</div>
                  <div className="mt-1 text-neutral-100 break-all">{email || "—"}</div>
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
                  <div className="text-xs text-neutral-400">Status email</div>
                  <div className="mt-1">
                    <span
                      className={[
                        "rounded-full border px-2.5 py-1 text-xs font-semibold",
                        emailConfirmedAt
                          ? "border-green-500/30 bg-green-500/10 text-green-300"
                          : "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
                      ].join(" ")}
                    >
                      {emailConfirmedAt ? "Potwierdzony" : "Niepotwierdzony"}
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
                  <div className="text-xs text-neutral-400">Aktywność kuponów</div>
                  <div className="mt-1 text-neutral-100">
                    {activeBets > 0
                      ? `Masz obecnie ${activeBets} kupon(y) w grze.`
                      : "Nie masz teraz aktywnych kuponów."}
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
                  <div className="text-xs text-neutral-400">User ID</div>
                  <div className="mt-1 text-[13px] text-neutral-300 break-all">{userId}</div>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      )}

      {tab === "stats" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard title="Wszystkie kupony" value={totalBets} hint="Łącznie z aktywnymi" />
            <StatCard title="W grze" value={activeBets} hint="Jeszcze nierozliczone" tone="accent" />
            <StatCard title="Wygrane" value={wonBets} hint="Rozliczone jako won" tone="positive" />
            <StatCard title="Przegrane" value={lostBets} hint="Rozliczone jako lost" tone="negative" />
            <StatCard title="Zwroty" value={voidBets} hint="Kupony typu void" />
            <StatCard title="Rozliczone" value={settledBets} hint="Won + Lost + Void" />
            <StatCard
              title="Winrate"
              value={fmtPct(winrateValue)}
              hint="Tylko rozliczone kupony"
            />
            <StatCard
              title="ROI"
              value={fmtPct(roiValue)}
              hint="Zwrot z rozliczonych stawek"
              tone={roiValue > 0 ? "positive" : roiValue < 0 ? "negative" : "neutral"}
            />
          </div>

          <SectionCard
            title="Rozkład wyników"
            subtitle="Szybki podgląd struktury Twoich kuponów"
          >
            <div className="space-y-3">
              <div className="h-3 overflow-hidden rounded-full border border-neutral-800 bg-neutral-950">
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

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
                  <div className="text-neutral-400">Wygrane</div>
                  <div className="mt-1 font-semibold text-green-400">
                    {wonBets} · {fmtPct(wonPct)}
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
                  <div className="text-neutral-400">Przegrane</div>
                  <div className="mt-1 font-semibold text-red-400">
                    {lostBets} · {fmtPct(lostPct)}
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
                  <div className="text-neutral-400">Zwroty</div>
                  <div className="mt-1 font-semibold text-yellow-300">
                    {voidBets} · {fmtPct(voidPct)}
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
                  <div className="text-neutral-400">W grze</div>
                  <div className="mt-1 font-semibold text-sky-300">
                    {activeBets} · {fmtPct(activePct)}
                  </div>
                </div>
              </div>

              <div className="text-xs text-neutral-500">
                Profit, ROI i winrate są liczone na podstawie rozliczonych kuponów, dzięki czemu
                aktywne zakłady nie zaniżają wyniku w trakcie gry.
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {tab === "activity" && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <SectionCard
            title="Ostatnie kupony"
            subtitle="Najnowsze zakłady i ich status"
            action={
              <Link
                href="/bets"
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 transition hover:bg-neutral-900"
              >
                Wszystkie kupony
              </Link>
            }
          >
            {recentBets.length === 0 ? (
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4 text-sm text-neutral-400">
                Nie masz jeszcze żadnych kuponów.
              </div>
            ) : (
              <div className="space-y-3">
                {recentBets.map((bet) => (
                  <Link
                    key={bet.id}
                    href={BET_DETAILS_PATH(bet.id)}
                    className="block rounded-2xl border border-neutral-800 bg-neutral-950/50 p-4 transition hover:bg-neutral-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-neutral-500">
                          {new Date(bet.created_at).toLocaleString()}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span
                            className={[
                              "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                              betStatusClass(bet.status),
                            ].join(" ")}
                          >
                            {betStatusLabel(bet.status)}
                          </span>
                          <span className="rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-[11px] text-neutral-300">
                            ID: {bet.id}
                          </span>
                        </div>
                      </div>

                      <div className="text-right text-sm">
                        <div className="text-neutral-400">Stawka</div>
                        <div className="font-semibold text-white">{fmt2(bet.stake)} VB</div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-neutral-400">Kurs</div>
                        <div className="font-semibold text-neutral-100">
                          {fmt2(bet.total_odds)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-neutral-400">Potencjalna wygrana</div>
                        <div className="font-semibold text-neutral-100">
                          {fmt2(bet.potential_win)} VB
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-neutral-400">Wypłata</div>
                        <div className="font-semibold text-neutral-100">
                          {bet.payout != null ? `${fmt2(bet.payout)} VB` : "—"}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Ostatnie ruchy w wallet"
            subtitle="Najświeższe zmiany salda VB"
            action={
              <Link
                href="/wallet"
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 transition hover:bg-neutral-900"
              >
                Pełny wallet
              </Link>
            }
          >
            {recentLedger.length === 0 ? (
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4 text-sm text-neutral-400">
                Brak ostatnich transakcji.
              </div>
            ) : (
              <div className="space-y-2">
                {recentLedger.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-neutral-100">
                          {kindLabel(row.kind)}
                        </div>
                        <div className="mt-1 text-xs text-neutral-500">
                          {new Date(row.created_at).toLocaleString()}
                        </div>
                        <div className="mt-1 text-xs text-neutral-400">
                          Saldo po:{" "}
                          <span className="text-neutral-200">
                            {row.balance_after == null ? "—" : `${fmt2(row.balance_after)} VB`}
                          </span>
                        </div>
                        {row.ref_type === "bet" && row.ref_id ? (
                          <Link
                            href={BET_DETAILS_PATH(row.ref_id)}
                            className="mt-1 inline-block text-xs text-sky-300 underline underline-offset-2"
                          >
                            Otwórz kupon
                          </Link>
                        ) : null}
                      </div>

                      <div className={`text-sm font-semibold ${amountClass(Number(row.amount ?? 0))}`}>
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
      )}

      {tab === "security" && (
        <div className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-4">
          <SectionCard title="Status konta" subtitle="Informacje bezpieczeństwa i sesji">
            <div className="space-y-3">
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4">
                <div className="text-xs text-neutral-400">Email</div>
                <div className="mt-1 text-sm text-neutral-100 break-all">{email || "—"}</div>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4">
                <div className="text-xs text-neutral-400">Potwierdzenie email</div>
                <div className="mt-2">
                  <span
                    className={[
                      "rounded-full border px-2.5 py-1 text-xs font-semibold",
                      emailConfirmedAt
                        ? "border-green-500/30 bg-green-500/10 text-green-300"
                        : "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
                    ].join(" ")}
                  >
                    {emailConfirmedAt ? "Potwierdzony" : "Niepotwierdzony"}
                  </span>
                </div>
                <div className="mt-2 text-xs text-neutral-500">
                  {emailConfirmedAt
                    ? `Potwierdzono: ${new Date(emailConfirmedAt).toLocaleString()}`
                    : "Potwierdź email, aby w pełni korzystać z konta."}
                </div>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4">
                <div className="text-xs text-neutral-400">Sesja</div>
                <div className="mt-1 text-sm text-neutral-100">
                  Jesteś zalogowany jako <span className="font-semibold">{displayName}</span>.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => load(true)}
                    type="button"
                    className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-900"
                  >
                    {refreshing ? "Odświeżam..." : "Odśwież dane"}
                  </button>

                  <button
                    onClick={logout}
                    type="button"
                    className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-900"
                  >
                    Wyloguj
                  </button>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Zmiana hasła"
            subtitle={
            isRecovery
              ? "Ustaw nowe hasło po użyciu linku resetującego"
              : "Dla bezpieczeństwa wymagamy podania starego hasła"
            }
          >
            <div className="space-y-4">
              {cpError ? (
                <div className="rounded-2xl border border-red-900/50 bg-red-900/10 p-4 text-sm text-red-200">
                  {cpError}
                </div>
              ) : null}

              {cpOk ? (
                <div className="rounded-2xl border border-green-900/50 bg-green-900/10 p-4 text-sm text-green-200">
                  {cpOk}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3">
                {!isRecovery ? (
                  <div className="space-y-1">
                    <div className="text-xs text-neutral-400">Stare hasło</div>
                    <input
                      type="password"
                      value={oldPass}
                      onChange={(e) => setOldPass(e.target.value)}
                      className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-3 text-sm"
                      autoComplete="current-password"
                      placeholder="Wpisz stare hasło"
                    />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 text-sm text-sky-200">
                    Jesteś w trybie resetowania hasła. Nie musisz znać starego hasła — wpisz tylko nowe.
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="text-xs text-neutral-400">Nowe hasło</div>
                    <input
                      type="password"
                      value={newPass}
                      onChange={(e) => setNewPass(e.target.value)}
                      className={[
                        "w-full rounded-xl border bg-neutral-950 px-3 py-3 text-sm",
                        newPassTooShort || (!isRecovery && sameAsOldPass)
                          ? "border-red-700"
                          : "border-neutral-800",
                      ].join(" ")}
                      autoComplete="new-password"
                      placeholder="Minimum 8 znaków"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-neutral-400">Potwierdź nowe hasło</div>
                    <input
                      type="password"
                      value={newPass2}
                      onChange={(e) => setNewPass2(e.target.value)}
                      className={[
                        "w-full rounded-xl border bg-neutral-950 px-3 py-3 text-sm",
                        passMismatch ? "border-red-700" : "border-neutral-800",
                      ].join(" ")}
                      autoComplete="new-password"
                      placeholder="Powtórz nowe hasło"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                  {!isRecovery ? (
                    <div
                      className={[
                        "rounded-xl border px-3 py-2",
                        oldPass
                          ? "border-green-500/30 bg-green-500/10 text-green-300"
                          : "border-neutral-800 bg-neutral-950/50 text-neutral-400",
                      ].join(" ")}
                    >
                      Stare hasło wpisane
                    </div>
                  ) : (
                    <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sky-300">
                      Tryb resetowania aktywny
                    </div>
                  )}

                  <div
                    className={[
                      "rounded-xl border px-3 py-2",
                      !newPassTooShort && !!newPass
                        ? "border-green-500/30 bg-green-500/10 text-green-300"
                        : "border-neutral-800 bg-neutral-950/50 text-neutral-400",
                    ].join(" ")}
                  >
                    Minimum 8 znaków
                  </div>

                  <div
                    className={[
                      "rounded-xl border px-3 py-2",
                      !passMismatch && !!newPass && !!newPass2 && (isRecovery || !sameAsOldPass)
                        ? "border-green-500/30 bg-green-500/10 text-green-300"
                        : "border-neutral-800 bg-neutral-950/50 text-neutral-400",
                    ].join(" ")}
                  >
                    Hasła zgodne i nowe
                  </div>
                </div>

                {passMismatch ? (
                  <div className="text-xs text-red-300">Hasła nie są identyczne.</div>
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
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={submitChangePassword}
                  disabled={!canSubmitPass}
                  type="button"
                  className="rounded-xl border border-neutral-800 bg-green-700 px-4 py-2 text-sm text-white transition hover:bg-green-600 disabled:opacity-50 disabled:hover:bg-green-700"
                >
                  {cpLoading ? "Zmieniam..." : isRecovery ? "Ustaw nowe hasło" : "Zmień hasło"}
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
                  className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-900"
                >
                  Wyczyść
                </button>
              </div>

              <div className="text-xs text-neutral-500">
                Po zmianie hasła sesja zwykle pozostaje aktywna. Jeśli będziesz chciał, możemy
                później wymusić ponowne logowanie na wszystkich urządzeniach.
              </div>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}