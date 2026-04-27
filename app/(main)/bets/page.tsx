// app/(main)/bets/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatOdd, formatVB } from "@/lib/format";
import { formatBetSelectionLabels } from "@/lib/odds/labels";
import { supabase } from "@/lib/supabase";

type BetStatus = "all" | "pending" | "won" | "lost" | "void";

type Bet = {
  id: string;
  user_id: string;
  stake: number;
  total_odds: number;
  potential_win: number;
  status: "pending" | "won" | "lost" | "void" | string;
  created_at: string;
};

type BetItem = {
  id: string;
  bet_id: string;
  user_id: string;
  match_id_bigint: number;
  league: string;
  home: string;
  away: string;
  market: string;
  pick: string;
  odds: number;
  kickoff_at: string | null;
  created_at: string;
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function betCardWrapperClass(status: string) {
  const s = String(status || "").toLowerCase();

  if (s === "won") {
    return [
      "border-green-500/20",
      "bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.14),transparent_30%),linear-gradient(90deg,rgba(22,101,52,0.20),rgba(10,10,10,0.96)_38%,rgba(3,3,3,0.99))]",
      "shadow-[0_10px_40px_rgba(0,0,0,0.22)]",
    ].join(" ");
  }

  if (s === "lost") {
    return [
      "border-red-500/20",
      "bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.14),transparent_30%),linear-gradient(90deg,rgba(127,29,29,0.20),rgba(10,10,10,0.96)_38%,rgba(3,3,3,0.99))]",
      "shadow-[0_10px_40px_rgba(0,0,0,0.22)]",
    ].join(" ");
  }

  return [
    "border-neutral-800",
    "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.06),transparent_28%),linear-gradient(90deg,rgba(23,23,23,0.92),rgba(5,5,5,0.98))]",
  ].join(" ");
}

function safeNumber(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmtDate(value?: string | null) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function labelStatus(status: string) {
  const s = String(status || "").toLowerCase();

  if (s === "won") return "WYGRANY";
  if (s === "lost") return "PRZEGRANY";
  if (s === "void") return "ZWROT";

  return "OCZEKUJE";
}

function statusTone(status: string): "green" | "red" | "yellow" | "neutral" {
  const s = String(status || "").toLowerCase();

  if (s === "won") return "green";
  if (s === "lost") return "red";
  if (s === "void") return "neutral";

  return "yellow";
}

function SurfaceCard({
  children,
  className,
}: {
  children: React.ReactNode;
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

function SmallPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "green" | "red" | "yellow" | "blue";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold",
        tone === "neutral" &&
          "border-neutral-800 bg-neutral-950 text-neutral-300",
        tone === "green" && "border-green-500/30 bg-green-500/10 text-green-300",
        tone === "red" && "border-red-500/30 bg-red-500/10 text-red-300",
        tone === "yellow" &&
          "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
        tone === "blue" && "border-sky-500/30 bg-sky-500/10 text-sky-300"
      )}
    >
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "neutral" | "green" | "red" | "yellow" | "blue";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        tone === "neutral" && "border-neutral-800 bg-neutral-950/80",
        tone === "green" && "border-green-500/20 bg-green-500/10",
        tone === "red" && "border-red-500/20 bg-red-500/10",
        tone === "yellow" && "border-yellow-500/20 bg-yellow-500/10",
        tone === "blue" && "border-sky-500/20 bg-sky-500/10"
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </div>

      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>

      {hint ? <div className="mt-1 text-xs text-neutral-500">{hint}</div> : null}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-3xl border border-neutral-800 bg-neutral-950/70 p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="h-4 w-40 rounded bg-neutral-800" />
            <div className="h-7 w-24 rounded-full bg-neutral-800" />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className="h-14 rounded-2xl bg-neutral-800" />
            <div className="h-14 rounded-2xl bg-neutral-800" />
            <div className="h-14 rounded-2xl bg-neutral-800" />
            <div className="h-14 rounded-2xl bg-neutral-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <SurfaceCard className="p-6">
      <div className="max-w-2xl">
        <div className="text-lg font-semibold text-white">{title}</div>
        <div className="mt-2 text-sm leading-6 text-neutral-400">
          {description}
        </div>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </SurfaceCard>
  );
}

export default function BetsPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bets, setBets] = useState<Bet[]>([]);
  const [itemsByBetId, setItemsByBetId] = useState<Record<string, BetItem[]>>(
    {}
  );
  const [openBetId, setOpenBetId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<BetStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const loadBets = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;

      if (!userId) {
        setBets([]);
        setItemsByBetId({});
        setLoadError("Musisz być zalogowany, aby zobaczyć historię kuponów.");
        return;
      }

      const { data: betsData, error: betsErr } = await supabase
        .from("bets")
        .select("id,user_id,stake,total_odds,potential_win,status,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (betsErr) {
        setBets([]);
        setItemsByBetId({});
        setLoadError(`Nie udało się pobrać kuponów: ${betsErr.message}`);
        return;
      }

      const safeBets = ((betsData ?? []) as Bet[]).map((bet) => ({
        ...bet,
        stake: safeNumber(bet.stake),
        total_odds: safeNumber(bet.total_odds),
        potential_win: safeNumber(bet.potential_win),
      }));

      setBets(safeBets);

      const betIds = safeBets.map((b) => b.id);

      if (betIds.length === 0) {
        setItemsByBetId({});
        setLastLoadedAt(new Date().toISOString());
        return;
      }

      const { data: itemsData, error: itemsErr } = await supabase
        .from("bet_items")
        .select(
          "id,bet_id,user_id,match_id_bigint,league,home,away,market,pick,odds,kickoff_at,created_at"
        )
        .in("bet_id", betIds)
        .order("created_at", { ascending: true });

      if (itemsErr) {
        setItemsByBetId({});
        setLoadError(
          `Kupony pobrane, ale nie udało się pobrać pozycji: ${itemsErr.message}`
        );
        setLastLoadedAt(new Date().toISOString());
        return;
      }

      const grouped: Record<string, BetItem[]> = {};

      for (const item of (itemsData ?? []) as BetItem[]) {
        if (!grouped[item.bet_id]) {
          grouped[item.bet_id] = [];
        }

        grouped[item.bet_id].push({
          ...item,
          odds: safeNumber(item.odds),
        });
      }

      setItemsByBetId(grouped);
      setLastLoadedAt(new Date().toISOString());
    } catch (error) {
      setBets([]);
      setItemsByBetId({});
      setLoadError(
        error instanceof Error
          ? error.message
          : "Nie udało się pobrać kuponów."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadBets();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadBets]);

  const stats = useMemo(() => {
    const pending = bets.filter(
      (bet) => String(bet.status).toLowerCase() === "pending"
    ).length;
    const won = bets.filter(
      (bet) => String(bet.status).toLowerCase() === "won"
    ).length;
    const lost = bets.filter(
      (bet) => String(bet.status).toLowerCase() === "lost"
    ).length;
    const voided = bets.filter(
      (bet) => String(bet.status).toLowerCase() === "void"
    ).length;

    const totalStake = bets.reduce((sum, bet) => sum + safeNumber(bet.stake), 0);

    const settledStake = bets
      .filter((bet) => {
        const status = String(bet.status).toLowerCase();
        return status === "won" || status === "lost" || status === "void";
      })
      .reduce((sum, bet) => sum + safeNumber(bet.stake), 0);

    const returned = bets.reduce((sum, bet) => {
      const status = String(bet.status).toLowerCase();

      if (status === "won") return sum + safeNumber(bet.potential_win);
      if (status === "void") return sum + safeNumber(bet.stake);

      return sum;
    }, 0);

    const balance = returned - settledStake;
    const winrate = won + lost > 0 ? (won / (won + lost)) * 100 : 0;

    return {
      total: bets.length,
      pending,
      won,
      lost,
      voided,
      totalStake,
      returned,
      balance,
      winrate,
    };
  }, [bets]);

  const filteredBets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return bets.filter((bet) => {
      const status = String(bet.status || "").toLowerCase();

      const statusOk = statusFilter === "all" ? true : status === statusFilter;

      if (!statusOk) return false;

      if (!q) return true;

      const items = itemsByBetId[bet.id] ?? [];

      const haystack = [
        bet.id,
        bet.status,
        String(bet.stake),
        String(bet.total_odds),
        String(bet.potential_win),
        ...items.flatMap((item) => [
          item.league,
          item.home,
          item.away,
          item.market,
          item.pick,
        ]),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [bets, itemsByBetId, searchQuery, statusFilter]);

  const selectedBet = useMemo(
    () => bets.find((bet) => bet.id === openBetId) ?? null,
    [bets, openBetId]
  );

  const selectedBetItems = selectedBet
    ? itemsByBetId[selectedBet.id] ?? []
    : [];

  if (loading) {
    return (
      <div className="space-y-5">
        <SurfaceCard className="p-5 sm:p-6">
          <div className="h-8 w-48 animate-pulse rounded bg-neutral-800" />
          <div className="mt-3 h-4 w-80 animate-pulse rounded bg-neutral-800" />
        </SurfaceCard>
        <LoadingSkeleton />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-5">
      <SurfaceCard className="overflow-hidden">
        <div className="border-b border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.11),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.95),rgba(5,5,5,0.98))] p-5 sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                VirtualBook Football
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                Moje kupony
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-400">
                Historia wirtualnych zakładów, statusy rozliczenia, zdarzenia
                na kuponie i szybki podgląd szczegółów.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <SmallPill tone="blue">Kupony: {stats.total}</SmallPill>
                <SmallPill tone="yellow">Oczekujące: {stats.pending}</SmallPill>
                <SmallPill tone="green">Wygrane: {stats.won}</SmallPill>
                <SmallPill tone="red">Przegrane: {stats.lost}</SmallPill>
                {lastLoadedAt ? (
                  <SmallPill>
                    Aktualizacja:{" "}
                    {new Date(lastLoadedAt).toLocaleTimeString("pl-PL", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </SmallPill>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[520px]">
              <StatCard
                label="Stawka łącznie"
                value={`${formatVB(stats.totalStake)} VB`}
                hint="Suma stawek z historii"
                tone="blue"
              />

              <StatCard
                label="Bilans rozliczonych"
                value={`${stats.balance >= 0 ? "+" : ""}${formatVB(
                  stats.balance
                )} VB`}
                hint="Won/void/lost bez pending"
                tone={
                  stats.balance > 0
                    ? "green"
                    : stats.balance < 0
                      ? "red"
                      : "neutral"
                }
              />

              <StatCard
                label="Winrate"
                value={`${stats.winrate.toFixed(1)}%`}
                hint="Tylko won/lost"
              />

              <StatCard
                label="Zwroty"
                value={stats.voided}
                hint="Kupony void"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Szukaj po drużynie, lidze, ID kuponu albo statusie
            </label>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="np. Fulham, Premier League, pending..."
              className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-neutral-600"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Status
            </label>
            <div className="flex flex-wrap gap-2">
              {(["all", "pending", "won", "lost", "void"] as BetStatus[]).map(
                (status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={cn(
                      "rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                      statusFilter === status
                        ? "border-white bg-white text-black"
                        : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-900"
                    )}
                  >
                    {status === "all" ? "Wszystkie" : status.toUpperCase()}
                  </button>
                )
              )}
            </div>
          </div>
        </div>

        {loadError ? (
          <div className="px-4 pb-5 sm:px-5">
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
              {loadError}
            </div>
          </div>
        ) : null}
      </SurfaceCard>

      {bets.length === 0 ? (
        <EmptyState
          title="Nie masz jeszcze żadnych kuponów"
          description="Przejdź do meczów, wybierz kurs i postaw pierwszy wirtualny kupon."
          action={
            <Link
              href="/events"
              className="inline-flex rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-neutral-200"
            >
              Przejdź do meczów
            </Link>
          }
        />
      ) : filteredBets.length === 0 ? (
        <EmptyState
          title="Brak kuponów dla wybranego filtra"
          description="Zmień status, wyczyść wyszukiwarkę albo odśwież historię kuponów."
          action={
            <button
              type="button"
              onClick={() => {
                setStatusFilter("all");
                setSearchQuery("");
              }}
              className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
            >
              Wyczyść filtry
            </button>
          }
        />
      ) : (
        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-3">
            {filteredBets.map((bet) => {
              const isOpen = openBetId === bet.id;
              const items = itemsByBetId[bet.id] ?? [];
              const tone = statusTone(bet.status);

              return (
                <div
                  key={bet.id}
                  className={cn(
                    "rounded-3xl border p-4 transition",
                    betCardWrapperClass(bet.status),
                    isOpen ? "ring-1 ring-white/20" : "hover:border-neutral-700"
                  )}
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <SmallPill tone={tone}>
                          {labelStatus(bet.status)}
                        </SmallPill>

                        <SmallPill>{fmtDate(bet.created_at)}</SmallPill>

                        <span className="break-all text-xs text-neutral-600">
                          ID: {bet.id}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-neutral-800 bg-black/20 p-3">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                            Stawka
                          </div>
                          <div className="mt-1 font-semibold text-white">
                            {formatVB(bet.stake)} VB
                          </div>
                        </div>

                        <div className="rounded-2xl border border-neutral-800 bg-black/20 p-3">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                            Kurs
                          </div>
                          <div className="mt-1 font-semibold text-white">
                            {formatOdd(bet.total_odds)}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-neutral-800 bg-black/20 p-3">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                            Możliwa wygrana
                          </div>
                          <div className="mt-1 font-semibold text-white">
                            {formatVB(bet.potential_win)} VB
                          </div>
                        </div>

                        <div className="rounded-2xl border border-neutral-800 bg-black/20 p-3">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                            Zdarzenia
                          </div>
                          <div className="mt-1 font-semibold text-white">
                            {items.length}
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setOpenBetId(isOpen ? null : bet.id)}
                      className={cn(
                        "shrink-0 rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                        isOpen
                          ? "border-white bg-white text-black"
                          : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900"
                      )}
                    >
                      {isOpen ? "Ukryj szczegóły" : "Szczegóły"}
                    </button>
                  </div>

                  {isOpen ? (
                    <div className="mt-4 border-t border-neutral-800 pt-4">
                      {items.length === 0 ? (
                        <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4 text-sm text-yellow-200">
                          Brak pozycji kuponu. To nie powinno się zdarzyć —
                          kupon istnieje bez bet_items.
                        </div>
                      ) : (
                        <div className="grid gap-3 xl:grid-cols-2">
                          {items.map((item) => {
                            const labels = formatBetSelectionLabels({
                              market: item.market,
                              pick: item.pick,
                              home: item.home,
                              away: item.away,
                            });

                            return (
                              <div
                              key={item.id}
                              className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-xs text-neutral-500">
                                    {item.league || "Liga"} •{" "}
                                    {labels.marketLabel}
                                  </div>

                                  <div className="mt-2 text-sm font-semibold text-white">
                                    {item.home}{" "}
                                    <span className="font-normal text-neutral-500">
                                      vs
                                    </span>{" "}
                                    {item.away}
                                  </div>

                                  {item.kickoff_at ? (
                                    <div className="mt-1 text-xs text-neutral-500">
                                      Start: {fmtDate(item.kickoff_at)}
                                    </div>
                                  ) : null}
                                </div>

                                <SmallPill tone="blue">
                                  {formatOdd(item.odds)}
                                </SmallPill>
                              </div>

                              <div className="mt-3 rounded-2xl border border-neutral-800 bg-black/20 p-3 text-sm text-neutral-300">
                                Typ:{" "}
                                <span className="font-semibold text-white">
                                  {labels.selectionLabel}
                                </span>
                              </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <aside className="hidden 2xl:block">
            <div className="sticky top-[88px] space-y-4">
              <SurfaceCard className="p-5">
                <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                  Historia
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  Snapshot
                </div>
                <p className="mt-2 text-sm leading-6 text-neutral-400">
                  Skrót historii kuponów z aktualnego filtra.
                </p>

                <div className="mt-5 grid gap-3">
                  <StatCard
                    label="Widoczne"
                    value={filteredBets.length}
                    hint={`z ${bets.length} wszystkich`}
                  />
                  <StatCard
                    label="Oczekujące"
                    value={stats.pending}
                    tone={stats.pending > 0 ? "yellow" : "neutral"}
                  />
                  <StatCard
                    label="Wygrane"
                    value={stats.won}
                    tone="green"
                  />
                  <StatCard
                    label="Przegrane"
                    value={stats.lost}
                    tone="red"
                  />
                </div>

                {selectedBet ? (
                  <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                      Otwarty kupon
                    </div>
                    <div className="mt-2 break-all text-sm font-semibold text-white">
                      {selectedBet.id}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <SmallPill tone={statusTone(selectedBet.status)}>
                        {labelStatus(selectedBet.status)}
                      </SmallPill>
                      <SmallPill>{selectedBetItems.length} zdarzeń</SmallPill>
                    </div>
                  </div>
                ) : null}
              </SurfaceCard>
            </div>
          </aside>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          void loadBets();
        }}
        className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
      >
        Odśwież historię
      </button>
    </div>
  );
}
