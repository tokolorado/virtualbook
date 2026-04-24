"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type PageStatus = "checking" | "ready" | "success" | "error";

export default function ResetPasswordPage() {
  const router = useRouter();

  const [status, setStatus] = useState<PageStatus>("checking");
  const [error, setError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [saving, setSaving] = useState(false);

  const passwordTooShort = useMemo(() => {
    if (!password) return false;
    return password.length < 8;
  }, [password]);

  const passwordMismatch = useMemo(() => {
    if (!password || !password2) return false;
    return password !== password2;
  }, [password, password2]);

  const canSubmit = useMemo(() => {
    if (status !== "ready") return false;
    if (saving) return false;
    if (!password || !password2) return false;
    if (passwordTooShort || passwordMismatch) return false;
    return true;
  }, [status, saving, password, password2, passwordTooShort, passwordMismatch]);

  useEffect(() => {
    let alive = true;
    let subscription: { unsubscribe: () => void } | null = null;

    const init = async () => {
      try {
        const url = new URL(window.location.href);
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type");

        if (tokenHash && type === "recovery") {
          const { error: verifyErr } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "recovery",
          });

          if (!alive) return;

          if (verifyErr) {
            setError(
              "Link resetowania hasła jest nieważny albo wygasł. Wygeneruj nowy link resetujący."
            );
            setStatus("error");
            return;
          }

          window.history.replaceState({}, document.title, "/reset-password");
          setError(null);
          setStatus("ready");
          return;
        }

        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const hashType = hash.get("type");

        const { data } = supabase.auth.onAuthStateChange((event) => {
          if (event === "PASSWORD_RECOVERY") {
            window.history.replaceState({}, document.title, "/reset-password");
            setError(null);
            setStatus("ready");
          }
        });

        subscription = data.subscription;

        if (hashType === "recovery") {
          window.setTimeout(async () => {
            if (!alive) return;

            const { data: sessionData } = await supabase.auth.getSession();

            if (!alive) return;

            if (sessionData.session) {
              window.history.replaceState({}, document.title, "/reset-password");
              setError(null);
              setStatus("ready");
            } else {
              setError(
                "Nie udało się odczytać sesji resetowania hasła. Wygeneruj nowy link resetujący."
              );
              setStatus("error");
            }
          }, 400);

          return;
        }

        setError("Otwórz tę stronę z linku resetowania hasła.");
        setStatus("error");
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Nie udało się przygotować resetowania hasła.");
        setStatus("error");
      }
    };

    init();

    return () => {
      alive = false;
      subscription?.unsubscribe();
    };
  }, []);

  const submit = async () => {
    setError(null);

    if (!canSubmit) {
      setError("Nowe hasło musi mieć minimum 8 znaków i musi zgadzać się w obu polach.");
      return;
    }

    try {
      setSaving(true);

      const { error: updateErr } = await supabase.auth.updateUser({
        password,
      });

      if (updateErr) {
        setError(updateErr.message);
        return;
      }

      setStatus("success");
      setPassword("");
      setPassword2("");

      window.setTimeout(async () => {
        await supabase.auth.signOut();
        router.replace("/login");
      }, 1200);
    } catch (e: any) {
      setError(e?.message ?? "Nie udało się ustawić nowego hasła.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[75vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-900/40 p-6 shadow-2xl">
        <div className="inline-flex items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-300">
          VirtualBook
        </div>

        <h1 className="mt-4 text-2xl font-semibold text-white">
          Ustaw nowe hasło
        </h1>

        <p className="mt-2 text-sm text-neutral-400">
          Ten formularz służy wyłącznie do resetowania hasła po kliknięciu linku z emaila.
        </p>

        {status === "checking" ? (
          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950/50 p-4 text-sm text-neutral-300">
            Sprawdzam link resetowania hasła...
          </div>
        ) : null}

        {status === "error" ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-red-900/50 bg-red-900/10 p-4 text-sm text-red-200">
              {error ?? "Nie udało się otworzyć resetowania hasła."}
            </div>

            <button
              type="button"
              onClick={() => router.replace("/login")}
              className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-200 transition hover:bg-neutral-900"
            >
              Wróć do logowania
            </button>
          </div>
        ) : null}

        {status === "success" ? (
          <div className="mt-6 rounded-2xl border border-green-900/50 bg-green-900/10 p-4 text-sm text-green-200">
            Hasło zostało ustawione. Za chwilę przekierujemy Cię do logowania.
          </div>
        ) : null}

        {status === "ready" ? (
          <div className="mt-6 space-y-4">
            {error ? (
              <div className="rounded-2xl border border-red-900/50 bg-red-900/10 p-4 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            <div className="space-y-1">
              <div className="text-xs text-neutral-400">Nowe hasło</div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={[
                  "w-full rounded-xl border bg-neutral-950 px-3 py-3 text-sm text-white",
                  passwordTooShort ? "border-red-700" : "border-neutral-800",
                ].join(" ")}
                autoComplete="new-password"
                placeholder="Minimum 8 znaków"
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs text-neutral-400">Powtórz nowe hasło</div>
              <input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                className={[
                  "w-full rounded-xl border bg-neutral-950 px-3 py-3 text-sm text-white",
                  passwordMismatch ? "border-red-700" : "border-neutral-800",
                ].join(" ")}
                autoComplete="new-password"
                placeholder="Powtórz nowe hasło"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div
                className={[
                  "rounded-xl border px-3 py-2",
                  !passwordTooShort && !!password
                    ? "border-green-500/30 bg-green-500/10 text-green-300"
                    : "border-neutral-800 bg-neutral-950/50 text-neutral-400",
                ].join(" ")}
              >
                Minimum 8 znaków
              </div>

              <div
                className={[
                  "rounded-xl border px-3 py-2",
                  !passwordMismatch && !!password && !!password2
                    ? "border-green-500/30 bg-green-500/10 text-green-300"
                    : "border-neutral-800 bg-neutral-950/50 text-neutral-400",
                ].join(" ")}
              >
                Hasła zgodne
              </div>
            </div>

            {passwordTooShort ? (
              <div className="text-xs text-red-300">
                Nowe hasło musi mieć co najmniej 8 znaków.
              </div>
            ) : null}

            {passwordMismatch ? (
              <div className="text-xs text-red-300">
                Hasła nie są identyczne.
              </div>
            ) : null}

            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="w-full rounded-xl border border-neutral-800 bg-green-700 px-4 py-3 text-sm text-white transition hover:bg-green-600 disabled:opacity-50 disabled:hover:bg-green-700"
            >
              {saving ? "Ustawiam..." : "Ustaw nowe hasło"}
            </button>

            <div className="text-xs text-neutral-500">
              Po ustawieniu nowego hasła wylogujemy sesję resetowania i przekierujemy do logowania.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}