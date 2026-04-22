// components/Topbar.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "./useSession";
import { formatVB } from "@/lib/format";

type ProfileBalanceRow = {
  balance_vb: number | string | null;
};

type AdminRow = {
  user_id: string;
};

type RefreshBalanceDetail = {
  balance_vb?: number | string | null;
  balanceAfter?: number | string | null;
};

type NavItem = {
  href: string;
  label: string;
  requiresAuth?: boolean;
  adminOnly?: boolean;
};

const BASE_NAV: NavItem[] = [
  { href: "/events", label: "Mecze" },
  { href: "/leaderboard", label: "Ranking" },
  { href: "/bets", label: "Kupony", requiresAuth: true },
  { href: "/groups", label: "Grupy", requiresAuth: true },
  { href: "/admin", label: "Admin", requiresAuth: true, adminOnly: true },
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function toBalance(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPathActive(pathname: string, href: string) {
  if (href === "/events") {
    return pathname === "/events" || pathname.startsWith("/events/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinkItem({
  href,
  label,
  active,
  compact = false,
}: {
  href: string;
  label: string;
  active: boolean;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "rounded-2xl border text-sm font-medium transition",
        compact ? "px-3 py-2 whitespace-nowrap" : "px-4 py-2.5",
        active
          ? "border-white/15 bg-white text-black"
          : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-800 hover:text-white"
      )}
    >
      {label}
    </Link>
  );
}

export default function Topbar() {
  const pathname = usePathname() || "/";
  const { session, loading } = useSession();

  const [balanceVb, setBalanceVb] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadBalance = async () => {
      if (!session?.user?.id) {
        if (!cancelled) {
          setBalanceVb(null);
        }
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("balance_vb")
        .eq("id", session.user.id)
        .maybeSingle();

      if (cancelled) return;
      if (error) return;

      const row = (data ?? null) as ProfileBalanceRow | null;
      setBalanceVb(toBalance(row?.balance_vb));
    };

    void loadBalance();

    const onRefresh: EventListener = (event) => {
      const customEvent = event as CustomEvent<RefreshBalanceDetail>;
      const maybeBalance =
        customEvent.detail?.balance_vb ?? customEvent.detail?.balanceAfter;

      if (maybeBalance != null) {
        const parsed = Number(maybeBalance);
        if (Number.isFinite(parsed)) {
          setBalanceVb(parsed);
          return;
        }
      }

      void loadBalance();
    };

    window.addEventListener("vb:refresh-balance", onRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener("vb:refresh-balance", onRefresh);
    };
  }, [session?.user?.id]);

  useEffect(() => {
    let cancelled = false;

    const checkAdmin = async () => {
      try {
        setCheckingAdmin(true);

        if (!session?.user?.id) {
          if (!cancelled) {
            setIsAdmin(false);
            setCheckingAdmin(false);
          }
          return;
        }

        const { data, error } = await supabase
          .from("admins")
          .select("user_id")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (cancelled) return;

        const adminRow = (data ?? null) as AdminRow | null;
        setIsAdmin(!error && !!adminRow);
      } catch {
        if (!cancelled) {
          setIsAdmin(false);
        }
      } finally {
        if (!cancelled) {
          setCheckingAdmin(false);
        }
      }
    };

    void checkAdmin();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const isLoggedIn = !!session;

  const visibleNav = useMemo(() => {
    return BASE_NAV.filter((item) => {
      if (item.requiresAuth && !isLoggedIn) return false;
      if (item.adminOnly) return !checkingAdmin && isAdmin;
      return true;
    });
  }, [isLoggedIn, checkingAdmin, isAdmin]);

  return (
    <header className="sticky top-0 z-50 border-b border-neutral-800/90 bg-neutral-950/90 backdrop-blur-xl">
      <div className="w-full px-3 py-3 sm:px-4 xl:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/events"
              className="group flex items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 px-3 py-2 transition hover:bg-neutral-900"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-neutral-800 bg-white text-sm font-black text-black">
                VB
              </div>

              <div className="min-w-0">
                <div className="text-sm font-semibold tracking-wide text-white">
                  VirtualBook
                </div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                  Football
                </div>
              </div>
            </Link>

            <nav className="hidden xl:flex items-center gap-2">
              {visibleNav.map((item) => (
                <NavLinkItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  active={isPathActive(pathname, item.href)}
                />
              ))}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {loading ? null : isLoggedIn ? (
              <>
                <div className="hidden md:flex items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-2.5">
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                      Saldo
                    </div>
                    <div className="text-sm font-semibold text-white">
                      {balanceVb === null ? "..." : `${formatVB(balanceVb)} VB`}
                    </div>
                  </div>
                </div>

                <Link
                  href="/account"
                  className={cx(
                    "rounded-2xl border px-4 py-2.5 text-sm font-medium transition",
                    isPathActive(pathname, "/account")
                      ? "border-white/15 bg-white text-black"
                      : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-800"
                  )}
                >
                  Moje konto
                </Link>

                <button
                  onClick={logout}
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-medium text-neutral-200 transition hover:bg-neutral-800"
                >
                  Wyloguj
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  href="/login"
                  className={cx(
                    "rounded-2xl border px-4 py-2.5 text-sm font-medium transition",
                    isPathActive(pathname, "/login")
                      ? "border-white/15 bg-white text-black"
                      : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-800"
                  )}
                >
                  Logowanie
                </Link>

                <Link
                  href="/register"
                  className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-neutral-200"
                >
                  Rejestracja
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 xl:hidden">
          <div className="overflow-x-auto pb-1">
            <div className="flex items-center gap-2">
              {visibleNav.map((item) => (
                <NavLinkItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  active={isPathActive(pathname, item.href)}
                  compact
                />
              ))}

              {isLoggedIn ? (
                <div className="ml-1 shrink-0 rounded-2xl border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs text-neutral-300 md:hidden">
                  Saldo:{" "}
                  <span className="font-semibold text-white">
                    {balanceVb === null ? "..." : `${formatVB(balanceVb)} VB`}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}