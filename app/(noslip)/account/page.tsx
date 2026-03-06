"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type TabKey = "overview" | "wallet" | "password";

type ProfileRow = {
  id: string;
  balance_vb: number | null;
};

const fmt0 = (n: number | null | undefined) => Number(n ?? 0).toFixed(0);

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-4 py-2 rounded-xl text-sm border transition",
        active
          ? "border-neutral-700 bg-neutral-800 text-white"
          : "border-neutral-800 bg-neutral-950 hover:bg-neutral-900 text-neutral-200",
      ].join(" ")}
      type="button"
    >
      {children}
    </button>
  );
}

export default function AccountPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("overview");

  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [balance, setBalance] = useState<number | null>(null);

  // --- Change password form state (render only on tab=password)
  const [cpLoading, setCpLoading] = useState(false);
  const [cpError, setCpError] = useState<string | null>(null);
  const [cpOk, setCpOk] = useState<string | null>(null);
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");

  const passMismatch = useMemo(() => {
    if (!newPass || !newPass2) return false;
    return newPass !== newPass2;
  }, [newPass, newPass2]);

  const canSubmitPass = useMemo(() => {
    if (cpLoading) return false;
    if (!oldPass || !newPass || !newPass2) return false;
    if (passMismatch) return false;
    // możesz zaostrzyć reguły, np. min 8
    if (newPass.length < 8) return false;
    return true;
  }, [cpLoading, oldPass, newPass, newPass2, passMismatch]);

  const load = async () => {
    setLoading(true);

    const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) {
      console.error(sessErr);
      router.replace("/login");
      return;
    }

    const u = sessionData.session?.user;
    if (!u?.id) {
      router.replace("/login");
      return;
    }

    setUserId(u.id);
    setEmail(u.email ?? "");

    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("id,balance_vb")
      .eq("id", u.id)
      .maybeSingle<ProfileRow>();

    if (!profErr) setBalance(prof?.balance_vb ?? 0);

    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitChangePassword = async () => {
    setCpError(null);
    setCpOk(null);

    if (!email) {
      setCpError("Brak emaila w sesji.");
      return;
    }
    if (!canSubmitPass) {
      setCpError("Uzupełnij poprawnie pola. Nowe hasło min. 8 znaków i musi się zgadzać w obu polach.");
      return;
    }

    try {
      setCpLoading(true);

      // 1) Weryfikacja starego hasła (reauth przez signInWithPassword)
      const { error: reauthErr } = await supabase.auth.signInWithPassword({
        email,
        password: oldPass,
      });

      if (reauthErr) {
        setCpError("Stare hasło jest nieprawidłowe.");
        return;
      }

      // 2) Ustawienie nowego hasła
      const { error: updErr } = await supabase.auth.updateUser({
        password: newPass,
      });

      if (updErr) {
        setCpError(updErr.message);
        return;
      }

      setCpOk("Hasło zostało zmienione ✅");
      setOldPass("");
      setNewPass("");
      setNewPass2("");
    } catch (e: any) {
      setCpError(e?.message ?? "Nie udało się zmienić hasła.");
    } finally {
      setCpLoading(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  if (loading) return <div className="text-neutral-400">Ładowanie...</div>;
  if (!userId) return null; // guard już zrobi redirect

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Moje konto</h1>
          <p className="text-neutral-400 mt-1 text-sm">
            Dane konta i ustawienia. Wallet jest dostępny z poziomu tej strony.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={load}
            className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
          >
            Odśwież
          </button>
          <button
            onClick={logout}
            className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
          >
            Wyloguj
          </button>
        </div>
      </div>

      {/* Header card */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs text-neutral-400">Email</div>
          <div className="text-sm text-neutral-200">{email || "—"}</div>
          <div className="text-xs text-neutral-500">User ID: {userId}</div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-4 py-3">
          <div className="text-xs text-neutral-400">Stan konta</div>
          <div className="text-xl font-semibold text-white mt-1">
            {balance == null ? "..." : `${fmt0(balance)} VB`}
          </div>
          <div className="text-[11px] text-neutral-500 mt-1">Źródło: profiles.balance_vb</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="flex flex-wrap gap-2">
          <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
            Podsumowanie
          </TabButton>
          <TabButton active={tab === "wallet"} onClick={() => setTab("wallet")}>
            Transakcje (wallet)
          </TabButton>
          <TabButton active={tab === "password"} onClick={() => setTab("password")}>
            Zmień hasło
          </TabButton>
        </div>

        <div className="mt-4">
          {tab === "overview" && (
            <div className="space-y-3">
              <div className="text-sm text-neutral-300">
                Tu możemy dorzucić później: ustawienia profilu (nick/awatar), preferencje powiadomień,
                ustawienia prywatności, export danych itp.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
                  <div className="font-semibold">Szybkie akcje</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => setTab("wallet")}
                      className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
                    >
                      Zobacz transakcje
                    </button>
                    <button
                      onClick={() => setTab("password")}
                      className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
                    >
                      Zmień hasło
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
                  <div className="font-semibold">Bezpieczeństwo</div>
                  <div className="text-sm text-neutral-400 mt-2">
                    Hasło można zmienić w zakładce „Zmień hasło”. Dla potwierdzenia wymagamy podania starego hasła.
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "wallet" && (
            <div className="space-y-3">
              <div className="text-sm text-neutral-300">
                Wallet pokazuje pełną historię VB (vb_ledger) + filtry i sumy.
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  href="/wallet"
                  className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
                >
                  Otwórz historię VB
                </Link>

                <button
                  onClick={() => router.push("/bets")}
                  className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
                >
                  Przejdź do kuponów
                </button>
              </div>

              <div className="text-xs text-neutral-500">
                (Jeśli chcesz: możemy tu w tym tabie pokazać ostatnie 10 wpisów vb_ledger bez przechodzenia na /wallet.)
              </div>
            </div>
          )}

          {tab === "password" && (
            <div className="space-y-3">
              <div className="text-sm text-neutral-300">
                Zmiana hasła wymaga podania starego hasła (weryfikacja).
              </div>

              {cpError && (
                <div className="rounded-2xl border border-red-900/50 bg-red-900/10 p-4 text-red-200 text-sm">
                  {cpError}
                </div>
              )}
              {cpOk && (
                <div className="rounded-2xl border border-green-900/50 bg-green-900/10 p-4 text-green-200 text-sm">
                  {cpOk}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1 sm:col-span-2">
                  <div className="text-xs text-neutral-400">Stare hasło</div>
                  <input
                    type="password"
                    value={oldPass}
                    onChange={(e) => setOldPass(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-neutral-800 bg-neutral-950 text-sm"
                    autoComplete="current-password"
                    placeholder="Wpisz stare hasło"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-neutral-400">Nowe hasło</div>
                  <input
                    type="password"
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-neutral-800 bg-neutral-950 text-sm"
                    autoComplete="new-password"
                    placeholder="Minimum 8 znaków"
                  />
                  <div className="text-[11px] text-neutral-500">Min. 8 znaków</div>
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-neutral-400">Potwierdź nowe hasło</div>
                  <input
                    type="password"
                    value={newPass2}
                    onChange={(e) => setNewPass2(e.target.value)}
                    className={[
                      "w-full px-3 py-2 rounded-xl border bg-neutral-950 text-sm",
                      passMismatch ? "border-red-700" : "border-neutral-800",
                    ].join(" ")}
                    autoComplete="new-password"
                    placeholder="Powtórz nowe hasło"
                  />
                  {passMismatch && (
                    <div className="text-[11px] text-red-300">Hasła nie są identyczne.</div>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={submitChangePassword}
                  disabled={!canSubmitPass}
                  className="px-4 py-2 rounded-xl border border-neutral-800 bg-green-700 hover:bg-green-600 transition text-sm disabled:opacity-50 disabled:hover:bg-green-700"
                >
                  {cpLoading ? "Zmieniam..." : "Zmień hasło"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCpError(null);
                    setCpOk(null);
                    setOldPass("");
                    setNewPass("");
                    setNewPass2("");
                  }}
                  className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
                >
                  Wyczyść
                </button>
              </div>
              <div className="text-xs text-neutral-500">
                Uwaga: po zmianie hasła sesja zwykle zostaje aktywna. Jeśli chcesz, możemy wymusić ponowne logowanie.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}