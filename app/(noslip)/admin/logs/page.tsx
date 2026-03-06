// app/(noslip)/admin/logs/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

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

export default function AdminCronLogsPage() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [logs, setLogs] = useState<CronLog[]>([]);
  const [error, setError] = useState<string | null>(null);

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

      const r = await fetch("/api/admin/cron-logs?limit=100", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await r.json();

      if (!r.ok || !data?.ok) {
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
    load();
  }, []);

  if (loading) {
    return <div className="text-neutral-400">Ładowanie logów...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 text-neutral-300">
        Brak dostępu. To jest panel admina.
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin — logi cronów</h1>
          <p className="text-neutral-400 mt-1 text-sm">
            Historia uruchomień results / settle / pipeline.
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href="/admin"
            className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
          >
            Wróć do admina
          </Link>

          <button
            onClick={load}
            className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
          >
            Odśwież
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {logs.length === 0 ? (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 text-neutral-400">
          Brak logów.
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const statusColor =
              log.status === "success"
                ? "text-green-400"
                : log.status === "error"
                ? "text-red-400"
                : "text-yellow-300";

            return (
              <div
                key={log.id}
                className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span>
                        ID: <b className="text-white">{log.id}</b>
                      </span>
                      <span>
                        Job: <b className="text-white">{log.job_name}</b>
                      </span>
                      <span>
                        Status: <b className={statusColor}>{log.status.toUpperCase()}</b>
                      </span>
                      <span>
                        Source: <b className="text-white">{log.source ?? "-"}</b>
                      </span>
                    </div>

                    <div className="text-xs text-neutral-400 space-y-1">
                      <div>Started: {new Date(log.started_at).toLocaleString()}</div>
                      <div>
                        Finished:{" "}
                        {log.finished_at ? new Date(log.finished_at).toLocaleString() : "-"}
                      </div>
                      <div>Created: {new Date(log.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                </div>

                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-neutral-300 hover:text-white">
                    Pokaż details JSON
                  </summary>
                  <pre className="mt-2 bg-neutral-950/60 border border-neutral-800 rounded-xl p-3 overflow-auto">
                    {JSON.stringify(log.details, null, 2)}
                  </pre>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}