"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";

type SystemCheckRun = {
  id: number;
  started_by: string;
  source: string;
  status: "running" | "success" | "failed";
  ok: boolean | null;
  checks_total: number;
  checks_passed: number;
  checks_failed: number;
  summary: any;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

type SystemCheckResult = {
  id: number;
  run_id: number;
  check_key: string;
  severity: "info" | "warning" | "critical";
  ok: boolean;
  rows_count: number;
  sample: any[];
  details: Record<string, unknown> | null;
  created_at: string;
};

type LatestResponse = {
  ok: boolean;
  run: SystemCheckRun | null;
  results: SystemCheckResult[];
  error?: string;
};

type RunResponse = {
  ok: boolean;
  run?: Partial<SystemCheckRun>;
  results?: Array<{
    checkKey: string;
    severity: "info" | "warning" | "critical";
    ok: boolean;
    rowsCount: number;
    sample: unknown[];
    details?: Record<string, unknown>;
  }>;
  summary?: any;
  error?: string;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pl-PL");
}

function fmtDateCompact(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function humanizeCheckKey(key: string) {
  const map: Record<string, string> = {
    profile_balance_vs_latest_ledger: "Saldo profilu vs ostatni ledger",
    duplicate_payout_refund_ledger_rows: "Duplikaty payout/refund w ledger",
    finished_matches_with_unsettled_items: "Finished mecze z nierozliczonymi itemami",
    pending_bets_fully_resolved_by_items: "Pending kupony z w pełni rozliczonymi itemami",
    won_bets_missing_or_mismatched_payout: "Won kupony bez payout lub z błędnym payout",
    void_bets_missing_or_mismatched_refund: "Void kupony bez refund lub z błędnym refund",
    lost_bets_with_payout_or_refund_rows: "Lost kupony z payout/refund w ledger",
  };

  return map[key] ?? key.replaceAll("_", " ");
}

function getSeverityTone(severity: SystemCheckResult["severity"] | "neutral") {
  if (severity === "critical") {
    return "border-red-500/20 bg-red-500/5 text-red-300";
  }
  if (severity === "warning") {
    return "border-yellow-500/20 bg-yellow-500/5 text-yellow-300";
  }
  if (severity === "info") {
    return "border-blue-500/20 bg-blue-500/5 text-blue-300";
  }
  return "border-neutral-800 bg-neutral-950 text-neutral-300";
}

function getStatusTone(ok: boolean) {
  return ok
    ? "border-green-500/20 bg-green-500/10 text-green-300"
    : "border-red-500/20 bg-red-500/10 text-red-300";
}

function SectionCard({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4 md:p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {subtitle ? <p className="mt-1 text-sm text-neutral-400">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
  valueClassName = "",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "green" | "yellow" | "red" | "blue";
  valueClassName?: string;
}) {
  const toneClass =
    tone === "green"
      ? "border-green-500/20 bg-green-500/5"
      : tone === "yellow"
        ? "border-yellow-500/20 bg-yellow-500/5"
        : tone === "red"
          ? "border-red-500/20 bg-red-500/5"
          : tone === "blue"
            ? "border-blue-500/20 bg-blue-500/5"
            : "border-neutral-800 bg-neutral-950/70";

  return (
    <div className={cx("rounded-3xl border p-4", toneClass)}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">{label}</div>
      <div
        className={cx(
          "mt-3 break-words text-2xl font-semibold leading-tight text-white",
          valueClassName
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-2 text-xs text-neutral-400">{hint}</div> : null}
    </div>
  );
}

export default function SystemCheckPanel() {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<SystemCheckRun | null>(null);
  const [results, setResults] = useState<SystemCheckResult[]>([]);

  const getAccessToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("No session token");
    return token;
  }, []);

  const loadLatest = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const token = await getAccessToken();

      const res = await fetch("/api/admin/system-check/latest", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = (await res.json()) as LatestResponse;

      if (!res.ok || !data.ok) {
        throw new Error(data?.error ?? "Nie udało się pobrać System Check.");
      }

      setRun(data.run ?? null);
      setResults(Array.isArray(data.results) ? data.results : []);
    } catch (e: any) {
      setError(e?.message ?? "Błąd pobierania System Check.");
      setRun(null);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  const runCheck = useCallback(async () => {
    try {
      setRunning(true);
      setError(null);

      const token = await getAccessToken();

      const res = await fetch("/api/admin/system-check/run", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = (await res.json()) as RunResponse;

      if (!res.ok || !data.ok) {
        throw new Error(data?.error ?? "System Check failed");
      }

      await loadLatest();
      alert("System Check zakończony ✅");
    } catch (e: any) {
      const msg = e?.message ?? "Błąd uruchamiania System Check.";
      setError(msg);
      alert(msg);
    } finally {
      setRunning(false);
    }
  }, [getAccessToken, loadLatest]);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  const failedResults = useMemo(() => results.filter((x) => !x.ok), [results]);
  const passedResults = useMemo(() => results.filter((x) => x.ok), [results]);

  const runStatusLabel = useMemo(() => {
    if (!run) return "BRAK";
    if (run.status === "running") return "RUNNING";
    if (run.ok) return "OK";
    return "FAILED";
  }, [run]);

  const runTone = useMemo(() => {
    if (!run) return "neutral" as const;
    if (run.status === "running") return "blue" as const;
    return run.ok ? ("green" as const) : ("red" as const);
  }, [run]);

  return (
    <div className="space-y-4">
      <SectionCard
        title="System Check"
        subtitle="Pakiet kontroli spójności wallet / ledger / bets / settlement. Read-only, uruchamiany z panelu admina."
        actions={
          <>
            <button
              onClick={loadLatest}
              disabled={loading || running}
              className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-white transition hover:bg-neutral-800 disabled:opacity-50"
            >
              {loading ? "Odświeżanie..." : "Odśwież"}
            </button>

            <button
              onClick={runCheck}
              disabled={running}
              className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-white transition hover:bg-neutral-800 disabled:opacity-50"
            >
              {running ? "Uruchamianie..." : "Uruchom System Check"}
            </button>
          </>
        }
      >
        {error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        {!error && loading ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 px-4 py-6 text-sm text-neutral-400">
            Ładowanie wyników...
          </div>
        ) : null}

        {!error && !loading && !run ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 px-4 py-6 text-sm text-neutral-400">
            Brak wcześniejszych uruchomień.
          </div>
        ) : null}

        {!error && !loading && run ? (
          <div className="space-y-4">
            <div className="grid gap-3 xl:grid-cols-[1.15fr_1fr]">
              <div className="rounded-3xl border border-neutral-800 bg-neutral-950/60 p-4">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span
                    className={cx(
                      "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
                      run.status === "running"
                        ? "border-blue-500/20 bg-blue-500/10 text-blue-300"
                        : run.ok
                          ? "border-green-500/20 bg-green-500/10 text-green-300"
                          : "border-red-500/20 bg-red-500/10 text-red-300"
                    )}
                  >
                    {runStatusLabel}
                  </span>

                  <span className="text-sm text-neutral-400">
                    Start: <b className="text-white">{fmtDateCompact(run.started_at)}</b>
                  </span>

                  <span className="text-sm text-neutral-400">
                    Koniec: <b className="text-white">{fmtDateCompact(run.finished_at)}</b>
                  </span>

                  <span className="text-sm text-neutral-400">
                    Wszystkie: <b className="text-white">{run.checks_total}</b>
                  </span>

                  <span className="text-sm text-neutral-400">
                    Passed: <b className="text-green-300">{run.checks_passed}</b>
                  </span>

                  <span className="text-sm text-neutral-400">
                    Failed:{" "}
                    <b className={run.checks_failed > 0 ? "text-red-300" : "text-white"}>
                      {run.checks_failed}
                    </b>
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <MetricCard
                    label="Run status"
                    value={runStatusLabel}
                    hint={run.status}
                    tone={runTone}
                  />

                  <MetricCard
                    label="Start"
                    value={fmtDateCompact(run.started_at)}
                    tone="neutral"
                    valueClassName="text-base sm:text-lg"
                  />

                  <MetricCard
                    label="Koniec"
                    value={fmtDateCompact(run.finished_at)}
                    tone="neutral"
                    valueClassName="text-base sm:text-lg"
                  />

                  <MetricCard
                    label="Passed"
                    value={run.checks_passed}
                    hint={`z ${run.checks_total}`}
                    tone="green"
                  />

                  <MetricCard
                    label="Failed"
                    value={run.checks_failed}
                    hint={`source: ${run.source}`}
                    tone={run.checks_failed > 0 ? "red" : "neutral"}
                  />

                  <MetricCard
                    label="Błędy uruchomienia"
                    value={run.error ? "TAK" : "NIE"}
                    hint={run.error ?? "brak"}
                    tone={run.error ? "red" : "neutral"}
                    valueClassName="text-base sm:text-lg"
                  />
                </div>
              </div>

              <div className="rounded-3xl border border-neutral-800 bg-neutral-950/60 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white">Szybkie podsumowanie</div>
                    <div className="mt-1 text-xs text-neutral-400">
                      Najważniejsze informacje z ostatniego uruchomienia.
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <MetricCard
                    label="Pass"
                    value={passedResults.length}
                    hint="checków bez problemów"
                    tone="green"
                  />
                  <MetricCard
                    label="Fail"
                    value={failedResults.length}
                    hint="checków do weryfikacji"
                    tone={failedResults.length > 0 ? "red" : "neutral"}
                  />
                  <MetricCard
                    label="Source"
                    value={run.source}
                    hint={fmtDateCompact(run.started_at)}
                    tone="blue"
                    valueClassName="text-base sm:text-lg"
                  />
                </div>

                {run.error ? (
                  <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                    {run.error}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-neutral-800 bg-black/20 p-3 text-xs text-neutral-400">
                    Ostatni suite zapisany w bazie i gotowy do porównania z kolejnymi uruchomieniami.
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-3xl border border-neutral-800 bg-neutral-950/60 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-base font-semibold text-white">Wyniki checków</div>
                    <div className="mt-1 text-xs text-neutral-400">
                      Każdy check pokazuje severity, wynik i liczbę rekordów.
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {results.map((result) => (
                    <div
                      key={result.id}
                      className="rounded-3xl border border-neutral-800 bg-black/20 p-4"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-base font-semibold text-white">
                              {humanizeCheckKey(result.check_key)}
                            </h4>

                            <span
                              className={cx(
                                "inline-flex rounded-full border px-2.5 py-1 text-xs",
                                getSeverityTone(result.severity)
                              )}
                            >
                              {result.severity}
                            </span>

                            <span
                              className={cx(
                                "inline-flex rounded-full border px-2.5 py-1 text-xs",
                                getStatusTone(result.ok)
                              )}
                            >
                              {result.ok ? "PASS" : "FAIL"}
                            </span>
                          </div>

                          <div className="mt-2 text-xs text-neutral-400">
                            check_key: <span className="text-neutral-300">{result.check_key}</span>
                          </div>
                        </div>

                        <div className="text-xs text-neutral-500">{fmtDateCompact(result.created_at)}</div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <MetricCard
                          label="rows_count"
                          value={result.rows_count}
                          tone={result.rows_count > 0 && !result.ok ? "red" : "neutral"}
                          valueClassName="text-xl"
                        />

                        <MetricCard
                          label="severity"
                          value={result.severity}
                          tone={
                            result.severity === "critical"
                              ? "red"
                              : result.severity === "warning"
                                ? "yellow"
                                : "blue"
                          }
                          valueClassName="text-base sm:text-lg"
                        />

                        <MetricCard
                          label="wynik"
                          value={result.ok ? "PASS" : "FAIL"}
                          tone={result.ok ? "green" : "red"}
                          valueClassName="text-base sm:text-lg"
                        />
                      </div>

                      {(Array.isArray(result.sample) && result.sample.length > 0) ||
                      (result.details && Object.keys(result.details).length > 0) ? (
                        <details className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950/50 p-3">
                          <summary className="cursor-pointer text-sm text-neutral-300 hover:text-white">
                            Pokaż szczegóły
                          </summary>

                          {Array.isArray(result.sample) && result.sample.length > 0 ? (
                            <div className="mt-3">
                              <div className="mb-2 text-xs uppercase tracking-[0.18em] text-neutral-500">
                                sample
                              </div>
                              <pre className="overflow-auto rounded-2xl border border-neutral-800 bg-black/30 p-3 text-xs text-neutral-300">
                                {JSON.stringify(result.sample, null, 2)}
                              </pre>
                            </div>
                          ) : null}

                          {result.details && Object.keys(result.details).length > 0 ? (
                            <div className="mt-3">
                              <div className="mb-2 text-xs uppercase tracking-[0.18em] text-neutral-500">
                                details
                              </div>
                              <pre className="overflow-auto rounded-2xl border border-neutral-800 bg-black/30 p-3 text-xs text-neutral-300">
                                {JSON.stringify(result.details, null, 2)}
                              </pre>
                            </div>
                          ) : null}
                        </details>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-3xl border border-neutral-800 bg-neutral-950/60 p-4">
                  <div className="text-base font-semibold text-white">Stan końcowy</div>
                  <div className="mt-1 text-xs text-neutral-400">
                    Ostatni wynik suite i szybka interpretacja.
                  </div>

                  <div className="mt-4 space-y-3">
                    <div
                      className={cx(
                        "rounded-2xl border p-4 text-sm",
                        run.ok
                          ? "border-green-500/20 bg-green-500/10 text-green-300"
                          : "border-red-500/20 bg-red-500/10 text-red-300"
                      )}
                    >
                      {run.ok
                        ? "Wszystkie checki przeszły poprawnie."
                        : "Wykryto problemy wymagające weryfikacji."}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <MetricCard
                        label="Passed"
                        value={run.checks_passed}
                        hint="pozytywne checki"
                        tone="green"
                      />
                      <MetricCard
                        label="Failed"
                        value={run.checks_failed}
                        hint="negatywne checki"
                        tone={run.checks_failed > 0 ? "red" : "neutral"}
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-neutral-800 bg-neutral-950/60 p-4">
                  <div className="text-base font-semibold text-white">Najważniejsze alerty</div>
                  <div className="mt-1 text-xs text-neutral-400">
                    Tylko checki wymagające uwagi.
                  </div>

                  <div className="mt-4 space-y-3">
                    {failedResults.length === 0 ? (
                      <div className="rounded-2xl border border-green-500/20 bg-green-500/10 p-4 text-sm text-green-300">
                        Brak alertów. Ostatni System Check jest czysty.
                      </div>
                    ) : (
                      failedResults.map((result) => (
                        <div
                          key={result.id}
                          className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-white">
                                {humanizeCheckKey(result.check_key)}
                              </div>
                              <div className="mt-1 text-xs text-red-300">
                                rows_count: {result.rows_count}
                              </div>
                            </div>

                            <span className="rounded-full border border-red-500/20 px-2.5 py-1 text-xs text-red-300">
                              {result.severity}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}