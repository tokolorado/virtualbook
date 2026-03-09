"use client";

import { useEffect, useMemo, useState } from "react";
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

function fmt2(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function metricClass(v: number) {
  if (v > 0) return "text-green-400";
  if (v < 0) return "text-red-400";
  return "text-white";
}

function SmallStatCard({
  label,
  value,
  valueClass = "text-white",
  sublabel,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sublabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="text-xs text-neutral-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${valueClass}`}>{value}</div>
      {sublabel ? <div className="mt-1 text-xs text-neutral-500">{sublabel}</div> : null}
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle ? <p className="text-sm text-neutral-400 mt-1">{subtitle}</p> : null}
        </div>
      </div>

      <div className="mt-4">{children}</div>
    </section>
  );
}

function ProfileChartTooltip({
  active,
  payload,
  kind,
}: {
  active?: boolean;
  payload?: any[];
  kind: "balance" | "roi";
}) {
  if (!active || !payload?.length) return null;

  const p = payload[0]?.payload;
  if (!p) return null;

  return (
    <div className="rounded-xl border border-neutral-700 bg-black px-3 py-2 text-sm shadow-lg">
      <div className="font-semibold text-white">{p.label}</div>
      <div className="mt-1 text-neutral-300">
        {kind === "balance" ? (
          <>
            Saldo: <span className="text-white">{fmt2(p.balance)} VB</span>
          </>
        ) : (
          <>
            ROI: <span className={metricClass(Number(p.roi))}>{fmt2(p.roi)}%</span>
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

export default function PublicUserProfilePage() {
  const params = useParams<{ username: string }>();
  const usernameParam = decodeURIComponent(params.username);

  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const [profile, setProfile] = useState<PublicProfileResponse["profile"]>(null);
  const [bankrollPoints, setBankrollPoints] = useState<BankrollPoint[]>([]);
  const [roiPoints, setRoiPoints] = useState<RoiPoint[]>([]);
  const [heatmapCells, setHeatmapCells] = useState<HeatmapCell[]>([]);
  const [streak, setStreak] = useState<StreakResponse | null>(null);
  const [bets, setBets] = useState<BetHistoryItem[]>([]);

  const load = async () => {
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
        fetch(`/api/users/${encodeURIComponent(usernameParam)}`, { cache: "no-store" }),
        fetch(`/api/users/${encodeURIComponent(usernameParam)}/bankroll-chart`, { cache: "no-store" }),
        fetch(`/api/users/${encodeURIComponent(usernameParam)}/roi-chart`, { cache: "no-store" }),
        fetch(`/api/users/${encodeURIComponent(usernameParam)}/heatmap`, { cache: "no-store" }),
        fetch(`/api/users/${encodeURIComponent(usernameParam)}/streak`, { cache: "no-store" }),
        fetch(`/api/users/${encodeURIComponent(usernameParam)}/bets`, { cache: "no-store" }),
      ]);

      const profileJson = (await profileRes.json()) as PublicProfileResponse;

      if (!profileRes.ok || !profileJson.profile) {
        setMissing(true);
        setLoading(false);
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
  };

  useEffect(() => {
    load();
  }, [usernameParam]);

  const heatmapRows = useMemo(() => {
    const rows: HeatmapCell[][] = [];
    const size = 14;

    for (let i = 0; i < heatmapCells.length; i += size) {
      rows.push(heatmapCells.slice(i, i + size));
    }

    return rows;
  }, [heatmapCells]);

  if (missing) {
    notFound();
  }

  if (loading || !profile) {
    return (
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-semibold">Profil gracza</h1>
        <p className="text-neutral-400 mt-2">Ładowanie...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-sm text-neutral-400">
            <Link href="/leaderboard" className="hover:text-white transition">
              Ranking globalny
            </Link>
            <span className="mx-2">/</span>
            <span>{profile.username}</span>
          </div>

          <h1 className="mt-2 text-3xl font-semibold">{profile.username}</h1>
          <p className="text-neutral-400 mt-1">
            Publiczny profil gracza, statystyki kuponów i forma.
          </p>
        </div>

        <button
          onClick={load}
          className="px-4 py-2 rounded-xl border border-neutral-700 hover:bg-neutral-800 text-sm transition"
        >
          Odśwież
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SmallStatCard
          label="Saldo"
          value={`${fmt2(profile.balance_vb)} VB`}
        />
        <SmallStatCard
          label="Profit"
          value={`${Number(profile.profit) > 0 ? "+" : ""}${fmt2(profile.profit)} VB`}
          valueClass={metricClass(Number(profile.profit))}
        />
        <SmallStatCard
          label="ROI"
          value={`${fmt2(profile.roi)}%`}
          valueClass={metricClass(Number(profile.roi))}
        />
        <SmallStatCard
          label="Winrate"
          value={`${fmt2(profile.winrate)}%`}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SmallStatCard label="Kupony" value={String(profile.bets_count)} />
        <SmallStatCard
          label="Won"
          value={String(profile.won_bets)}
          valueClass="text-green-400"
        />
        <SmallStatCard
          label="Lost"
          value={String(profile.lost_bets)}
          valueClass="text-red-400"
        />
        <SmallStatCard
          label="Void"
          value={String(profile.void_bets)}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionCard
          title="Wykres bankrolla"
          subtitle="Saldo gracza na osi czasu."
        >
          {bankrollPoints.length === 0 ? (
            <div className="text-sm text-neutral-500">Brak danych do wykresu.</div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={bankrollPoints}>
                  <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="x"
                    stroke="#888"
                    minTickGap={24}
                    tickFormatter={(value) => bankrollPoints[value]?.label ?? ""}
                  />
                  <YAxis stroke="#888" />
                  <Tooltip content={<ProfileChartTooltip kind="balance" />} />
                  <Line
                    type="monotone"
                    dataKey="balance"
                    stroke="#38bdf8"
                    strokeWidth={3}
                    dot={false}
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
            <div className="text-sm text-neutral-500">Brak danych do wykresu.</div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={roiPoints}>
                  <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="x"
                    stroke="#888"
                    minTickGap={24}
                    tickFormatter={(value) => roiPoints[value]?.label ?? ""}
                  />
                  <YAxis stroke="#888" />
                  <Tooltip content={<ProfileChartTooltip kind="roi" />} />
                  <Line
                    type="monotone"
                    dataKey="roi"
                    stroke="#22c55e"
                    strokeWidth={3}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <SectionCard
          title="Win / Loss heatmap"
          subtitle="Ostatnie dni aktywności kuponowej."
        >
          <div className="space-y-4">
            <HeatmapLegend />

            {heatmapRows.length === 0 ? (
              <div className="text-sm text-neutral-500">Brak danych do heatmapy.</div>
            ) : (
              <div className="space-y-2">
                {heatmapRows.map((row, rowIndex) => (
                  <div key={rowIndex} className="flex flex-wrap gap-2">
                    {row.map((cell) => {
                      const bg =
                        cell.result === "won"
                          ? "bg-green-500"
                          : cell.result === "lost"
                            ? "bg-red-500"
                            : cell.result === "void"
                              ? "bg-neutral-500"
                              : "bg-neutral-800";

                      return (
                        <div
                          key={cell.date}
                          title={`${cell.date} • ${cell.result} • ${cell.count}`}
                          className={`h-6 w-6 rounded-md border border-neutral-800 ${bg}`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Bet streak"
          subtitle="Aktualna i najlepsza seria."
        >
          {!streak ? (
            <div className="text-sm text-neutral-500">Brak danych o seriach.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <SmallStatCard
                label="Current win streak"
                value={String(streak.currentWinStreak)}
                valueClass="text-green-400"
              />
              <SmallStatCard
                label="Current lose streak"
                value={String(streak.currentLoseStreak)}
                valueClass="text-red-400"
              />
              <SmallStatCard
                label="Best win streak"
                value={String(streak.bestWinStreak)}
                valueClass="text-green-400"
              />
              <SmallStatCard
                label="Worst lose streak"
                value={String(streak.worstLoseStreak)}
                valueClass="text-red-400"
              />
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Historia kuponów"
        subtitle="Ostatnie kupony gracza."
      >
        {bets.length === 0 ? (
          <div className="text-sm text-neutral-500">Brak historii kuponów.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-neutral-800 text-neutral-400">
                <tr>
                  <th className="text-left px-4 py-3">Czas</th>
                  <th className="text-left px-4 py-3">Bet ID</th>
                  <th className="text-right px-4 py-3">Stawka</th>
                  <th className="text-right px-4 py-3">Kurs</th>
                  <th className="text-right px-4 py-3">Payout</th>
                  <th className="text-right px-4 py-3">Status</th>
                </tr>
              </thead>

              <tbody>
                {bets.map((bet) => (
                  <tr
                    key={bet.id}
                    className="border-b border-neutral-800 hover:bg-neutral-800/40 transition"
                  >
                    <td className="px-4 py-4 text-neutral-300">
                      {new Date(bet.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-white font-medium">{bet.id}</td>
                    <td className="px-4 py-4 text-right text-neutral-200">
                      {fmt2(bet.stake)} VB
                    </td>
                    <td className="px-4 py-4 text-right text-neutral-200">
                      {fmt2(bet.total_odds)}
                    </td>
                    <td className="px-4 py-4 text-right text-neutral-200">
                      {fmt2(bet.payout)} VB
                    </td>
                    <td
                      className={`px-4 py-4 text-right font-semibold ${
                        bet.status === "won"
                          ? "text-green-400"
                          : bet.status === "lost"
                            ? "text-red-400"
                            : "text-neutral-300"
                      }`}
                    >
                      {String(bet.status).toUpperCase()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Sharowalny profil"
        subtitle="Docelowo ten profil może być publiczną wizytówką gracza."
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-neutral-400 break-all">
            {typeof window !== "undefined" ? window.location.href : `/users/${profile.username}`}
          </div>

          <button
            onClick={async () => {
              const url =
                typeof window !== "undefined"
                  ? window.location.href
                  : `/users/${profile.username}`;

              try {
                await navigator.clipboard.writeText(url);
              } catch {}
            }}
            className="px-4 py-2 rounded-xl border border-neutral-700 hover:bg-neutral-800 text-sm transition"
          >
            Kopiuj link
          </button>
        </div>
      </SectionCard>
    </div>
  );
}