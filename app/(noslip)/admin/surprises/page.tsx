// app/(noslip)/admin/surprises/page.tsx
"use client";

import Link from "next/link";
import { useState } from "react";

export default function AdminSurprisesPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("Kocham Cię <3");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

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

      const res = await fetch("/api/admin/send-surprise", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
    } catch (e) {
      alert("Błąd requestu do /api/admin/send-surprise");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Admin — niespodzianki</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Wyślij jednorazowy popup dla użytkownika po emailu.
          </p>
        </div>

        <Link
          href="/admin"
          className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
        >
          Wróć do admina
        </Link>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
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
            rows={4}
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
      </div>
    </div>
  );
}