"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type NoticeTone = "success" | "error" | "warning" | "info";

type AccountCheckResponse = {
  exists: boolean;
  confirmed: boolean;
  email?: string | null;
  error?: string;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function noticeClasses(tone: NoticeTone) {
  if (tone === "success") {
    return "border-green-500/30 bg-green-500/10 text-green-200";
  }
  if (tone === "error") {
    return "border-red-500/30 bg-red-500/10 text-red-200";
  }
  if (tone === "warning") {
    return "border-yellow-500/30 bg-yellow-500/10 text-yellow-200";
  }
  return "border-sky-500/30 bg-sky-500/10 text-sky-200";
}

function InputField({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  rightSlot,
  help,
  error,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete?: string;
  rightSlot?: React.ReactNode;
  help?: string;
  error?: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-neutral-200">{label}</label>

      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          className={[
            "w-full rounded-2xl border bg-neutral-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-neutral-500",
            rightSlot ? "pr-20" : "",
            error
              ? "border-red-500/50 focus:border-red-400"
              : "border-neutral-800 focus:border-neutral-600",
          ].join(" ")}
        />

        {rightSlot ? (
          <div className="absolute inset-y-0 right-3 flex items-center">{rightSlot}</div>
        ) : null}
      </div>

      {error ? <div className="text-xs text-red-300">{error}</div> : null}
      {!error && help ? <div className="text-xs text-neutral-500">{help}</div> : null}
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [canResend, setCanResend] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  const cleanEmail = useMemo(() => normalizeEmail(email), [email]);
  const emailError =
    email.length === 0 ? null : isValidEmail(cleanEmail) ? null : "Podaj poprawny adres e-mail.";

  useEffect(() => {
    const emailFromQuery = searchParams.get("email");
    const registered = searchParams.get("registered") === "1";
    const confirmed = searchParams.get("confirmed") === "1";
    const type = searchParams.get("type");

    if (emailFromQuery) {
      setEmail(emailFromQuery);
    }

    let hashType = "";
    if (typeof window !== "undefined") {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const hashParams = new URLSearchParams(hash);
      hashType = hashParams.get("type") || "";
    }

    if (confirmed || type === "signup" || hashType === "signup") {
      setNotice({
        tone: "success",
        text: "E-mail poprawnie potwierdzony. Możesz się teraz zalogować.",
      });
      return;
    }

    if (registered) {
      setNotice({
        tone: "success",
        text:
          "Wiadomość z potwierdzeniem została wysłana na Twój adres e-mail. Potwierdź konto, klikając link w wiadomości.",
      });
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        const loggedIn = !!data.session;
        setHasSession(loggedIn);

        const registered = searchParams.get("registered") === "1";
        const confirmed = searchParams.get("confirmed") === "1";

        if (loggedIn && !registered && !confirmed) {
          router.replace("/events");
        }
      }
    };

    loadSession();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  const handleResendConfirmation = async () => {
    setFieldError(null);

    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      setFieldError("Wpisz poprawny adres e-mail, aby wysłać link ponownie.");
      return;
    }

    try {
      setResending(true);

      const { error } = await supabase.auth.resend({
        type: "signup",
        email: cleanEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/login?confirmed=1`,
        },
      });

      if (error) {
        setFieldError(error.message);
        return;
      }

      setNotice({
        tone: "success",
        text: "Wysłaliśmy nowy link potwierdzający na Twój adres e-mail.",
      });
    } catch (e: any) {
      setFieldError(e?.message || "Nie udało się wysłać linku ponownie.");
    } finally {
      setResending(false);
    }
  };

  const handleSignIn = async (e?: React.FormEvent) => {
    e?.preventDefault();

    setFieldError(null);
    setCanResend(false);

    if (!cleanEmail || !password) {
      setFieldError("Uzupełnij adres e-mail i hasło.");
      return;
    }

    if (!isValidEmail(cleanEmail)) {
      setFieldError("Podaj poprawny adres e-mail.");
      return;
    }

    try {
      setLoading(true);

      const checkRes = await fetch(
        `/api/auth/check-email?email=${encodeURIComponent(cleanEmail)}`,
        { cache: "no-store" }
      );

      let checkData: AccountCheckResponse | null = null;
      try {
        checkData = await checkRes.json();
      } catch {
        checkData = null;
      }

      if (checkRes.ok && checkData) {
        if (!checkData.exists) {
          setFieldError("Nie znaleziono konta w bazie.");
          return;
        }

        if (!checkData.confirmed) {
          setFieldError(
            "Konto istnieje, ale adres e-mail nie został jeszcze potwierdzony."
          );
          setCanResend(true);
          return;
        }
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        const msg = String(error.message || "").toLowerCase();

        if (msg.includes("email not confirmed")) {
          setFieldError(
            "Musisz potwierdzić adres e-mail, aby się zalogować."
          );
          setCanResend(true);
        } else if (msg.includes("invalid login credentials")) {
          setFieldError("Niepoprawne hasło.");
        } else {
          setFieldError("Nie udało się zalogować. Spróbuj ponownie.");
        }
        return;
      }

      router.replace("/events");
    } catch (err: any) {
      setFieldError(err?.message || "Wystąpił błąd podczas logowania.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-5xl px-4 pb-10">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-3xl border border-neutral-800 bg-gradient-to-br from-neutral-900 via-neutral-900 to-sky-950/20 p-6">
          <div className="inline-flex items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-300">
            Logowanie
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
            Wróć do gry w VirtualBook
          </h1>

          <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-400">
            Zaloguj się, aby przejść do wydarzeń, obstawiać kupony, śledzić saldo VB
            oraz sprawdzać historię swoich zakładów.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4">
              <div className="text-xs text-neutral-400">Po zalogowaniu</div>
              <div className="mt-2 text-sm font-medium text-white">Kupony i wallet</div>
              <div className="mt-1 text-sm text-neutral-500">
                Dostęp do salda, historii VB, kuponów i konta.
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4">
              <div className="text-xs text-neutral-400">Bezpieczeństwo</div>
              <div className="mt-2 text-sm font-medium text-white">Potwierdzony e-mail</div>
              <div className="mt-1 text-sm text-neutral-500">
                Jeśli konto nie jest potwierdzone, pokażemy jasny komunikat i opcję
                ponownego wysłania linku.
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4 text-sm text-neutral-400">
            Nie masz jeszcze konta?{" "}
            <Link href="/register" className="font-medium text-white underline underline-offset-2">
              Zarejestruj się
            </Link>
          </div>
        </section>

        <section className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-white">Zaloguj się</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Wpisz e-mail i hasło, aby wejść do aplikacji.
            </p>
          </div>

          {notice ? (
            <div
              className={[
                "mb-4 rounded-2xl border p-4 text-sm",
                noticeClasses(notice.tone),
              ].join(" ")}
            >
              {notice.text}
            </div>
          ) : null}

          {hasSession ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-200">
                Jesteś już zalogowany. Możesz przejść od razu do wydarzeń.
              </div>

              <button
                type="button"
                onClick={() => router.replace("/events")}
                className="w-full rounded-2xl bg-white py-3 text-sm font-semibold text-black transition hover:opacity-95"
              >
                Przejdź do wydarzeń
              </button>
            </div>
          ) : (
            <form onSubmit={handleSignIn} className="space-y-4">
              <InputField
                label="E-mail"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="twoj@email.com"
                autoComplete="email"
                error={emailError}
              />

              <InputField
                label="Hasło"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={setPassword}
                placeholder="Wpisz hasło"
                autoComplete="current-password"
                rightSlot={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 transition hover:bg-neutral-800"
                  >
                    {showPassword ? "Ukryj" : "Pokaż"}
                  </button>
                }
              />

              {fieldError ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
                  {fieldError}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-white py-3 text-sm font-semibold text-black transition hover:opacity-95 disabled:opacity-60"
              >
                {loading ? "Logowanie..." : "Zaloguj"}
              </button>

              {canResend ? (
                <button
                  type="button"
                  onClick={handleResendConfirmation}
                  disabled={resending}
                  className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 py-3 text-sm font-medium text-neutral-200 transition hover:bg-neutral-900 disabled:opacity-60"
                >
                  {resending ? "Wysyłam link..." : "Wyślij link potwierdzający ponownie"}
                </button>
              ) : null}

              <div className="pt-2 text-sm text-neutral-400">
                Nie masz konta?{" "}
                <Link href="/register" className="text-white underline underline-offset-2">
                  Zarejestruj się
                </Link>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}