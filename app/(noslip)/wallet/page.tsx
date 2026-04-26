"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
  Brush,
  ReferenceLine,
} from "recharts";

type LedgerRow = {
  id: string;
  created_at: string;
  kind: string;
  amount: number;
  balance_after: number | null;
  ref_type: string | null;
  ref_id: string | null;
};

type ProfileWalletRow = {
  balance_vb: number | null;
  is_banned: boolean | null;
};

type ChartPoint = {
  x: number;
  time: string;
  rawTime: string;
  balance: number;
  change: number;
  cumulativePnl: number;
  kind: string;
  ref_id: string | null;
  ref_type: string | null;
  isWeekly: boolean;
};

type TooltipPayloadEntry = {
  payload: ChartPoint;
};

type MetricTone = "neutral" | "green" | "red" | "yellow" | "blue" | "purple";

const BET_DETAILS_PATH = (betId: string) => `/bets/${betId}`;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function fmt2(n: number | null | undefined) {
  return Number(n ?? 0).toFixed(2);
}

function fmtPct(n: number | null | undefined) {
  return `${Number(n ?? 0).toFixed(2)}%`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "—";

  return new Date(ts).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateShort(value?: string | null) {
  if (!value) return "";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "";

  return new Date(ts).toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
  });
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

function kindTone(kind: string): MetricTone {
  if (kind === "BET_PLACED") return "red";
  if (kind === "BET_PAYOUT") return "green";
  if (kind === "WEEKLY_GRANT") return "yellow";
  if (kind === "MANUAL_RECONCILIATION") return "purple";
  return "blue";
}

function amountClass(amount: number) {
  if (amount > 0) return "text-green-400";
  if (amount < 0) return "text-red-400";
  return "text-neutral-200";
}

function toneTextClass(tone: MetricTone) {
  if (tone === "green") return "text-green-300";
  if (tone === "red") return "text-red-300";
  if (tone === "yellow") return "text-yellow-300";
  if (tone === "blue") return "text-sky-300";
  if (tone === "purple") return "text-violet-300";
  return "text-white";
}

function isBetKind(kind: string) {
  return kind === "BET_PLACED" || kind === "BET_PAYOUT";
}

function isWeeklyKind(kind: string) {
  return kind === "WEEKLY_GRANT";
}

function startOfLocalDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getDotColor(kind: string) {
  if (kind === "BET_PLACED") return "#ef4444";
  if (kind === "BET_PAYOUT") return "#22c55e";
  if (kind === "WEEKLY_GRANT") return "#facc15";
  if (kind === "MANUAL_RECONCILIATION") return "#a78bfa";
  return "#38bdf8";
}

function TooltipBox({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  const color =
    point.change > 0
      ? "text-green-400"
      : point.change < 0
        ? "text-red-400"
        : "text-white";

  return (
    <div className="rounded-2xl border border-neutral-700 bg-black/95 p-3 text-sm shadow-2xl">
      <div className="font-semibold text-white">{point.time}</div>

      <div className="mt-2 text-neutral-300">
        Saldo: <span className="font-semibold text-white">{fmt2(point.balance)} VB</span>
      </div>

      <div className={cn("mt-1 font-semibold", color)}>
        Zmiana: {point.change > 0 ? "+" : ""}
        {fmt2(point.change)} VB
      </div>

      <div className="mt-2 text-xs text-neutral-400">
        Typ: <span className="text-neutral-200">{kindLabel(point.kind)}</span>
      </div>

      {point.ref_type === "bet" && point.ref_id ? (
        <div className="mt-1 text-xs text-neutral-400">
          Bet ID: <span className="text-white">{point.ref_id}</span>
        </div>
      ) : null}
    </div>
  );
}

function renderBalanceDot(props: unknown) {
  const { cx, cy, payload } = (props ?? {}) as {
    cx?: number;
    cy?: number;
    payload?: ChartPoint;
  };

  if (typeof cx !== "number" || typeof cy !== "number" || !payload) {
    return null;
  }

  return (
    <circle
      cx={cx}
      cy={cy}
      r={3.5}
      fill={getDotColor(payload.kind)}
      stroke="#0a0a0a"
      strokeWidth={1.5}
    />
  );
}

function renderActiveBalanceDot(props: unknown) {
  const { cx, cy, payload } = (props ?? {}) as {
    cx?: number;
    cy?: number;
    payload?: ChartPoint;
  };

  if (typeof cx !== "number" || typeof cy !== "number" || !payload) {
    return null;
  }

  return (
    <circle
      cx={cx}
      cy={cy}
      r={6}
      fill={getDotColor(payload.kind)}
      stroke="#ffffff"
      strokeWidth={2}
    />
  );
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
  tone?: MetricTone;
}) {
  const toneClass =
    tone === "green"
      ? "border-green-500/30 bg-green-500/10 text-green-300"
      : tone === "red"
        ? "border-red-500/30 bg-red-500/10 text-red-300"
        : tone === "yellow"
          ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
          : tone === "blue"
            ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
            : tone === "purple"
              ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
              : "border-neutral-800 bg-neutral-950 text-neutral-300";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold",
        toneClass
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
  tone?: MetricTone;
}) {
  const toneClass =
    tone === "green"
      ? "border-green-500/20 bg-green-500/10"
      : tone === "red"
        ? "border-red-500/20 bg-red-500/10"
        : tone === "yellow"
          ? "border-yellow-500/20 bg-yellow-500/10"
          : tone === "blue"
            ? "border-sky-500/20 bg-sky-500/10"
            : tone === "purple"
              ? "border-violet-500/20 bg-violet-500/10"
              : "border-neutral-800 bg-neutral-950/80";

  return (
    <div className={cn("rounded-3xl border p-4", toneClass)}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </div>
      <div className={cn("mt-3 text-2xl font-semibold leading-tight", toneTextClass(tone))}>
        {value}
      </div>
      {hint ? <div className="mt-2 text-xs leading-5 text-neutral-500">{hint}</div> : null}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  badge,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SurfaceCard className="overflow-hidden">
      <div className="border-b border-neutral-800 bg-neutral-900/30 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            {subtitle ? (
              <div className="mt-1 text-sm leading-6 text-neutral-400">{subtitle}</div>
            ) : null}
          </div>

          {badge ? <div className="shrink-0">{badge}</div> : null}
        </div>
      </div>

      <div className="p-4 sm:p-5">{children}</div>
    </SurfaceCard>
  );
}

function EmptyChartState() {
  return (
    <div className="flex h-64 items-center justify-center rounded-3xl border border-dashed border-neutral-800 bg-black/20 p-6 text-center">
      <div>
        <div className="text-sm font-semibold text-neutral-200">Brak danych do wykresu</div>
        <div className="mt-1 text-sm text-neutral-500">
          Historia salda pojawi się po pierwszych transakcjach.
        </div>
      </div>
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="mx-auto max-w-[1520px] space-y-5 text-white">
      <div className="animate-pulse overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950/70">
        <div className="h-64 bg-neutral-900/70" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <div className="h-96 animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40" />
          <div className="h-80 animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40" />
        </div>

        <div className="space-y-4">
          <div className="h-56 animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40" />
          <div className="h-56 animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40" />
        </div>
      </div>
    </div>
  );
}

export default function WalletPage() {
  const router = useRouter();

  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError(null);

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user?.id;

        if (!userId) {
          router.replace("/login");
          return;
        }

        const { data: prof, error: profileError } = await supabase
          .from("profiles")
          .select("balance_vb,is_banned")
          .eq("id", userId)
          .maybeSingle();

        if (profileError) {
          throw new Error(profileError.message);
        }

        const profile = (prof ?? null) as ProfileWalletRow | null;

        if (profile?.is_banned) {
          router.replace("/");
          return;
        }

        setBalance(profile?.balance_vb ?? 0);

        const { data, error: ledgerError } = await supabase
          .from("vb_ledger")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
          .limit(1000);

        if (ledgerError) {
          throw new Error(ledgerError.message);
        }

        const normalized = ((data ?? []) as LedgerRow[]).slice().sort((a, b) => {
          const ta = new Date(a.created_at).getTime();
          const tb = new Date(b.created_at).getTime();

          if (ta !== tb) return ta - tb;

          const ba = Number(a.balance_after ?? 0);
          const bb = Number(b.balance_after ?? 0);

          if (ba !== bb) return ba - bb;

          return String(a.id).localeCompare(String(b.id));
        });

        setRows(normalized);
      } catch (e: any) {
        setError(e?.message ?? "Nie udało się pobrać historii portfela.");
      } finally {
        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [router]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const onRefresh = () => {
      void load(true);
    };

    window.addEventListener("vb:refresh-balance", onRefresh);

    return () => {
      window.removeEventListener("vb:refresh-balance", onRefresh);
    };
  }, [load]);

  const chartData = useMemo(() => {
    return rows
      .filter((r) => r.balance_after !== null)
      .reduce<ChartPoint[]>((acc, r, index) => {
        const prevPnl = acc.length > 0 ? acc[acc.length - 1].cumulativePnl : 0;
        const nextPnl = prevPnl + (isBetKind(r.kind) ? Number(r.amount ?? 0) : 0);

        acc.push({
          x: index,
          time: formatDateTime(r.created_at),
          rawTime: r.created_at,
          balance: Number(r.balance_after ?? 0),
          change: Number(r.amount ?? 0),
          cumulativePnl: nextPnl,
          kind: r.kind,
          ref_id: r.ref_id ?? null,
          ref_type: r.ref_type ?? null,
          isWeekly: isWeeklyKind(r.kind),
        });

        return acc;
      }, []);
  }, [rows]);

  const weeklyGrantPoints = useMemo(() => {
    return chartData.filter((r) => r.isWeekly);
  }, [chartData]);

  const quick = useMemo(() => {
    let income = 0;
    let expense = 0;

    for (const r of rows) {
      if (r.amount > 0) income += r.amount;
      if (r.amount < 0) expense += Math.abs(r.amount);
    }

    return {
      income,
      expense,
      net: income - expense,
    };
  }, [rows]);

  const betStats = useMemo(() => {
    const betPlaced = rows.filter((r) => r.kind === "BET_PLACED");
    const betPayout = rows.filter((r) => r.kind === "BET_PAYOUT");

    const stakeAbs = betPlaced.reduce(
      (sum, r) => sum + Math.abs(Number(r.amount ?? 0)),
      0
    );
    const payoutSum = betPayout.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

    const winrate =
      betPlaced.length > 0 ? (betPayout.length / betPlaced.length) * 100 : 0;
    const roi = stakeAbs > 0 ? ((payoutSum - stakeAbs) / stakeAbs) * 100 : 0;

    const now = new Date();
    const startToday = startOfLocalDay(now);
    const startWeek = startOfLocalDay(
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    );

    const betPlacedToday = betPlaced.filter(
      (r) => new Date(r.created_at) >= startToday
    );
    const betPayoutToday = betPayout.filter(
      (r) => new Date(r.created_at) >= startToday
    );

    const stakeToday = betPlacedToday.reduce(
      (sum, r) => sum + Math.abs(Number(r.amount ?? 0)),
      0
    );
    const payoutToday = betPayoutToday.reduce(
      (sum, r) => sum + Number(r.amount ?? 0),
      0
    );
    const roiDay =
      stakeToday > 0 ? ((payoutToday - stakeToday) / stakeToday) * 100 : 0;

    const betPlacedWeek = betPlaced.filter(
      (r) => new Date(r.created_at) >= startWeek
    );
    const betPayoutWeek = betPayout.filter(
      (r) => new Date(r.created_at) >= startWeek
    );

    const stakeWeek = betPlacedWeek.reduce(
      (sum, r) => sum + Math.abs(Number(r.amount ?? 0)),
      0
    );
    const payoutWeek = betPayoutWeek.reduce(
      (sum, r) => sum + Number(r.amount ?? 0),
      0
    );
    const roiWeek =
      stakeWeek > 0 ? ((payoutWeek - stakeWeek) / stakeWeek) * 100 : 0;

    return {
      stakesTotal: stakeAbs,
      payoutsTotal: payoutSum,
      winrate,
      roi,
      roiDay,
      roiWeek,
      betCount: betPlaced.length,
      settledWinningCount: betPayout.length,
    };
  }, [rows]);

  const drawdownStats = useMemo(() => {
    let peak = Number.NEGATIVE_INFINITY;
    let peakX: number | null = null;
    let peakTime = "";
    let maxDrawdown = 0;
    let troughX: number | null = null;
    let troughTime = "";
    let troughBalance = 0;

    for (const p of chartData) {
      if (p.balance > peak) {
        peak = p.balance;
        peakX = p.x;
        peakTime = p.time;
      }

      const dd = peak - p.balance;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        troughX = p.x;
        troughTime = p.time;
        troughBalance = p.balance;
      }
    }

    return {
      peakBalance: peak === Number.NEGATIVE_INFINITY ? 0 : peak,
      peakX,
      peakTime,
      maxDrawdown,
      troughX,
      troughTime,
      troughBalance,
    };
  }, [chartData]);

  const latestRow = rows.length > 0 ? rows[rows.length - 1] : null;
  const recentRows = useMemo(() => rows.slice().reverse(), [rows]);

  if (loading) return <LoadingShell />;

  if (error) {
    return (
      <div className="mx-auto max-w-4xl text-white">
        <SurfaceCard className="border-red-500/20 bg-red-500/10 p-6">
          <div className="text-lg font-semibold text-red-200">
            Nie udało się załadować portfela
          </div>
          <div className="mt-2 text-sm text-red-300">{error}</div>
          <button
            type="button"
            onClick={() => load(false)}
            className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
          >
            Spróbuj ponownie
          </button>
        </SurfaceCard>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1520px] space-y-5 text-white">
      <SurfaceCard className="overflow-hidden">
        <div className="border-b border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.96),rgba(5,5,5,0.98))] p-5 sm:p-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                VirtualBook Wallet
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                Portfel
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-400">
                Historia salda VB, przepływy z kuponów, weekly granty oraz szybkie
                statystyki rentowności konta.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <StatusPill tone="blue">Transakcje: {rows.length}</StatusPill>
                <StatusPill tone={quick.net >= 0 ? "green" : "red"}>
                  Netto: {quick.net >= 0 ? "+" : ""}
                  {fmt2(quick.net)} VB
                </StatusPill>
                <StatusPill tone="yellow">
                  Weekly granty: {weeklyGrantPoints.length}
                </StatusPill>
                <StatusPill>
                  Ostatni ruch: {latestRow ? formatDateTime(latestRow.created_at) : "—"}
                </StatusPill>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href="/account"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Moje konto
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
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[520px]">
              <MetricCard
                label="Aktualne saldo"
                value={`${fmt2(balance)} VB`}
                hint="Stan portfela z profilu użytkownika"
                tone="blue"
              />
              <MetricCard
                label="Profit / Net"
                value={`${quick.net >= 0 ? "+" : ""}${fmt2(quick.net)} VB`}
                hint="Przychody minus wydatki"
                tone={quick.net >= 0 ? "green" : "red"}
              />
              <MetricCard
                label="ROI całkowite"
                value={fmtPct(betStats.roi)}
                hint="Na podstawie stawek i wypłat"
                tone={betStats.roi > 0 ? "green" : betStats.roi < 0 ? "red" : "neutral"}
              />
              <MetricCard
                label="Max drawdown"
                value={`${fmt2(drawdownStats.maxDrawdown)} VB`}
                hint="Największe zejście od szczytu"
                tone={drawdownStats.maxDrawdown > 0 ? "red" : "neutral"}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Przychody"
            value={`+${fmt2(quick.income)} VB`}
            hint="Wszystkie dodatnie ruchy"
            tone="green"
          />
          <MetricCard
            label="Wydatki"
            value={`-${fmt2(quick.expense)} VB`}
            hint="Wszystkie ujemne ruchy"
            tone="red"
          />
          <MetricCard
            label="Winrate z betów"
            value={fmtPct(betStats.winrate)}
            hint={`Wypłaty: ${betStats.settledWinningCount} / stawki: ${betStats.betCount}`}
            tone="blue"
          />
          <MetricCard
            label="Peak balance"
            value={`${fmt2(drawdownStats.peakBalance)} VB`}
            hint={drawdownStats.peakTime || "Najwyższe saldo w historii"}
            tone="green"
          />
        </div>
      </SurfaceCard>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <ChartCard
            title="Saldo w czasie"
            subtitle="Linia salda pokazuje wszystkie ruchy portfela. Żółte pionowe linie oznaczają weekly grant."
            badge={
              <button
                type="button"
                onClick={() => load(true)}
                disabled={refreshing}
                className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {refreshing ? "Odświeżam..." : "Odśwież"}
              </button>
            }
          >
            {chartData.length === 0 ? (
              <EmptyChartState />
            ) : (
              <div className="h-[360px]">
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid stroke="#262626" strokeDasharray="3 3" />

                    <XAxis
                      dataKey="x"
                      stroke="#888"
                      minTickGap={30}
                      tickFormatter={(value) => {
                        const row = chartData[Number(value)];
                        return row ? formatDateShort(row.rawTime) : "";
                      }}
                    />

                    <YAxis stroke="#888" />
                    <Tooltip content={<TooltipBox />} />

                    {weeklyGrantPoints.map((p) => (
                      <ReferenceLine
                        key={`wg-${p.x}-${p.ref_id ?? p.time}`}
                        x={p.x}
                        stroke="#facc15"
                        strokeDasharray="4 4"
                        ifOverflow="extendDomain"
                      />
                    ))}

                    {drawdownStats.peakX != null ? (
                      <ReferenceLine
                        y={drawdownStats.peakBalance}
                        stroke="#22c55e"
                        strokeDasharray="3 3"
                        ifOverflow="extendDomain"
                      />
                    ) : null}

                    <Line
                      type="monotone"
                      dataKey="balance"
                      stroke="#38bdf8"
                      strokeWidth={3}
                      dot={renderBalanceDot}
                      activeDot={renderActiveBalanceDot}
                    />

                    <Brush
                      dataKey="x"
                      height={28}
                      stroke="#38bdf8"
                      tickFormatter={(value) => {
                        const row = chartData[Number(value)];
                        return row ? formatDateShort(row.rawTime) : "";
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>

          <ChartCard
            title="Profit z kuponów"
            subtitle="PnL kumulacyjny liczy tylko ruchy bukmacherskie: postawione kupony i wypłaty."
            badge={<StatusPill tone={quick.net >= 0 ? "green" : "red"}>{quick.net >= 0 ? "Plus" : "Minus"}</StatusPill>}
          >
            {chartData.length === 0 ? (
              <EmptyChartState />
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer>
                  <AreaChart data={chartData}>
                    <CartesianGrid stroke="#262626" strokeDasharray="3 3" />

                    <XAxis
                      dataKey="x"
                      stroke="#888"
                      minTickGap={30}
                      tickFormatter={(value) => {
                        const row = chartData[Number(value)];
                        return row ? formatDateShort(row.rawTime) : "";
                      }}
                    />

                    <YAxis stroke="#888" />
                    <Tooltip content={<TooltipBox />} />

                    <Area
                      type="monotone"
                      dataKey="cumulativePnl"
                      stroke="#22c55e"
                      fill="#22c55e"
                      fillOpacity={0.18}
                      strokeWidth={2.5}
                    />

                    <ReferenceLine y={0} stroke="#666" strokeDasharray="4 4" />

                    <Brush
                      dataKey="x"
                      height={28}
                      stroke="#38bdf8"
                      tickFormatter={(value) => {
                        const row = chartData[Number(value)];
                        return row ? formatDateShort(row.rawTime) : "";
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>

          <SurfaceCard className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-neutral-800 bg-neutral-900/30 p-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Historia transakcji</h2>
                <p className="mt-1 text-sm text-neutral-400">
                  Pełny ledger VB z odnośnikami do kuponów.
                </p>
              </div>

              <StatusPill>{rows.length} wpisów</StatusPill>
            </div>

            {recentRows.length === 0 ? (
              <div className="p-5">
                <div className="rounded-3xl border border-dashed border-neutral-800 bg-black/20 p-6 text-sm text-neutral-500">
                  Brak transakcji w portfelu.
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="text-xs text-neutral-400">
                    <tr className="border-b border-neutral-800">
                      <th className="px-5 py-3 text-left font-medium">Czas</th>
                      <th className="px-5 py-3 text-left font-medium">Typ</th>
                      <th className="px-5 py-3 text-right font-medium">Kwota</th>
                      <th className="px-5 py-3 text-right font-medium">Saldo po</th>
                      <th className="px-5 py-3 text-left font-medium">Ref</th>
                    </tr>
                  </thead>

                  <tbody>
                    {recentRows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-neutral-800/70 transition hover:bg-neutral-900/50"
                      >
                        <td className="px-5 py-4 text-neutral-300">
                          {formatDateTime(r.created_at)}
                        </td>

                        <td className="px-5 py-4">
                          <StatusPill tone={kindTone(r.kind)}>{kindLabel(r.kind)}</StatusPill>
                        </td>

                        <td
                          className={cn(
                            "px-5 py-4 text-right font-semibold",
                            amountClass(Number(r.amount ?? 0))
                          )}
                        >
                          {Number(r.amount ?? 0) > 0 ? "+" : ""}
                          {fmt2(r.amount)} VB
                        </td>

                        <td className="px-5 py-4 text-right font-semibold text-white">
                          {fmt2(r.balance_after)} VB
                        </td>

                        <td className="px-5 py-4 text-xs">
                          {r.ref_type === "bet" && r.ref_id ? (
                            <Link
                              href={BET_DETAILS_PATH(r.ref_id)}
                              className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 font-semibold text-sky-300 transition hover:bg-sky-500/15"
                            >
                              Otwórz kupon
                            </Link>
                          ) : (
                            <span className="text-neutral-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>
        </div>

        <aside className="min-w-0 space-y-5">
          <SurfaceCard className="p-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
              Statystyki portfela
            </div>

            <div className="mt-3 text-2xl font-semibold text-white">
              Snapshot
            </div>

            <p className="mt-2 text-sm leading-6 text-neutral-400">
              Szybki skrót rentowności, transakcji i ryzyka salda.
            </p>

            <div className="mt-5 grid gap-3">
              <MetricCard
                label="ROI dzisiaj"
                value={fmtPct(betStats.roiDay)}
                tone={betStats.roiDay > 0 ? "green" : betStats.roiDay < 0 ? "red" : "neutral"}
              />
              <MetricCard
                label="ROI 7 dni"
                value={fmtPct(betStats.roiWeek)}
                tone={betStats.roiWeek > 0 ? "green" : betStats.roiWeek < 0 ? "red" : "neutral"}
              />
              <MetricCard
                label="Stawki łącznie"
                value={`${fmt2(betStats.stakesTotal)} VB`}
                hint="Suma postawionych kuponów"
                tone="red"
              />
              <MetricCard
                label="Wypłaty łącznie"
                value={`${fmt2(betStats.payoutsTotal)} VB`}
                hint="Suma wypłat z wygranych"
                tone="green"
              />
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
              Oznaczenia
            </div>

            <div className="mt-3 grid gap-2 text-sm">
              <div className="flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3">
                <span className="text-neutral-300">Postawiono kupon</span>
                <span className="h-3 w-3 rounded-full bg-red-500" />
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3">
                <span className="text-neutral-300">Wypłata kuponu</span>
                <span className="h-3 w-3 rounded-full bg-green-500" />
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3">
                <span className="text-neutral-300">Weekly bonus</span>
                <span className="h-3 w-3 rounded-full bg-yellow-400" />
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3">
                <span className="text-neutral-300">Korekta ręczna</span>
                <span className="h-3 w-3 rounded-full bg-violet-400" />
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
              Szybka nawigacja
            </div>

            <div className="mt-4 grid gap-2">
              <Link
                href="/events"
                className="rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
              >
                Przejdź do meczów
              </Link>
              <Link
                href="/bets"
                className="rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
              >
                Moje kupony
              </Link>
              <Link
                href="/account"
                className="rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
              >
                Centrum konta
              </Link>
            </div>
          </SurfaceCard>

          {drawdownStats.troughX != null ? (
            <SurfaceCard className="p-5">
              <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                Drawdown
              </div>

              <div className="mt-3 text-sm leading-6 text-neutral-400">
                Największe zejście od szczytu salda:
              </div>

              <div className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <div className="text-2xl font-semibold text-red-300">
                  {fmt2(drawdownStats.maxDrawdown)} VB
                </div>
                <div className="mt-2 text-xs text-neutral-400">
                  Dołek: {fmt2(drawdownStats.troughBalance)} VB
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  {drawdownStats.troughTime}
                </div>
              </div>
            </SurfaceCard>
          ) : null}
        </aside>
      </div>
    </div>
  );
}