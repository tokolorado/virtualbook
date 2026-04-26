// app/(main)/users/[username]/page.tsx
"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

type PublicProfileResponse = {
  ok: boolean;
  profile: {
    id: string;
    username: string;
    balance_vb: number;
    bets_count: number;
    won_bets: number;
    lost_bets: number;
    void_bets: number;
    profit: number;
    roi: number;
    winrate: number;
  } | null;
};

type BankrollPoint = {
  x: number;
  label: string;
  balance: number;
};

type BankrollChartResponse = {
  ok: boolean;
  points: BankrollPoint[];
};

type RoiPoint = {
  x: number;
  label: string;
  roi: number;
};

type RoiChartResponse = {
  ok: boolean;
  points: RoiPoint[];
};

type HeatmapCell = {
  date: string;
  result: "won" | "lost" | "void" | "none";
  count: number;
};

type HeatmapResponse = {
  ok: boolean;
  cells: HeatmapCell[];
};

type StreakResponse = {
  ok: boolean;
  currentWinStreak: number;
  currentLoseStreak: number;
  bestWinStreak: number;
  worstLoseStreak: number;
};

type BetHistoryItem = {
  id: string;
  created_at: string;
  stake: number;
  total_odds: number;
  payout: number;
  status: string;
};

type BetsResponse = {
  ok: boolean;
  bets: BetHistoryItem[];
};

type Tone = "neutral" | "green" | "red" | "yellow" | "blue" | "purple";

type ChartTooltipPayload = {
  payload?: BankrollPoint & RoiPoint;
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function toNum(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt2(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function fmtPct(v: unknown) {
  return `${fmt2(v)}%`;
}

function fmtDate(value?: string | null) {
  if (!value) return "—";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function metricTone(value: number): Tone {
  if (value > 0) return "green";
  if (value < 0) return "red";
  return "neutral";
}

function resultLabel(status: string) {
  const s = String(status || "").toLowerCase();

  if (s === "won") return "Wygrany";
  if (s === "lost") return "Przegrany";
  if (s === "void") return "Zwrot";

  return "W grze";
}

function resultTone(status: string): Tone {
  const s = String(status || "").toLowerCase();

  if (s === "won") return "green";
  if (s === "lost") return "red";
  if (s === "void") return "yellow";

  return "blue";
}

function toneTextClass(tone: Tone) {
  if (tone === "green") return "text-green-300";
  if (tone === "red") return "text-red-300";
  if (tone === "yellow") return "text-yellow-300";
  if (tone === "blue") return "text-sky-300";
  if (tone === "purple") return "text-violet-300";
  return "text-white";
}

function toneCardClass(tone: Tone) {
  if (tone === "green") return "border-green-500/20 bg-green-500/10";
  if (tone === "red") return "border-red-500/20 bg-red-500/10";
  if (tone === "yellow") return "border-yellow-500/20 bg-yellow-500/10";
  if (tone === "blue") return "border-sky-500/20 bg-sky-500/10";
  if (tone === "purple") return "border-violet-500/20 bg-violet-500/10";
  return "border-neutral-800 bg-neutral-950/80";
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
  tone?: Tone;
}) {
  return (
    <div className={cn("rounded-3xl border p-4", toneCardClass(tone))}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </div>

      <div
        className={cn(
          "mt-3 break-words text-2xl font-semibold leading-tight",
          toneTextClass(tone)
        )}
      >
        {value}
      </div>

      {hint ? (
        <div className="mt-2 text-xs leading-5 text-neutral-500">{hint}</div>
      ) : null}
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
    <SurfaceCard className={cn("overflow-hidden", className)}>
      <div className="flex flex-col gap-3 border-b border-neutral-800 bg-neutral-900/30 p-5 sm:flex-row sm:items-start sm:justify-between">
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

      <div className="p-4 sm:p-5">{children}</div>
    </SurfaceCard>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-neutral-800 bg-black/20 p-6 text-sm text-neutral-500">
      {children}
    </div>
  );
}

function ProfileChartTooltip({
  active,
  payload,
  kind,
}: {
  active?: boolean;
  payload?: ChartTooltipPayload[];
  kind: "balance" | "roi";
}) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-2xl border border-neutral-700 bg-black/95 p-3 text-sm shadow-2xl">
      <div className="font-semibold text-white">{point.label}</div>

      <div className="mt-2 text-neutral-300">
        {kind === "balance" ? (
          <>
            Saldo:{" "}
            <span className="font-semibold text-white">
              {fmt2(point.balance)} VB
            </span>
          </>
        ) : (
          <>
            ROI:{" "}
            <span className={cn("font-semibold", toneTextClass(metricTone(toNum(point.roi))))}>
              {fmtPct(point.roi)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function HeatmapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
      <div className="inline-flex items-center gap-2">
        <span className="h-3 w-3 rounded bg-green-500" />
        <span>Win</span>
      </div>

      <div className="inline-flex items-center gap-2">
        <span className="h-3 w-3 rounded bg-red-500" />
        <span>Loss</span>
      </div>

      <div className="inline-flex items-center gap-2">
        <span className="h-3 w-3 rounded bg-neutral-500" />
        <span>Void</span>
      </div>

      <div className="inline-flex items-center gap-2">
        <span className="h-3 w-3 rounded bg-neutral-800" />
        <span>Brak kuponów</span>
      </div>
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="w-full space-y-5 px-4 text-white sm:px-5 xl:px-6 2xl:px-8">
      <div className="animate-pulse overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950/70">
        <div className="h-64 bg-neutral-900/70" />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="h-96 animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40" />
        <div className="h-96 animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40" />
      </div>

      <div className="h-80 animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40" />
    </div>
  );
}

function HeatmapCellBox({ cell }: { cell: HeatmapCell }) {
  const cls =
    cell.result === "won"
      ? "border-green-500/30 bg-green-500"
      : cell.result === "lost"
        ? "border-red-500/30 bg-red-500"
        : cell.result === "void"
          ? "border-neutral-500/30 bg-neutral-500"
          : "border-neutral-800 bg-neutral-800";

  return (
    <div
      title={`${cell.date} • ${cell.result} • ${cell.count}`}
      className={cn(
        "h-6 w-6 rounded-lg border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:scale-110",
        cls
      )}
    />
  );
}

export default function PublicUserProfilePage() {
  const params = useParams<{ username: string }>();
  const usernameParam = decodeURIComponent(params.username);

  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);

  const [profile, setProfile] = useState<PublicProfileResponse["profile"]>(null);
  const [bankrollPoints, setBankrollPoints] = useState<BankrollPoint[]>([]);
  const [roiPoints, setRoiPoints] = useState<RoiPoint[]>([]);
  const [heatmapCells, setHeatmapCells] = useState<HeatmapCell[]>([]);
  const [streak, setStreak] = useState<StreakResponse | null>(null);
  const [bets, setBets] = useState<BetHistoryItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setMissing(false);

    try {
      const [
        profileRes,
        bankrollRes,
        roiRes,
        heatmapRes,
        streakRes,
        betsRes,
      ] = await Promise.all([
        fetch(`/api/users/${encodeURIComponent(usernameParam)}`, {
          cache: "no-store",
        }),
        fetch(`/api/users/${encodeURIComponent(usernameParam)}/bankroll-chart`, {
          cache: "no-store",
        }),
        fetch(`/api/users/${encodeURIComponent(usernameParam)}/roi-chart`, {
          cache: "no-store",
        }),
        fetch(`/api/users/${encodeURIComponent(usernameParam)}/heatmap`, {
          cache: "no-store",
        }),
        fetch(`/api/users/${encodeURIComponent(usernameParam)}/streak`, {
          cache: "no-store",
        }),
        fetch(`/api/users/${encodeURIComponent(usernameParam)}/bets`, {
          cache: "no-store",
        }),
      ]);

      const profileJson = (await profileRes.json()) as PublicProfileResponse;

      if (!profileRes.ok || !profileJson.profile) {
        setMissing(true);
        return;
      }

      const bankrollJson = bankrollRes.ok
        ? ((await bankrollRes.json()) as BankrollChartResponse)
        : { ok: false, points: [] };

      const roiJson = roiRes.ok
        ? ((await roiRes.json()) as RoiChartResponse)
        : { ok: false, points: [] };

      const heatmapJson = heatmapRes.ok
        ? ((await heatmapRes.json()) as HeatmapResponse)
        : { ok: false, cells: [] };

      const streakJson = streakRes.ok
        ? ((await streakRes.json()) as StreakResponse)
        : null;

      const betsJson = betsRes.ok
        ? ((await betsRes.json()) as BetsResponse)
        : { ok: false, bets: [] };

      setProfile(profileJson.profile);
      setBankrollPoints(bankrollJson.points ?? []);
      setRoiPoints(roiJson.points ?? []);
      setHeatmapCells(heatmapJson.cells ?? []);
      setStreak(streakJson);
      setBets(betsJson.bets ?? []);
    } catch {
      setMissing(true);
    } finally {
      setLoading(false);
    }
  }, [usernameParam]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!copied) return;

    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const heatmapRows = useMemo(() => {
    const rows: HeatmapCell[][] = [];
    const size = 14;

    for (let i = 0; i < heatmapCells.length; i += size) {
      rows.push(heatmapCells.slice(i, i + size));
    }

    return rows;
  }, [heatmapCells]);

  const settledBets = useMemo(() => {
    if (!profile) return 0;
    return profile.won_bets + profile.lost_bets + profile.void_bets;
  }, [profile]);

  const winShare = profile?.bets_count
    ? (profile.won_bets / profile.bets_count) * 100
    : 0;

  const loseShare = profile?.bets_count
    ? (profile.lost_bets / profile.bets_count) * 100
    : 0;

  const voidShare = profile?.bets_count
    ? (profile.void_bets / profile.bets_count) * 100
    : 0;

  const profitValue = toNum(profile?.profit);
  const roiValue = toNum(profile?.roi);
  const winrateValue = toNum(profile?.winrate);

  const profileUrl = profile ? `/users/${encodeURIComponent(profile.username)}` : "";

  const copyProfileUrl = async () => {
    const url =
      typeof window !== "undefined" ? window.location.href : profileUrl;

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (missing) {
    notFound();
  }

  if (loading || !profile) {
    return <LoadingShell />;
  }

  return (
    <div className="w-full space-y-5 px-4 text-white sm:px-5 xl:px-6 2xl:px-8">
      <SurfaceCard className="overflow-hidden">
        <div className="border-b border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.13),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.96),rgba(5,5,5,0.98))] p-5 sm:p-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                VirtualBook Player Profile
              </div>

              <div className="mt-3 text-sm text-neutral-400">
                <Link href="/leaderboard" className="transition hover:text-white">
                  Ranking globalny
                </Link>
                <span className="mx-2 text-neutral-700">/</span>
                <span className="text-neutral-300">{profile.username}</span>
              </div>

              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                {profile.username}
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-400">
                Publiczny profil gracza z formą, historią wyników, wykresami
                bankrolla i statystykami skuteczności kuponów.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <StatusPill tone={metricTone(profitValue)}>
                  Profit: {profitValue > 0 ? "+" : ""}
                  {fmt2(profile.profit)} VB
                </StatusPill>

                <StatusPill tone={metricTone(roiValue)}>
                  ROI: {fmtPct(profile.roi)}
                </StatusPill>

                <StatusPill tone="blue">
                  Kupony: {profile.bets_count}
                </StatusPill>

                <StatusPill>
                  Rozliczone: {settledBets}
                </StatusPill>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href="/leaderboard"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Ranking
                </Link>

                <Link
                  href="/events"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Mecze
                </Link>

                <button
                  type="button"
                  onClick={copyProfileUrl}
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  {copied ? "Skopiowano" : "Kopiuj profil"}
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[520px]">
              <MetricCard
                label="Saldo"
                value={`${fmt2(profile.balance_vb)} VB`}
                hint="Aktualny bankroll gracza"
                tone="blue"
              />

              <MetricCard
                label="Profit"
                value={`${profitValue > 0 ? "+" : ""}${fmt2(profile.profit)} VB`}
                hint="Wynik z rozliczonych kuponów"
                tone={metricTone(profitValue)}
              />

              <MetricCard
                label="ROI"
                value={fmtPct(profile.roi)}
                hint="Zwrot z postawionych stawek"
                tone={metricTone(roiValue)}
              />

              <MetricCard
                label="Winrate"
                value={fmtPct(profile.winrate)}
                hint="Skuteczność rozliczonych typów"
                tone={winrateValue >= 50 ? "green" : "neutral"}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Kupony"
            value={profile.bets_count}
            hint="Łączna liczba kuponów"
          />

          <MetricCard
            label="Won"
            value={profile.won_bets}
            hint={`${fmtPct(winShare)} wszystkich kuponów`}
            tone="green"
          />

          <MetricCard
            label="Lost"
            value={profile.lost_bets}
            hint={`${fmtPct(loseShare)} wszystkich kuponów`}
            tone="red"
          />

          <MetricCard
            label="Void"
            value={profile.void_bets}
            hint={`${fmtPct(voidShare)} wszystkich kuponów`}
            tone={profile.void_bets > 0 ? "yellow" : "neutral"}
          />
        </div>
      </SurfaceCard>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-5 2xl:grid-cols-2">
            <SectionCard
              title="Wykres bankrolla"
              subtitle="Saldo gracza na osi czasu."
            >
              {bankrollPoints.length === 0 ? (
                <EmptyState>Brak danych do wykresu bankrolla.</EmptyState>
              ) : (
                <div className="h-[340px]">
                  <ResponsiveContainer>
                    <LineChart data={bankrollPoints}>
                      <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="x"
                        stroke="#888"
                        minTickGap={24}
                        tickFormatter={(value) =>
                          bankrollPoints[Number(value)]?.label ?? ""
                        }
                      />
                      <YAxis stroke="#888" />
                      <Tooltip content={<ProfileChartTooltip kind="balance" />} />
                      <Line
                        type="monotone"
                        dataKey="balance"
                        stroke="#38bdf8"
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="ROI chart"
              subtitle="ROI gracza w czasie."
            >
              {roiPoints.length === 0 ? (
                <EmptyState>Brak danych do wykresu ROI.</EmptyState>
              ) : (
                <div className="h-[340px]">
                  <ResponsiveContainer>
                    <LineChart data={roiPoints}>
                      <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="x"
                        stroke="#888"
                        minTickGap={24}
                        tickFormatter={(value) =>
                          roiPoints[Number(value)]?.label ?? ""
                        }
                      />
                      <YAxis stroke="#888" />
                      <Tooltip content={<ProfileChartTooltip kind="roi" />} />
                      <Line
                        type="monotone"
                        dataKey="roi"
                        stroke="#22c55e"
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SectionCard>
          </div>

          <SectionCard
            title="Win / Loss heatmap"
            subtitle="Ostatnie dni aktywności kuponowej."
            action={<HeatmapLegend />}
          >
            {heatmapRows.length === 0 ? (
              <EmptyState>Brak danych do heatmapy.</EmptyState>
            ) : (
              <div className="space-y-2 overflow-x-auto pb-1">
                {heatmapRows.map((row, rowIndex) => (
                  <div key={rowIndex} className="flex min-w-max gap-2">
                    {row.map((cell) => (
                      <HeatmapCellBox key={cell.date} cell={cell} />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Historia kuponów"
            subtitle="Ostatnie kupony gracza."
            action={<StatusPill>{bets.length} wpisów</StatusPill>}
          >
            {bets.length === 0 ? (
              <EmptyState>Brak historii kuponów.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="text-xs text-neutral-400">
                    <tr className="border-b border-neutral-800">
                      <th className="px-5 py-3 text-left font-medium">Czas</th>
                      <th className="px-5 py-3 text-left font-medium">Bet ID</th>
                      <th className="px-5 py-3 text-right font-medium">Stawka</th>
                      <th className="px-5 py-3 text-right font-medium">Kurs</th>
                      <th className="px-5 py-3 text-right font-medium">Payout</th>
                      <th className="px-5 py-3 text-right font-medium">Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {bets.map((bet) => (
                      <tr
                        key={bet.id}
                        className="border-b border-neutral-800/70 transition hover:bg-neutral-900/50"
                      >
                        <td className="px-5 py-4 text-neutral-300">
                          {fmtDate(bet.created_at)}
                        </td>

                        <td className="px-5 py-4">
                          <span className="block max-w-[220px] truncate font-medium text-white">
                            {bet.id}
                          </span>
                        </td>

                        <td className="px-5 py-4 text-right font-semibold text-neutral-200">
                          {fmt2(bet.stake)} VB
                        </td>

                        <td className="px-5 py-4 text-right font-semibold text-neutral-200">
                          {fmt2(bet.total_odds)}
                        </td>

                        <td className="px-5 py-4 text-right font-semibold text-neutral-200">
                          {fmt2(bet.payout)} VB
                        </td>

                        <td className="px-5 py-4 text-right">
                          <StatusPill tone={resultTone(bet.status)}>
                            {resultLabel(bet.status)}
                          </StatusPill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        <aside className="min-w-0 space-y-5">
          <SurfaceCard className="p-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
              Forma gracza
            </div>

            <div className="mt-3 text-2xl font-semibold text-white">
              Snapshot
            </div>

            <p className="mt-2 text-sm leading-6 text-neutral-400">
              Skrót aktualnej skuteczności i bilansu gracza.
            </p>

            <div className="mt-5 grid gap-3">
              <MetricCard
                label="Winrate"
                value={fmtPct(profile.winrate)}
                tone={winrateValue >= 50 ? "green" : "neutral"}
              />

              <MetricCard
                label="Profit"
                value={`${profitValue > 0 ? "+" : ""}${fmt2(profile.profit)} VB`}
                tone={metricTone(profitValue)}
              />

              <MetricCard
                label="ROI"
                value={fmtPct(profile.roi)}
                tone={metricTone(roiValue)}
              />

              <MetricCard
                label="Rozliczone"
                value={settledBets}
                hint="Won + Lost + Void"
              />
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
              Bet streak
            </div>

            <div className="mt-3 text-2xl font-semibold text-white">
              Serie
            </div>

            {!streak ? (
              <div className="mt-5">
                <EmptyState>Brak danych o seriach.</EmptyState>
              </div>
            ) : (
              <div className="mt-5 grid gap-3">
                <MetricCard
                  label="Current win streak"
                  value={streak.currentWinStreak}
                  tone={streak.currentWinStreak > 0 ? "green" : "neutral"}
                />

                <MetricCard
                  label="Current lose streak"
                  value={streak.currentLoseStreak}
                  tone={streak.currentLoseStreak > 0 ? "red" : "neutral"}
                />

                <MetricCard
                  label="Best win streak"
                  value={streak.bestWinStreak}
                  tone="green"
                />

                <MetricCard
                  label="Worst lose streak"
                  value={streak.worstLoseStreak}
                  tone="red"
                />
              </div>
            )}
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
              Publiczny link
            </div>

            <div className="mt-3 text-lg font-semibold text-white">
              Udostępniany profil
            </div>

            <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 text-xs text-neutral-400">
              {profileUrl}
            </div>

            <button
              type="button"
              onClick={copyProfileUrl}
              className="mt-4 w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
            >
              {copied ? "Link skopiowany" : "Kopiuj link"}
            </button>
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
              Szybka nawigacja
            </div>

            <div className="mt-4 grid gap-2">
              <Link
                href="/leaderboard"
                className="rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
              >
                Ranking globalny
              </Link>

              <Link
                href="/events"
                className="rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
              >
                Mecze i kursy
              </Link>

              <Link
                href="/groups"
                className="rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
              >
                Grupy
              </Link>
            </div>
          </SurfaceCard>
        </aside>
      </div>
    </div>
  );
}