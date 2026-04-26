// app/(noslip)/admin/logs/page.tsx
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Tone = "neutral" | "green" | "red" | "yellow" | "blue" | "purple";

type CronLog = {
  id: number;
  job_name: string;
  status: "started" | "success" | "error";
  source: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  details: any;
};

type JobFilter = "all" | "results" | "settle" | "pipeline";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "—";

  return new Date(ts).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getStatusTone(status: CronLog["status"]): Tone {
  if (status === "success") return "green";
  if (status === "error") return "red";
  return "yellow";
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

  const valueClass =
    tone === "green"
      ? "text-green-300"
      : tone === "red"
        ? "text-red-300"
        : tone === "yellow"
          ? "text-yellow-300"
          : tone === "blue"
            ? "text-sky-300"
            : tone === "purple"
              ? "text-violet-300"
              : "text-white";

  return (
    <div className={cn("rounded-3xl border p-4", toneClass)}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </div>
      <div className={cn("mt-3 text-2xl font-semibold leading-tight", valueClass)}>
        {value}
      </div>
      {hint ? <div className="mt-2 text-xs leading-5 text-neutral-500">{hint}</div> : null}
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="w-full space-y-5 px-4 text-white sm:px-5 xl:px-6 2xl:px-8">
      <div className="h-64 animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40" />
      <div className="h-24 animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40"
          />
        ))}
      </div>
    </div>
  );
}

export default function AdminCronLogsPage() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [logs, setLogs] = useState<CronLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [jobFilter, setJobFilter] = useState<JobFilter>("all");
  const [errorsOnly, setErrorsOnly] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", "100");
    params.set("job", jobFilter);
    params.set("errorsOnly", String(errorsOnly));
    return params.toString();
  }, [jobFilter, errorsOnly]);

  const stats = useMemo(() => {
    const success = logs.filter((log) => log.status === "success").length;
    const failed = logs.filter((log) => log.status === "error").length;
    const started = logs.filter((log) => log.status === "started").length;
    const latest = logs[0] ?? null;

    return {
      success,
      failed,
      started,
      latest,
    };
  }, [logs]);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id;
      const token = sessionData.session?.access_token;

      if (!uid || !token) {
        setIsAdmin(false);
        setLogs([]);
        return;
      }

      const { data: adminRow } = await supabase
        .from("admins")
        .select("user_id")
        .eq("user_id", uid)
        .maybeSingle();

      const okAdmin = !!adminRow;
      setIsAdmin(okAdmin);

      if (!okAdmin) {
        setLogs([]);
        return;
      }

      const res = await fetch(`/api/admin/cron-logs?${queryString}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Nie udało się pobrać logów");
      }

      setLogs((data.logs ?? []) as CronLog[]);
    } catch (e: any) {
      setError(e?.message ?? "Błąd");
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  if (loading) {
    return <LoadingShell />;
  }

  if (!isAdmin) {
    return (
      <div className="w-full px-4 text-white sm:px-5 xl:px-6 2xl:px-8">
        <SurfaceCard className="p-6">
          <div className="text-xl font-semibold text-white">Brak dostępu</div>
          <p className="mt-2 text-sm text-neutral-400">
            To jest panel admina.
          </p>
        </SurfaceCard>
      </div>
    );
  }

  return (
    <div className="w-full space-y-5 px-4 text-white sm:px-5 xl:px-6 2xl:px-8">
      <SurfaceCard className="overflow-hidden">
        <div className="border-b border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.96),rgba(5,5,5,0.98))] p-5 sm:p-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                VirtualBook Admin
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                Logi cronów
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-400">
                Historia uruchomień results / settle / pipeline z filtrowaniem,
                statusem i szybkim podglądem details JSON.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <StatusPill tone="blue">Logi: {logs.length}</StatusPill>
                <StatusPill tone="green">Success: {stats.success}</StatusPill>
                <StatusPill tone={stats.failed > 0 ? "red" : "neutral"}>
                  Errors: {stats.failed}
                </StatusPill>
                <StatusPill tone={errorsOnly ? "red" : "neutral"}>
                  Errors only: {errorsOnly ? "ON" : "OFF"}
                </StatusPill>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href="/admin"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Wróć do admina
                </Link>

                <Link
                  href="/admin/match-mapping"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Match mapping
                </Link>

                <button
                  onClick={load}
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Odśwież
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[520px]">
              <MetricCard
                label="Total"
                value={logs.length}
                hint="Liczba logów w aktualnym filtrze"
                tone="blue"
              />
              <MetricCard
                label="Success"
                value={stats.success}
                hint="Zakończone poprawnie"
                tone="green"
              />
              <MetricCard
                label="Errors"
                value={stats.failed}
                hint="Wpisy z błędem"
                tone={stats.failed > 0 ? "red" : "neutral"}
              />
              <MetricCard
                label="Latest"
                value={stats.latest ? stats.latest.job_name : "—"}
                hint={stats.latest ? formatDate(stats.latest.created_at) : "Brak wpisów"}
                tone={stats.latest ? getStatusTone(stats.latest.status) : "neutral"}
              />
            </div>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
              Filters
            </div>
            <h2 className="mt-2 text-xl font-semibold text-white">Filtry</h2>
            <p className="mt-1 text-sm leading-6 text-neutral-400">
              Zawężaj logi po jobie albo pokaż tylko błędy.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {(["all", "results", "settle", "pipeline"] as JobFilter[]).map((job) => {
              const active = jobFilter === job;

              return (
                <button
                  key={job}
                  onClick={() => setJobFilter(job)}
                  className={cn(
                    "rounded-2xl border px-4 py-2.5 text-sm font-semibold transition",
                    active
                      ? "border-white bg-white text-black"
                      : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-900 hover:text-white"
                  )}
                >
                  {job === "all" ? "Wszystkie" : job}
                </button>
              );
            })}

            <button
              onClick={() => setErrorsOnly((value) => !value)}
              className={cn(
                "rounded-2xl border px-4 py-2.5 text-sm font-semibold transition",
                errorsOnly
                  ? "border-red-500/30 bg-red-500/15 text-red-300 hover:bg-red-500/20"
                  : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-900 hover:text-white"
              )}
            >
              {errorsOnly ? "Tylko errors: ON" : "Tylko errors"}
            </button>
          </div>
        </div>
      </SurfaceCard>

      {error ? (
        <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {logs.length === 0 ? (
        <SurfaceCard className="p-6">
          <div className="text-xl font-semibold text-white">
            Brak logów dla wybranych filtrów
          </div>
          <p className="mt-2 text-sm text-neutral-400">
            Zmień filtr joba albo wyłącz tryb tylko błędów.
          </p>
        </SurfaceCard>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const statusTone = getStatusTone(log.status);

            return (
              <SurfaceCard key={log.id} className="overflow-hidden">
                <div className="border-b border-neutral-800 bg-neutral-900/30 p-4 sm:p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <StatusPill tone="blue">ID: {log.id}</StatusPill>
                        <StatusPill tone="purple">Job: {log.job_name}</StatusPill>
                        <StatusPill tone={statusTone}>
                          {log.status.toUpperCase()}
                        </StatusPill>
                        <StatusPill>Source: {log.source ?? "—"}</StatusPill>
                      </div>

                      <div className="mt-4 grid gap-3 text-xs text-neutral-400 md:grid-cols-3">
                        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-3">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                            Started
                          </div>
                          <div className="mt-1 text-neutral-200">
                            {formatDate(log.started_at)}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-3">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                            Finished
                          </div>
                          <div className="mt-1 text-neutral-200">
                            {formatDate(log.finished_at)}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-3">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                            Created
                          </div>
                          <div className="mt-1 text-neutral-200">
                            {formatDate(log.created_at)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <details className="p-4 text-xs sm:p-5">
                  <summary className="cursor-pointer text-neutral-400 transition hover:text-white">
                    Pokaż details JSON
                  </summary>

                  <pre className="mt-3 max-h-[520px] overflow-auto rounded-2xl border border-neutral-800 bg-black/30 p-4 text-neutral-300">
                    {JSON.stringify(log.details, null, 2)}
                  </pre>
                </details>
              </SurfaceCard>
            );
          })}
        </div>
      )}
    </div>
  );
}