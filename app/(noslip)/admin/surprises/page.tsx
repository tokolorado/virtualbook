// app/(noslip)/admin/surprises/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type AdminUser = {
  id: string;
  email: string;
  balance_vb: number;
};

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

        setUsers(Array.isArray(data?.users) ? data.users : []);
      } catch (e: any) {
        if (cancelled) return;
        setUsers([]);
        setUsersError(e?.message ?? "Nie udało się pobrać użytkowników");
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    };

    loadUsers();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;

    return users.filter((u) => {
      const emailMatch = String(u.email ?? "").toLowerCase().includes(q);
      const idMatch = String(u.id ?? "").toLowerCase().includes(q);
      return emailMatch || idMatch;
    });
  }, [users, query]);

  const selectedUser = useMemo(() => {
    if (!selectedUserId) return null;
    return users.find((u) => u.id === selectedUserId) ?? null;
  }, [users, selectedUserId]);

  const chooseUser = (user: AdminUser) => {
    setSelectedUserId(user.id);
    setEmail(user.email);
    setResult(null);
  };

  const sendSurprise = async () => {
    const safeEmail = email.trim().toLowerCase();
    const safeMessage = message.trim();

    if (!safeEmail) {
      alert("Podaj email użytkownika.");
      return;
    }

    if (!safeMessage) {
      alert("Podaj treść niespodzianki.");
      return;
    }

    try {
      setLoading(true);
      setResult(null);

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
        alert(data?.error ?? "Nie udało się wysłać niespodzianki");
        return;
      }

      alert("Niespodzianka zapisana ✅");
    } catch (e: any) {
      alert(e?.message ?? "Błąd requestu do /api/admin/send-surprise");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin — niespodzianki</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Wybierz użytkownika z listy albo wpisz email ręcznie i wyślij jednorazowy popup.
          </p>
        </div>

        <Link
          href="/admin"
          className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
        >
          Wróć do admina
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <div>
            <div className="font-semibold">Użytkownicy</div>
            <div className="text-xs text-neutral-400 mt-1">
              Kliknij użytkownika, aby uzupełnić formularz.
            </div>
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj po emailu lub ID"
            className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
          />

          <div className="max-h-[560px] overflow-auto space-y-2 pr-1">
            {usersLoading ? (
              <div className="text-sm text-neutral-400">Ładowanie użytkowników…</div>
            ) : usersError ? (
              <div className="text-sm text-red-300">{usersError}</div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-sm text-neutral-400">Brak użytkowników dla tego filtra.</div>
            ) : (
              filteredUsers.map((user) => {
                const active = selectedUserId === user.id;

                return (
                  <button
                    key={user.id}
                    onClick={() => chooseUser(user)}
                    className={[
                      "w-full text-left rounded-2xl border p-3 transition",
                      active
                        ? "border-neutral-200 bg-white text-black"
                        : "border-neutral-800 bg-neutral-950 hover:bg-neutral-800 text-white",
                    ].join(" ")}
                  >
                    <div className="text-sm font-semibold break-all">{user.email}</div>
                    <div
                      className={[
                        "mt-1 text-[11px] break-all",
                        active ? "text-neutral-700" : "text-neutral-400",
                      ].join(" ")}
                    >
                      {user.id}
                    </div>
                    <div
                      className={[
                        "mt-2 text-xs",
                        active ? "text-neutral-700" : "text-neutral-300",
                      ].join(" ")}
                    >
                      Saldo: {user.balance_vb} VB
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
          <div>
            <div className="font-semibold">Wyślij niespodziankę</div>
            <div className="text-xs text-neutral-400 mt-1">
              Zapisze jednorazowy popup do tabeli <code>user_surprises</code>.
            </div>
          </div>

          {selectedUser ? (
            <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-sm">
              <div>
                <span className="text-neutral-400">Wybrany użytkownik:</span>{" "}
                <span className="font-semibold">{selectedUser.email}</span>
              </div>
              <div className="text-xs text-neutral-500 mt-1 break-all">{selectedUser.id}</div>
            </div>
          ) : null}

          <div>
            <label className="block text-xs text-neutral-400 mb-1">Email użytkownika</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="np. kowalkowskapaulina011@gmail.com"
              className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
            />
          </div>

          <div>
            <label className="block text-xs text-neutral-400 mb-1">Treść popupu</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="np. Kocham Cię <3"
              className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={sendSurprise}
              disabled={loading}
              className="px-4 py-2 rounded-xl border border-neutral-800 bg-pink-700 hover:bg-pink-600 transition text-sm disabled:opacity-50"
            >
              {loading ? "Wysyłanie..." : "Wyślij niespodziankę"}
            </button>

            <button
              onClick={() => {
                setSelectedUserId(null);
                setEmail("");
                setMessage("Kocham Cię <3");
                setResult(null);
              }}
              className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
            >
              Wyczyść
            </button>
          </div>

          {result && (
            <pre className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-3 text-xs overflow-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </section>
      </div>
    </div>
  );
}