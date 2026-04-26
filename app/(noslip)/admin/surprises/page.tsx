// app/(noslip)/admin/surprises/page.tsx
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Tone = "neutral" | "green" | "red" | "yellow" | "blue" | "pink";

type AdminUser = {
  id: string;
  email: string;
  balance_vb: number;
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function fmt2(value: number | null | undefined) {
  return Number(value ?? 0).toFixed(2);
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
            : tone === "pink"
              ? "border-pink-500/30 bg-pink-500/10 text-pink-300"
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
            : tone === "pink"
              ? "border-pink-500/20 bg-pink-500/10"
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
            : tone === "pink"
              ? "text-pink-300"
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

function Notice({
  tone,
  children,
}: {
  tone: "success" | "error" | "info";
  children: ReactNode;
}) {
  const cls =
    tone === "success"
      ? "border-green-500/30 bg-green-500/10 text-green-200"
      : tone === "error"
        ? "border-red-500/30 bg-red-500/10 text-red-200"
        : "border-sky-500/30 bg-sky-500/10 text-sky-200";

  return <div className={cn("rounded-2xl border px-4 py-3 text-sm", cls)}>{children}</div>;
}

export default function AdminSurprisesPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("Kocham Cię <3");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [notice, setNotice] = useState<{
    tone: "success" | "error" | "info";
    message: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadUsers = async () => {
      try {
        setUsersLoading(true);
        setUsersError(null);

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) throw new Error("No session token");

        const res = await fetch("/api/admin/users", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json();

        if (cancelled) return;

        if (!res.ok) {
          setUsers([]);
          setUsersError(data?.error ?? "Nie udało się pobrać użytkowników");
          return;
        }

        const normalized = Array.isArray(data?.users)
          ? data.users
              .map((user: any) => ({
                id: String(user.id ?? ""),
                email: String(user.email ?? ""),
                balance_vb: Number(user.balance_vb ?? 0),
              }))
              .filter((user: AdminUser) => user.id && user.email)
          : [];

        setUsers(normalized);
      } catch (e: any) {
        if (cancelled) return;
        setUsers([]);
        setUsersError(e?.message ?? "Nie udało się pobrać użytkowników");
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    };

    void loadUsers();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q) return users;

    return users.filter((user) => {
      const emailMatch = String(user.email ?? "").toLowerCase().includes(q);
      const idMatch = String(user.id ?? "").toLowerCase().includes(q);
      return emailMatch || idMatch;
    });
  }, [users, query]);

  const selectedUser = useMemo(() => {
    if (!selectedUserId) return null;
    return users.find((user) => user.id === selectedUserId) ?? null;
  }, [users, selectedUserId]);

  const chooseUser = (user: AdminUser) => {
    setSelectedUserId(user.id);
    setEmail(user.email);
    setResult(null);
    setNotice(null);
  };

  const sendSurprise = async () => {
    const safeEmail = email.trim().toLowerCase();
    const safeMessage = message.trim();

    if (!safeEmail) {
      setNotice({ tone: "error", message: "Podaj email użytkownika." });
      return;
    }

    if (!safeMessage) {
      setNotice({ tone: "error", message: "Podaj treść niespodzianki." });
      return;
    }

    try {
      setLoading(true);
      setResult(null);
      setNotice(null);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) throw new Error("No session token");

      const res = await fetch("/api/admin/send-surprise", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: safeEmail,
          message: safeMessage,
        }),
      });

      const data = await res.json();
      setResult(data);

      if (!res.ok) {
        setNotice({
          tone: "error",
          message: data?.error ?? "Nie udało się wysłać niespodzianki",
        });
        return;
      }

      setNotice({
        tone: "success",
        message: "Niespodzianka zapisana ✅",
      });
    } catch (e: any) {
      setNotice({
        tone: "error",
        message: e?.message ?? "Błąd requestu do /api/admin/send-surprise",
      });
    } finally {
      setLoading(false);
    }
  };

  const clearForm = () => {
    setSelectedUserId(null);
    setEmail("");
    setMessage("Kocham Cię <3");
    setResult(null);
    setNotice(null);
  };

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
                Centrum niespodzianek
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-400">
                Wybierz użytkownika, wpisz komunikat i zapisz jednorazowy popup
                do tabeli user_surprises.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <StatusPill tone="blue">Users: {users.length}</StatusPill>
                <StatusPill tone={selectedUser ? "green" : "neutral"}>
                  Selected: {selectedUser ? selectedUser.email : "brak"}
                </StatusPill>
                <StatusPill tone="pink">Popup module</StatusPill>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href="/admin"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Wróć do admina
                </Link>

                <Link
                  href="/admin/logs"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Logi
                </Link>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[520px]">
              <MetricCard
                label="Użytkownicy"
                value={users.length}
                hint="Dostępne konta z API admin users"
                tone="blue"
              />
              <MetricCard
                label="Wybrany"
                value={selectedUser ? "TAK" : "NIE"}
                hint={selectedUser?.email ?? "Kliknij użytkownika z listy"}
                tone={selectedUser ? "green" : "neutral"}
              />
              <MetricCard
                label="Wiadomość"
                value={message.trim().length}
                hint="Liczba znaków w popupie"
                tone={message.trim().length > 0 ? "pink" : "neutral"}
              />
              <MetricCard
                label="Status"
                value={loading ? "SENDING" : "READY"}
                hint="Stan formularza"
                tone={loading ? "yellow" : "green"}
              />
            </div>
          </div>
        </div>
      </SurfaceCard>

      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <SurfaceCard className="overflow-hidden">
          <div className="border-b border-neutral-800 bg-neutral-900/30 p-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
              Users workspace
            </div>
            <h2 className="mt-2 text-xl font-semibold text-white">Użytkownicy</h2>
            <p className="mt-1 text-sm leading-6 text-neutral-400">
              Kliknij konto, aby uzupełnić formularz po prawej stronie.
            </p>
          </div>

          <div className="space-y-4 p-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj po emailu lub ID..."
              className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-neutral-600"
            />

            <div className="max-h-[680px] space-y-2 overflow-auto pr-1">
              {usersLoading ? (
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 text-sm text-neutral-400">
                  Ładowanie użytkowników…
                </div>
              ) : usersError ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                  {usersError}
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-neutral-800 bg-black/20 p-4 text-sm text-neutral-500">
                  Brak użytkowników dla tego filtra.
                </div>
              ) : (
                filteredUsers.map((user) => {
                  const active = selectedUserId === user.id;

                  return (
                    <button
                      key={user.id}
                      onClick={() => chooseUser(user)}
                      className={cn(
                        "w-full rounded-2xl border p-4 text-left transition",
                        active
                          ? "border-white bg-white text-black shadow-[0_12px_35px_rgba(255,255,255,0.08)]"
                          : "border-neutral-800 bg-neutral-950/70 text-white hover:bg-neutral-900"
                      )}
                    >
                      <div className="break-all text-sm font-semibold">{user.email}</div>

                      <div
                        className={cn(
                          "mt-2 break-all text-[11px]",
                          active ? "text-neutral-700" : "text-neutral-500"
                        )}
                      >
                        {user.id}
                      </div>

                      <div
                        className={cn(
                          "mt-3 text-xs font-semibold",
                          active ? "text-neutral-800" : "text-neutral-300"
                        )}
                      >
                        Saldo: {fmt2(user.balance_vb)} VB
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard className="overflow-hidden">
          <div className="border-b border-neutral-800 bg-neutral-900/30 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                  Send popup
                </div>
                <h2 className="mt-2 text-xl font-semibold text-white">
                  Wyślij niespodziankę
                </h2>
                <p className="mt-1 text-sm leading-6 text-neutral-400">
                  Zapisze jednorazowy popup do tabeli{" "}
                  <code className="rounded bg-neutral-950 px-1.5 py-0.5 text-neutral-300">
                    user_surprises
                  </code>
                  .
                </p>
              </div>

              {selectedUser ? (
                <StatusPill tone="green">user selected</StatusPill>
              ) : (
                <StatusPill>manual email</StatusPill>
              )}
            </div>
          </div>

          <div className="space-y-5 p-5">
            {selectedUser ? (
              <div className="rounded-3xl border border-green-500/20 bg-green-500/10 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-green-400/80">
                  Wybrany użytkownik
                </div>
                <div className="mt-2 break-all text-sm font-semibold text-white">
                  {selectedUser.email}
                </div>
                <div className="mt-1 break-all text-xs text-neutral-400">
                  {selectedUser.id}
                </div>
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">
                Email użytkownika
              </label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="np. kowalkowskapaulina011@gmail.com"
                className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-neutral-600"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">
                Treść popupu
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={7}
                placeholder="np. Kocham Cię <3"
                className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-neutral-600"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={sendSurprise}
                disabled={loading}
                className="rounded-2xl border border-pink-500/30 bg-pink-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Wysyłanie..." : "Wyślij niespodziankę"}
              </button>

              <button
                onClick={clearForm}
                className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
              >
                Wyczyść
              </button>
            </div>

            {result ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-neutral-400 transition hover:text-white">
                  Pokaż wynik requestu
                </summary>
                <pre className="mt-3 max-h-[360px] overflow-auto rounded-2xl border border-neutral-800 bg-black/30 p-4 text-neutral-300">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}