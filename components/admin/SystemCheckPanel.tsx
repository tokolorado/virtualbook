"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type CheckSeverity = "info" | "warning" | "critical";

type SystemCheckRun = {
  id: number;
  started_at: string;
  finished_at: string | null;
  started_by: string | null;
  source: string;
  status: "running" | "success" | "failed";
  ok: boolean | null;
  checks_total: number;
  checks_passed: number;
  checks_failed: number;
  summary: any;
  error: string | null;
};

type SystemCheckResult = {
  id: number;
  run_id: number;
  check_key: string;
  severity: CheckSeverity;
  ok: boolean;
  rows_count: number;
  sample: unknown[];
  details: Record<string, unknown>;
  created_at: string;
};

function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function severityRank(severity: CheckSeverity) {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function severityClass(severity: CheckSeverity) {
  if (severity === "critical") {
    return "border-red-500/30 bg-red-500/10 text-red-300";
  }
  if (severity === "warning") {
    return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
  }
  return "border-neutral-700 bg-neutral-950 text-neutral-300";
}

function runBadge(run: SystemCheckRun | null) {
  if (!run) {
    return "border-neutral-700 bg-neutral-950 text-neutral-300";
  }
  if (run.status === "failed") {
    return "border-red-500/30 bg-red-500/10 text-red-300";
  }
  if (run.ok) {
    return "border-green-500/30 bg-green-500/10 text-green-300";
  }
  return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
}

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("No session token");
  return token;
}

export default function SystemCheckPanel() {
  const [loading, setLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<SystemCheckRun | null>(null);
  const [results, setResults] = useState<SystemCheckResult[]>([]);

  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) => {
      if (a.ok !== b.ok) return a.ok ? 1 : -1;
      return severityRank(a.severity) - severityRank(b.severity);
    });
  }, [results]);

  const loadLatest = async () => {
    try {
      setError(null);
      setBootLoading(true);

      const token = await getAccessToken();

      const res = await fetch("/api/admin/system-check/latest", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error ?? "Nie udało się pobrać wyników.");
      }

      setRun((data.run ?? null) as SystemCheckRun | null);
      setResults((data.results ?? []) as SystemCheckResult[]);
    } catch (e: any) {
      setError(e?.message ?? "Nie udało się pobrać wyników.");
      setRun(null);
      setResults([]);
    } finally {
      setBootLoading(false);
    }
  };

  const runChecks = async () => {
    try {
      setLoading(true);
      setError(null);

      const token = await getAccessToken();

      const res = await fetch("/api/admin/system-check/run", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error ?? "Nie udało się uruchomić System Check.");
      }

      await loadLatest();
      alert("System Check zakończony ✅");
    } catch (e: any) {
      setError(e?.message ?? "Nie udało się uruchomić System Check.");
      alert(e?.message ?? "Nie udało się uruchomić System Check.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLatest();
  }, []);

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-semibold">System Check</div>
          <div className="text-xs text-neutral-400 mt-1">
            Jednym kliknięciem uruchamiasz pakiet kontroli spójności wallet / ledger / bets /
            settlement.
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={loadLatest}
            disabled={bootLoading || loading}
            className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm disabled:opacity-50"
          >
            {bootLoading ? "..." : "Odśwież"}
          </button>

          <button
            onClick={runChecks}
            disabled={loading}
            className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm disabled:opacity-50"
          >
            {loading ? "Uruchamianie..." : "Uruchom System Check"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {bootLoading ? (
        <div className="text-sm text-neutral-400">Ładowanie wyników...</div>
      ) : !run ? (
        <div className="text-sm text-neutral-400">Brak wcześniejszych uruchomień.</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 text-sm">
            <span
              className={[
                "inline-flex rounded-full px-2.5 py-1 text-xs border",
                runBadge(run),
              ].join(" ")}
            >
              {run.status === "failed"
                ? "FAILED"
                : run.ok
                  ? "OK"
                  : "ATTENTION"}
            </span>

            <span>
              Start: <b className="text-white">{fmtDate(run.started_at)}</b>
            </span>

            <span>
              Koniec: <b className="text-white">{fmtDate(run.finished_at)}</b>
            </span>

            <span>
              Wszystkie: <b className="text-white">{run.checks_total}</b>
            </span>

            <span>
              Passed: <b className="text-green-400">{run.checks_passed}</b>
            </span>

            <span>
              Failed:{" "}
              <b className={run.checks_failed > 0 ? "text-red-400" : "text-white"}>
                {run.checks_failed}
              </b>
            </span>
          </div>

          {run.error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {run.error}
            </div>
          )}

          {sortedResults.length === 0 ? (
            <div className="text-sm text-neutral-400">Brak zapisanych rezultatów.</div>
          ) : (
            <div className="space-y-3">
              {sortedResults.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-white">{r.check_key}</span>

                        <span
                          className={[
                            "inline-flex rounded-full px-2.5 py-1 text-xs border",
                            severityClass(r.severity),
                          ].join(" ")}
                        >
                          {r.severity}
                        </span>

                        <span
                          className={[
                            "inline-flex rounded-full px-2.5 py-1 text-xs border",
                            r.ok
                              ? "border-green-500/30 bg-green-500/10 text-green-300"
                              : "border-red-500/30 bg-red-500/10 text-red-300",
                          ].join(" ")}
                        >
                          {r.ok ? "PASS" : "FAIL"}
                        </span>
                      </div>

                      <div className="text-xs text-neutral-400">
                        rows_count: <b className="text-white">{r.rows_count}</b>
                      </div>
                    </div>

                    <div className="text-xs text-neutral-500">{fmtDate(r.created_at)}</div>
                  </div>

                  {!r.ok && (
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer text-neutral-300 hover:text-white">
                        Pokaż sample
                      </summary>

                      <pre className="mt-2 bg-black/30 border border-neutral-800 rounded-xl p-3 overflow-auto">
                        {JSON.stringify(r.sample ?? [], null, 2)}
                      </pre>

                      {!!r.details && Object.keys(r.details).length > 0 && (
                        <pre className="mt-2 bg-black/30 border border-neutral-800 rounded-xl p-3 overflow-auto">
                          {JSON.stringify(r.details, null, 2)}
                        </pre>
                      )}
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}