// components/Topbar.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSession } from "./useSession";
import { formatVB } from "@/lib/format";

const NavLink = ({ href, label }: { href: string; label: string }) => (
  <Link
    href={href}
    className="px-3 py-2 rounded-lg text-sm text-neutral-200 hover:bg-neutral-800 hover:text-white transition"
  >
    {label}
  </Link>
);

export default function Topbar() {
  const { session, loading } = useSession();
  const [balanceVb, setBalanceVb] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!session?.user?.id) {
        setBalanceVb(null);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("balance_vb")
        .eq("id", session.user.id)
        .single();

      if (cancelled) return;
      if (!error) setBalanceVb(Number((data as any)?.balance_vb ?? 0));
    };

    load();

    const onRefresh = (e?: Event) => {
      const ce = e as CustomEvent | undefined;
      const maybe = ce?.detail?.balance_vb ?? ce?.detail?.balanceAfter;
      if (maybe != null) {
        const n = Number(maybe);
        if (Number.isFinite(n)) {
          setBalanceVb(n);
          return;
        }
      }
      load();
    };

    window.addEventListener("vb:refresh-balance", onRefresh as any);

    return () => {
      cancelled = true;
      window.removeEventListener("vb:refresh-balance", onRefresh as any);
    };
  }, [session?.user?.id]);

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <header className="sticky top-0 z-50 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/events" className="font-bold tracking-wide text-white">
            VirtualBook
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            <NavLink href="/events" label="Mecze" />
            <NavLink href="/bets" label="Kupony" />
            <NavLink href="/leaderboard" label="Ranking" />
            <NavLink href="/groups" label="Grupy" />
            <NavLink href="/admin" label="Admin" />
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {loading ? null : session ? (
            <>
              <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl border border-neutral-800 bg-neutral-900/40">
                <span className="text-xs text-neutral-400">Saldo</span>
                <span className="text-sm font-semibold">
                  {balanceVb === null ? "..." : `${formatVB(balanceVb)} VB`}
                </span>
              </div>

              <Link
                href="/account"
                className="px-3 py-2 rounded-lg text-sm border border-neutral-700 hover:bg-neutral-800 transition"
              >
                Moje konto
              </Link>

              <button
                onClick={logout}
                className="px-3 py-2 rounded-lg text-sm border border-neutral-700 hover:bg-neutral-800 transition"
              >
                Wyloguj
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="px-3 py-2 rounded-lg text-sm bg-white text-black hover:bg-neutral-200 transition"
            >
              Konto
            </Link>
          )}
        </div>
      </div>

      <div className="md:hidden border-t border-neutral-800">
        <div className="mx-auto max-w-6xl px-2 py-2 flex items-center justify-around">
          <NavLink href="/events" label="Mecze" />
          <NavLink href="/bets" label="Kupony" />
          <NavLink href="/leaderboard" label="Ranking" />
          <NavLink href="/groups" label="Grupy" />
          <NavLink href="/admin" label="Admin" />
        </div>
      </div>
    </header>
  );
}