"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type NoticeTone = "success" | "error" | "warning" | "info";
type AuthView = "login" | "forgot-password";

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

function messageFromUnknown(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return fallback;
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
  rightSlot?: ReactNode;
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
          <div className="absolute inset-y-0 right-3 flex items-center">
            {rightSlot}
          </div>
        ) : null}
      </div>

      {error ? <div className="text-xs text-red-300">{error}</div> : null}
      {!error && help ? (
        <div className="text-xs text-neutral-500">{help}</div>
      ) : null}
    </div>
  );
}

export default function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [view, setView] = useState<AuthView>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const [notice, setNotice] = useState<{
    tone: NoticeTone;
    text: string;
  } | null>(null);

  const [fieldError, setFieldError] = useState<string | null>(null);
  const [canResend, setCanResend] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  const cleanEmail = useMemo(() => normalizeEmail(email), [email]);
  const cleanForgotEmail = useMemo(
    () => normalizeEmail(forgotEmail),
    [forgotEmail]
  );

  const emailError =
    email.length === 0
      ? null
      : isValidEmail(cleanEmail)
        ? null
        : "Podaj poprawny adres e-mail.";

  const forgotEmailError =
    forgotEmail.length === 0
      ? null
      : isValidEmail(cleanForgotEmail)
        ? null
        : "Podaj poprawny adres e-mail.";

  useEffect(() => {
    const emailFromQuery = searchParams.get("email");
    const registered = searchParams.get("registered") === "1";
    const confirmed = searchParams.get("confirmed") === "1";
    const type = searchParams.get("type");

    if (emailFromQuery) {
      setEmail(emailFromQuery);
      setForgotEmail(emailFromQuery);
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

    void loadSession();

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
    } catch (e: unknown) {
      setFieldError(
        messageFromUnknown(e, "Nie udało się wysłać linku ponownie.")
      );
    } finally {
      setResending(false);
    }
  };

  const handleSignIn = async (e?: FormEvent) => {
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
          setFieldError("Musisz potwierdzić adres e-mail, aby się zalogować.");
          setCanResend(true);
        } else if (msg.includes("invalid login credentials")) {
          setFieldError("Niepoprawne hasło.");
        } else {
          setFieldError("Nie udało się zalogować. Spróbuj ponownie.");
        }

        return;
      }

      router.replace("/events");
    } catch (err: unknown) {
      setFieldError(messageFromUnknown(err, "Wystąpił błąd podczas logowania."));
    } finally {
      setLoading(false);
    }
  };

  const openForgotPassword = () => {
    setView("forgot-password");
    setForgotSent(false);
    setForgotError(null);
    setFieldError(null);
    setCanResend(false);
    setForgotEmail(cleanEmail || "");
  };

  const backToLogin = () => {
    setView("login");
    setForgotError(null);
    setForgotSent(false);
  };

  const handleForgotPassword = async (e?: FormEvent) => {
    e?.preventDefault();

    setForgotError(null);
    setForgotSent(false);

    if (!cleanForgotEmail || !isValidEmail(cleanForgotEmail)) {
      setForgotError("Wpisz poprawny adres e-mail.");
      return;
    }

    try {
      setForgotLoading(true);

      const checkRes = await fetch(
        `/api/auth/check-email?email=${encodeURIComponent(cleanForgotEmail)}`,
        { cache: "no-store" }
      );

      let checkData: AccountCheckResponse | null = null;

      try {
        checkData = await checkRes.json();
      } catch {
        checkData = null;
      }

      if (!checkRes.ok || !checkData) {
        setForgotError(
          "Nie udało się teraz wysłać linku resetującego. Spróbuj ponownie za chwilę."
        );
        return;
      }

      if (checkData.exists) {
        const { error } = await supabase.auth.resetPasswordForEmail(
          cleanForgotEmail,
          {
            redirectTo: `${window.location.origin}/reset-password`,
          }
        );

        if (error) {
          console.error("[forgot-password] resetPasswordForEmail error:", error);

          const msg = String(error.message || "").toLowerCase();

          if (
            msg.includes("rate") ||
            msg.includes("too many") ||
            msg.includes("security purposes")
          ) {
            setForgotError(
              "Link resetujący był wysyłany zbyt często. Odczekaj chwilę i spróbuj ponownie."
            );
            return;
          }

          setForgotError(
            "Nie udało się teraz wysłać linku resetującego. Spróbuj ponownie za chwilę."
          );
          return;
        }
      }

      setForgotSent(true);
    } catch (e: unknown) {
      setForgotError(
        messageFromUnknown(e, "Nie udało się wysłać linku resetującego.")
      );
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="vb-login-page mx-auto flex w-full max-w-2xl items-center px-4 py-4">
      <div className="w-full overflow-hidden rounded-[2rem] border border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.14),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.96),rgba(5,5,5,0.99))] shadow-[0_24px_90px_rgba(0,0,0,0.45)]">
        <div className="border-b border-neutral-800/80 p-4 sm:p-6">
          <div className="inline-flex w-fit items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-sky-300">
            VirtualBook
          </div>

          <div className="mt-4 rounded-3xl border border-sky-400/25 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.24),transparent_34%),linear-gradient(135deg,rgba(14,165,233,0.13),rgba(10,10,10,0.94))] px-4 py-4 shadow-[0_18px_80px_rgba(14,165,233,0.12)]">
            <h1 className="text-[clamp(1.65rem,7vw,3.2rem)] font-black uppercase leading-[0.95] tracking-tight text-white">
              {view === "forgot-password"
                ? "ODZYSKAJ DOSTĘP"
                : "WRÓĆ DO GRY ZE ZNAJOMYMI!"}
            </h1>

            <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-200 sm:text-xs">
              {view === "forgot-password"
                ? "Ustaw nowe hasło i wróć do gry"
                : "VB balance, kupony i rywalizacja czekają"}
            </div>
          </div>
        </div>

        <section className="p-4 sm:p-6">
          <div className="mx-auto w-full max-w-md">
            {view === "login" ? (
              <>
                <div className="mb-4 text-center">
                  <h2 className="text-2xl font-semibold tracking-tight text-white">
                    Zaloguj się
                  </h2>
                  <p className="mt-1 text-sm text-neutral-400">
                    Wpisz e-mail i hasło, aby wejść do aplikacji.
                  </p>
                </div>

                {notice ? (
                  <div
                    className={[
                      "mb-4 rounded-2xl border p-3 text-sm sm:p-4",
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

                    <div className="-mt-1 flex justify-end">
                      <button
                        type="button"
                        onClick={openForgotPassword}
                        className="text-sm text-neutral-300 underline underline-offset-2 transition hover:text-white"
                      >
                        Nie pamiętasz hasła?
                      </button>
                    </div>

                    {fieldError ? (
                      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200 sm:p-4">
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
                        {resending
                          ? "Wysyłam link..."
                          : "Wyślij link potwierdzający ponownie"}
                      </button>
                    ) : null}

                    <div className="pt-1 text-center text-sm text-neutral-400">
                      Nie masz konta?{" "}
                      <Link
                        href="/register"
                        className="font-medium text-white underline underline-offset-2"
                      >
                        Zarejestruj się
                      </Link>
                    </div>
                  </form>
                )}
              </>
            ) : (
              <>
                <div className="mb-4 text-center">
                  <h2 className="text-2xl font-semibold tracking-tight text-white">
                    Nie pamiętasz hasła?
                  </h2>
                  <p className="mt-1 text-sm text-neutral-400">
                    Wpisz e-mail konta. Wyślemy link do ustawienia nowego hasła.
                  </p>
                </div>

                {forgotSent ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-200">
                      Jeśli konto z tym adresem istnieje, wysłaliśmy link
                      resetujący hasło. Sprawdź skrzynkę odbiorczą oraz folder
                      spam.
                    </div>

                    <button
                      type="button"
                      onClick={backToLogin}
                      className="w-full rounded-2xl bg-white py-3 text-sm font-semibold text-black transition hover:opacity-95"
                    >
                      Wróć do logowania
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setForgotSent(false);
                        setForgotError(null);
                      }}
                      className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 py-3 text-sm font-medium text-neutral-200 transition hover:bg-neutral-900"
                    >
                      Wyślij ponownie
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleForgotPassword} className="space-y-4">
                    <InputField
                      label="E-mail"
                      type="email"
                      value={forgotEmail}
                      onChange={setForgotEmail}
                      placeholder="twoj@email.com"
                      autoComplete="email"
                      error={forgotEmailError}
                      help="Użyj adresu e-mail przypisanego do konta VirtualBook."
                    />

                    {forgotError ? (
                      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200 sm:p-4">
                        {forgotError}
                      </div>
                    ) : null}

                    <button
                      type="submit"
                      disabled={forgotLoading}
                      className="w-full rounded-2xl bg-white py-3 text-sm font-semibold text-black transition hover:opacity-95 disabled:opacity-60"
                    >
                      {forgotLoading
                        ? "Wysyłam link..."
                        : "Wyślij link resetujący"}
                    </button>

                    <button
                      type="button"
                      onClick={backToLogin}
                      className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 py-3 text-sm font-medium text-neutral-200 transition hover:bg-neutral-900"
                    >
                      Wróć do logowania
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      <style jsx>{`
        .vb-login-page {
          min-height: calc(100svh - 60px);
        }

        @media (min-width: 640px) {
          .vb-login-page {
            min-height: calc(100svh - 68px);
          }
        }
      `}</style>
    </div>
  );
}