"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatOdd, formatVB } from "@/lib/format";

type PublicBet = {
  id: string;
  user: {
    username: string | null;
  };
  stake: number;
  total_odds: number;
  potential_win: number;
  payout: number | null;
  status: string;
  statusLabel: string;
  settled: boolean;
  settled_at: string | null;
  created_at: string | null;
  bet_type: string;
  item_count: number;
};

type PublicBetItem = {
  id: string;
  match_id_bigint: number | string | null;
  league: string;
  home: string;
  away: string;
  marketLabel: string;
  selectionLabel: string;
  odds: number;
  result: string | null;
  settled: boolean;
  settled_at: string | null;
  kickoff_at: string | null;
};

type PublicBetPayload = {
  ok: boolean;
  bet?: PublicBet;
  items?: PublicBetItem[];
  error?: string;
};

type TimelineStep = {
  id: string;
  at: string | null;
  title: string;
  description: string;
  tone: "neutral" | "green" | "red" | "yellow" | "blue";
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function fmtDate(value: string | null) {
  if (!value) return "Czas nieznany";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Czas nieznany";
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function statusTone(status: string): "green" | "red" | "yellow" | "neutral" {
  const normalized = String(status).toLowerCase();
  if (normalized === "won") return "green";
  if (normalized === "lost") return "red";
  if (normalized === "void") return "neutral";
  return "yellow";
}

function resultLabel(result: string | null) {
  const normalized = String(result ?? "").toLowerCase();
  if (normalized === "won") return "Trafiony";
  if (normalized === "lost") return "Nietrafiony";
  if (normalized === "void") return "Void";
  return "W grze";
}

function statusClass(tone: "green" | "red" | "yellow" | "neutral") {
  if (tone === "green") return "border-green-500/30 bg-green-500/10 text-green-300";
  if (tone === "red") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (tone === "yellow") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
  return "border-neutral-700 bg-neutral-950 text-neutral-300";
}

function buildTimeline(bet: PublicBet, items: PublicBetItem[]) {
  const steps: TimelineStep[] = [
    {
      id: "created",
      at: bet.created_at,
      title: "Kupon postawiony",
      description: `Stawka ${formatVB(bet.stake)} VB, kurs laczny ${formatOdd(
        bet.total_odds
      )}.`,
      tone: "blue",
    },
  ];

  for (const item of items) {
    if (item.kickoff_at) {
      steps.push({
        id: `${item.id}-kickoff`,
        at: item.kickoff_at,
        title: "Start meczu",
        description: `${item.home} vs ${item.away} - ${item.marketLabel}: ${item.selectionLabel}.`,
        tone: "neutral",
      });
    }

    if (item.settled_at || item.result) {
      const normalized = String(item.result ?? "").toLowerCase();
      steps.push({
        id: `${item.id}-settled`,
        at: item.settled_at,
        title: "Pozycja rozliczona",
        description: `${item.marketLabel}: ${item.selectionLabel} - ${resultLabel(
          item.result
        )}.`,
        tone:
          normalized === "won"
            ? "green"
            : normalized === "lost"
              ? "red"
              : normalized === "void"
                ? "yellow"
                : "neutral",
      });
    }
  }

  if (bet.settled || bet.settled_at) {
    steps.push({
      id: "settled",
      at: bet.settled_at,
      title: "Kupon rozliczony",
      description: `Status: ${bet.statusLabel}. Wyplata: ${
        bet.payout == null ? "nieustalona" : `${formatVB(bet.payout)} VB`
      }.`,
      tone: statusTone(bet.status),
    });
  }

  return steps.sort((a, b) => {
    const aTime = Date.parse(a.at ?? "");
    const bTime = Date.parse(b.at ?? "");
    return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
  });
}

export default function PublicBetPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bet, setBet] = useState<PublicBet | null>(null);
  const [items, setItems] = useState<PublicBetItem[]>([]);

  const load = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/public-bets/${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as PublicBetPayload | null;

      if (!response.ok || !payload?.ok || !payload.bet) {
        throw new Error(payload?.error ?? "Nie udalo sie pobrac publicznego kuponu.");
      }

      setBet(payload.bet);
      setItems(payload.items ?? []);
    } catch (err: unknown) {
      setBet(null);
      setItems([]);
      setError(err instanceof Error ? err.message : "Blad pobierania kuponu.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const timeline = useMemo(() => {
    if (!bet) return [];
    return buildTimeline(bet, items);
  }, [bet, items]);

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 text-neutral-400">
        Ladowanie kuponu...
      </main>
    );
  }

  if (error || !bet) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <section className="rounded-3xl border border-neutral-800 bg-neutral-950/70 p-6">
          <h1 className="text-2xl font-semibold text-white">Kupon publiczny</h1>
          <p className="mt-3 text-neutral-300">
            {error ?? "Ten link nie prowadzi do aktywnego kuponu."}
          </p>
          <Link
            href="/events"
            className="mt-5 inline-flex rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-neutral-200"
          >
            Przejdz do meczow
          </Link>
        </section>
      </main>
    );
  }

  const tone = statusTone(bet.status);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <section className="overflow-hidden rounded-3xl border border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_30%),linear-gradient(135deg,rgba(18,18,18,0.98),rgba(3,3,3,0.99))]">
        <div className="p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                Publiczny kupon
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                {bet.bet_type === "bet_builder" ? "Bet Builder" : "Kupon AKO"}
              </h1>
              <p className="mt-2 text-sm text-neutral-400">
                Udostepniony przez{" "}
                <span className="font-semibold text-neutral-200">
                  {bet.user.username ?? "gracza"}
                </span>
                .
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className={cx("rounded-full border px-3 py-1 text-xs font-semibold", statusClass(tone))}>
                {bet.statusLabel}
              </span>
              <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-300">
                {items.length} zdarzen
              </span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Stat label="Stawka" value={`${formatVB(bet.stake)} VB`} />
            <Stat label="Kurs laczny" value={formatOdd(bet.total_odds)} />
            <Stat label="Mozliwa wygrana" value={`${formatVB(bet.potential_win)} VB`} />
            <Stat
              label="Wyplata"
              value={bet.payout == null ? "-" : `${formatVB(bet.payout)} VB`}
            />
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-neutral-800 bg-neutral-950/70 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">Zdarzenia</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Typy, kursy i obecny status rozliczenia.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
          >
            Odswiez
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <article
              key={item.id}
              className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-neutral-500">{item.league}</div>
                  <h3 className="mt-1 font-semibold text-white">
                    {item.home} vs {item.away}
                  </h3>
                </div>
                <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-300">
                  {formatOdd(item.odds)}
                </span>
              </div>

              <div className="mt-4 rounded-2xl border border-neutral-800 bg-black/20 p-3 text-sm">
                <div className="text-neutral-400">Rynek</div>
                <div className="font-semibold text-neutral-100">{item.marketLabel}</div>
                <div className="mt-2 text-neutral-400">Typ</div>
                <div className="font-semibold text-neutral-100">{item.selectionLabel}</div>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-neutral-400">
                <span>Start: {fmtDate(item.kickoff_at)}</span>
                <span>{resultLabel(item.result)}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-neutral-800 bg-neutral-950/70 p-5">
        <h2 className="text-xl font-semibold text-white">Timeline</h2>
        <div className="mt-5 space-y-3">
          {timeline.map((step) => (
            <div
              key={step.id}
              className={cx(
                "rounded-2xl border p-4",
                step.tone === "green" && "border-green-500/30 bg-green-500/10",
                step.tone === "red" && "border-red-500/30 bg-red-500/10",
                step.tone === "yellow" && "border-yellow-500/30 bg-yellow-500/10",
                step.tone === "blue" && "border-sky-500/30 bg-sky-500/10",
                step.tone === "neutral" && "border-neutral-800 bg-neutral-950/60"
              )}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                <div>
                  <div className="font-semibold text-white">{step.title}</div>
                  <div className="mt-1 text-sm text-neutral-300">{step.description}</div>
                </div>
                <div className="shrink-0 text-xs text-neutral-500">
                  {fmtDate(step.at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-black/25 p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}
