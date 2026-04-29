"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { formatVB } from "@/lib/format";

type Mission = {
  id: string;
  title: string;
  description: string;
  period: "daily" | "weekly";
  periodKey: string;
  target: number;
  reward: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  claimable: boolean;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function periodLabel(period: Mission["period"]) {
  return period === "daily" ? "Dzienna" : "Tygodniowa";
}

function MissionCard({
  mission,
  claiming,
  onClaim,
}: {
  mission: Mission;
  claiming: boolean;
  onClaim: (missionId: string) => void;
}) {
  const pct =
    mission.target > 0
      ? Math.min(100, Math.round((mission.progress / mission.target) * 100))
      : 0;

  return (
    <div
      className={cx(
        "rounded-3xl border p-5 shadow-[0_18px_60px_rgba(0,0,0,0.24)]",
        mission.claimed
          ? "border-green-500/20 bg-green-500/10"
          : mission.completed
            ? "border-sky-500/25 bg-sky-500/10"
            : "border-neutral-800 bg-neutral-950/70"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
            {periodLabel(mission.period)}
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
            {mission.title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-neutral-400">
            {mission.description}
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-black/30 px-4 py-3 text-right">
          <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
            Nagroda
          </div>
          <div className="mt-1 text-lg font-semibold text-white">
            {formatVB(mission.reward)} VB
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <span>
            Postep: {mission.progress}/{mission.target}
          </span>
          <span>{pct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-900">
          <div
            className={cx(
              "h-full rounded-full",
              mission.claimed
                ? "bg-green-400"
                : mission.completed
                  ? "bg-sky-400"
                  : "bg-neutral-600"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-300">
            okres: {mission.periodKey}
          </span>
          {mission.claimed ? (
            <span className="rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-300">
              Odebrano
            </span>
          ) : mission.completed ? (
            <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-300">
              Gotowe
            </span>
          ) : (
            <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-400">
              W toku
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onClaim(mission.id)}
          disabled={!mission.claimable || claiming}
          className={cx(
            "rounded-2xl px-4 py-3 text-sm font-semibold transition",
            mission.claimable && !claiming
              ? "bg-white text-black hover:bg-neutral-200"
              : "cursor-not-allowed bg-neutral-800/80 text-neutral-500"
          )}
        >
          {claiming ? "Odbieram..." : mission.claimed ? "Odebrane" : "Odbierz"}
        </button>
      </div>
    </div>
  );
}

export default function MissionsPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        setMissions([]);
        setError("Musisz byc zalogowany, zeby zobaczyc misje.");
        return;
      }

      const response = await fetch("/api/missions", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Nie udalo sie pobrac misji.");
      }

      setMissions((payload.missions ?? []) as Mission[]);
      setLastLoadedAt(new Date().toISOString());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Nie udalo sie pobrac misji.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    return {
      total: missions.length,
      ready: missions.filter((mission) => mission.claimable).length,
      claimed: missions.filter((mission) => mission.claimed).length,
      rewardReady: missions
        .filter((mission) => mission.claimable)
        .reduce((sum, mission) => sum + mission.reward, 0),
    };
  }, [missions]);

  const claim = async (missionId: string) => {
    setClaimingId(missionId);
    setError(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        throw new Error("Sesja wygasla.");
      }

      const response = await fetch("/api/missions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ missionId }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Nie udalo sie odebrac nagrody.");
      }

      const balanceAfter = Number(payload?.result?.balanceAfter);
      if (Number.isFinite(balanceAfter)) {
        window.dispatchEvent(
          new CustomEvent("vb:refresh-balance", {
            detail: { balance_vb: balanceAfter, balanceAfter },
          })
        );
      } else {
        window.dispatchEvent(new Event("vb:refresh-balance"));
      }

      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Nie udalo sie odebrac nagrody.");
    } finally {
      setClaimingId(null);
    }
  };

  return (
    <div className="w-full min-w-0 space-y-5">
      <section className="overflow-hidden rounded-3xl border border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.13),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.96),rgba(5,5,5,0.99))] p-5 shadow-[0_18px_80px_rgba(0,0,0,0.35)] sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
              VirtualBook Football
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
              Misje
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-400">
              Dziennie i tygodniowe wyzwania za aktywnosc, trafione kupony i
              granie odważniejszych typow.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:w-[560px]">
            <div className="rounded-2xl border border-neutral-800 bg-black/25 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                Gotowe
              </div>
              <div className="mt-2 text-2xl font-semibold text-white">
                {stats.ready}
              </div>
            </div>
            <div className="rounded-2xl border border-neutral-800 bg-black/25 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                Do odbioru
              </div>
              <div className="mt-2 text-2xl font-semibold text-white">
                {formatVB(stats.rewardReady)} VB
              </div>
            </div>
            <div className="rounded-2xl border border-neutral-800 bg-black/25 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                Odebrane
              </div>
              <div className="mt-2 text-2xl font-semibold text-white">
                {stats.claimed}/{stats.total}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {lastLoadedAt ? (
            <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-300">
              Aktualizacja: {new Date(lastLoadedAt).toLocaleTimeString("pl-PL")}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs font-semibold text-neutral-200 transition hover:bg-neutral-900"
          >
            Odswiez
          </button>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-56 animate-pulse rounded-3xl border border-neutral-800 bg-neutral-950"
            />
          ))}
        </div>
      ) : missions.length === 0 ? (
        <div className="rounded-3xl border border-neutral-800 bg-neutral-950/70 p-6">
          <div className="text-lg font-semibold text-white">Brak misji</div>
          <p className="mt-2 text-sm text-neutral-400">
            Misje pojawia sie po wdrozeniu migracji Supabase.
          </p>
          <Link
            href="/events"
            className="mt-4 inline-flex rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black"
          >
            Przejdz do meczow
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {missions.map((mission) => (
            <MissionCard
              key={mission.id}
              mission={mission}
              claiming={claimingId === mission.id}
              onClaim={claim}
            />
          ))}
        </div>
      )}
    </div>
  );
}
