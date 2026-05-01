// app/(noslip)/register/page.tsx
"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type NoticeTone = "success" | "error" | "warning" | "info";
type RegisterStep = "email" | "profile" | "password" | "summary" | "success";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUsername(username: string) {
  const u = username.trim().toLowerCase();

  const reserved = [
    "admin",
    "administrator",
    "support",
    "moderator",
    "mod",
    "root",
    "system",
    "api",
    "owner",
    "staff",
    "virtualbook",
    "official",
    "help",
    "kontakt",
    "contact",
    "security",
    "test",
    "null",
    "undefined",
    "superuser",
  ];

  const blocked = [
    "kurwa",
    "chuj",
    "cipa",
    "pizda",
    "jebac",
    "jebać",
    "skurw",
    "suka",
    "dziwka",
    "fuck",
    "fucker",
    "bitch",
    "cunt",
    "whore",
    "niga",
    "nigger",
    "hitler",
    "nazi",
  ];

  if (!u) return false;
  if (u.length < 3 || u.length > 20) return false;
  if (!/^[a-z0-9_]+$/.test(u)) return false;
  if (u.startsWith("_") || u.endsWith("_") || u.includes("__")) return false;
  if (reserved.includes(u)) return false;
  if (blocked.some((x) => u.includes(x))) return false;

  return true;
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
          className={cn(
            "w-full rounded-2xl border bg-neutral-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-neutral-500",
            rightSlot ? "pr-20" : "",
            error
              ? "border-red-500/50 focus:border-red-400"
              : "border-neutral-800 focus:border-neutral-600"
          )}
        />

        {rightSlot ? (
          <div className="absolute inset-y-0 right-3 flex items-center">
            {rightSlot}
          </div>
        ) : null}
      </div>

      {error ? <div className="text-xs text-red-300">{error}</div> : null}

      {!error && help ? (
        <div className="text-xs leading-5 text-neutral-500">{help}</div>
      ) : null}
    </div>
  );
}

function PasswordRule({
  ok,
  children,
}: {
  ok: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2 text-[11px]",
        ok
          ? "border-green-500/30 bg-green-500/10 text-green-300"
          : "border-neutral-800 bg-neutral-950/50 text-neutral-400"
      )}
    >
      {ok ? "✓ " : "• "}
      {children}
    </div>
  );
}

function StepPill({
  active,
  done,
  label,
}: {
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <div
      className={cn(
        "rounded-full border px-3 py-1 text-[11px] font-semibold transition",
        active
          ? "border-white/30 bg-white text-black"
          : done
            ? "border-green-500/30 bg-green-500/10 text-green-300"
            : "border-neutral-800 bg-neutral-950 text-neutral-500"
      )}
    >
      {label}
    </div>
  );
}

export default function RegisterPage() {
  const [step, setStep] = useState<RegisterStep>("email");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [confirmedEmail, setConfirmedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showPassword2, setShowPassword2] = useState(false);

  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(
    null
  );

  const cleanUsername = useMemo(() => username.trim().toLowerCase(), [username]);
  const cleanEmail = useMemo(() => normalizeEmail(email), [email]);

  const usernameError =
    username.length === 0
      ? null
      : isValidUsername(cleanUsername)
        ? null
        : "Nazwa użytkownika musi mieć 3-20 znaków i może zawierać tylko małe litery, cyfry oraz _.";

  const emailError =
    email.length === 0
      ? null
      : isValidEmail(cleanEmail)
        ? null
        : "Podaj poprawny adres e-mail.";

  const passwordHasMin = password.length >= 8;
  const passwordHasUpper = /[A-Z]/.test(password);
  const passwordHasLower = /[a-z]/.test(password);
  const passwordHasDigit = /\d/.test(password);

  const passwordValid =
    passwordHasMin && passwordHasUpper && passwordHasLower && passwordHasDigit;

  const passwordMismatch = password2.length > 0 && password !== password2;

  const stepIndex =
    step === "email"
      ? 1
      : step === "profile"
        ? 2
        : step === "password"
          ? 3
          : step === "summary"
            ? 4
            : 5;

  const resetNotice = () => setNotice(null);

  const goToEmailStep = () => {
    resetNotice();
    setStep("email");
  };

  const goToProfileStep = () => {
    resetNotice();
    setStep("profile");
  };

  const goToPasswordStep = () => {
    resetNotice();
    setStep("password");
  };

  const checkEmailAndContinue = async () => {
    resetNotice();

    if (!isValidEmail(cleanEmail)) {
      setNotice({
        tone: "error",
        text: "Podaj poprawny adres e-mail.",
      });
      return;
    }

    try {
      setLoading(true);

      const emailCheckRes = await fetch(
        `/api/auth/check-email?email=${encodeURIComponent(cleanEmail)}`,
        { cache: "no-store" }
      );

      const emailCheck = await emailCheckRes.json().catch(() => null);

      if (emailCheckRes.ok && emailCheck?.exists) {
        setNotice({
          tone: "error",
          text: emailCheck.confirmed
            ? "Konto z tym adresem e-mail już istnieje."
            : "Konto z tym adresem e-mail już istnieje, ale nie zostało jeszcze potwierdzone. Możesz wrócić do logowania i wysłać link potwierdzający ponownie.",
        });
        return;
      }

      setStep("profile");
    } catch (e: unknown) {
      setNotice({
        tone: "error",
        text:
          e instanceof Error
            ? e.message
            : "Nie udało się sprawdzić adresu e-mail.",
      });
    } finally {
      setLoading(false);
    }
  };

  const checkProfileAndContinue = async () => {
    resetNotice();

    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();

    if (!cleanFirstName || !cleanLastName || !cleanUsername) {
      setNotice({
        tone: "error",
        text: "Podaj imię, nazwisko i nazwę użytkownika.",
      });
      return;
    }

    if (!isValidUsername(cleanUsername)) {
      setNotice({
        tone: "error",
        text:
          "Nazwa użytkownika jest nieprawidłowa. Użyj 3-20 znaków: małe litery, cyfry i _. Bez wulgaryzmów i nazw zastrzeżonych.",
      });
      return;
    }

    try {
      setLoading(true);

      const checkRes = await fetch(
        `/api/username/check?username=${encodeURIComponent(cleanUsername)}`,
        { cache: "no-store" }
      );

      const checkData = await checkRes.json().catch(() => null);

      if (checkData?.exists) {
        setNotice({
          tone: "error",
          text: "Ta nazwa użytkownika jest już zajęta.",
        });
        return;
      }

      setStep("password");
    } catch (e: unknown) {
      setNotice({
        tone: "error",
        text:
          e instanceof Error
            ? e.message
            : "Nie udało się sprawdzić nazwy użytkownika.",
      });
    } finally {
      setLoading(false);
    }
  };

  const checkPasswordAndContinue = () => {
    resetNotice();

    if (!passwordValid) {
      setNotice({
        tone: "error",
        text:
          "Hasło nie spełnia wymagań. Musi mieć minimum 8 znaków, jedną dużą literę, jedną małą literę i jedną cyfrę.",
      });
      return;
    }

    if (password !== password2) {
      setNotice({
        tone: "error",
        text: "Hasła nie są identyczne.",
      });
      return;
    }

    setStep("summary");
  };

  const createAccount = async () => {
    resetNotice();

    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();
    const cleanPassword = password.trim();

    if (
      !cleanFirstName ||
      !cleanLastName ||
      !cleanUsername ||
      !cleanEmail ||
      !cleanPassword ||
      !password2
    ) {
      setNotice({
        tone: "error",
        text: "Brakuje wymaganych danych rejestracyjnych.",
      });
      return;
    }

    if (!isValidEmail(cleanEmail)) {
      setNotice({
        tone: "error",
        text: "Adres e-mail jest nieprawidłowy.",
      });
      setStep("email");
      return;
    }

    if (!isValidUsername(cleanUsername)) {
      setNotice({
        tone: "error",
        text: "Nazwa użytkownika jest nieprawidłowa.",
      });
      setStep("profile");
      return;
    }

    if (!passwordValid || password !== password2) {
      setNotice({
        tone: "error",
        text: "Hasło jest nieprawidłowe albo hasła nie są identyczne.",
      });
      setStep("password");
      return;
    }

    try {
      setLoading(true);

      const { error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: cleanPassword,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            first_name: cleanFirstName,
            last_name: cleanLastName,
            username: cleanUsername,
          },
        },
      });

      if (error) {
        const msg = String(error.message || "").toLowerCase();

        if (msg.includes("user already registered")) {
          setNotice({
            tone: "error",
            text: "Konto z tym adresem e-mail już istnieje.",
          });
          setStep("email");
        } else {
          setNotice({
            tone: "error",
            text: error.message,
          });
        }

        return;
      }

      setConfirmedEmail(cleanEmail);
      setStep("success");
    } catch (e: unknown) {
      setNotice({
        tone: "error",
        text:
          e instanceof Error
            ? e.message
            : "Wystąpił błąd podczas rejestracji.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFormSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (step === "email") {
      await checkEmailAndContinue();
      return;
    }

    if (step === "profile") {
      await checkProfileAndContinue();
      return;
    }

    if (step === "password") {
      checkPasswordAndContinue();
      return;
    }

    if (step === "summary") {
      await createAccount();
    }
  };

  const renderEmailStep = () => {
    return (
      <>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-500">
            Krok 1 z 4
          </div>

          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Nie masz konta?
          </h1>

          <p className="mt-3 text-sm leading-6 text-neutral-400">
            Podaj swój adres e-mail. Sprawdzimy, czy możesz użyć go do utworzenia
            konta.
          </p>
        </div>

        <InputField
          label="E-mail"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="twoj@email.com"
          autoComplete="email"
          error={emailError}
          help="Na ten adres wyślemy link potwierdzający konto."
        />

        <button
          type="submit"
          disabled={loading || !isValidEmail(cleanEmail)}
          className="w-full rounded-2xl bg-white py-3 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          {loading ? "Sprawdzanie..." : "Dalej"}
        </button>
      </>
    );
  };

  const renderProfileStep = () => {
    return (
      <>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-500">
            Krok 2 z 4
          </div>

          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Uzupełnij dane
          </h1>

          <p className="mt-3 text-sm leading-6 text-neutral-400">
            Teraz podaj imię, nazwisko i nazwę użytkownika widoczną w aplikacji.
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 text-sm text-neutral-400">
          Rejestrujesz konto na adres:{" "}
          <span className="font-semibold text-white">{cleanEmail}</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <InputField
            label="Imię"
            type="text"
            value={firstName}
            onChange={setFirstName}
            placeholder="Np. Jan"
            autoComplete="given-name"
          />

          <InputField
            label="Nazwisko"
            type="text"
            value={lastName}
            onChange={setLastName}
            placeholder="Np. Kowalski"
            autoComplete="family-name"
          />
        </div>

        <InputField
          label="Nazwa użytkownika"
          type="text"
          value={username}
          onChange={(value) => setUsername(value.toLowerCase())}
          placeholder="np. typer_99"
          autoComplete="username"
          error={usernameError}
          help="Dozwolone: małe litery, cyfry i _. Bez spacji."
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={goToEmailStep}
            disabled={loading}
            className="rounded-2xl border border-neutral-800 bg-neutral-950 py-3 text-sm font-semibold text-neutral-300 transition hover:bg-neutral-900 disabled:opacity-60"
          >
            Wstecz
          </button>

          <button
            type="submit"
            disabled={
              loading ||
              !firstName.trim() ||
              !lastName.trim() ||
              !cleanUsername ||
              Boolean(usernameError)
            }
            className="rounded-2xl bg-white py-3 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            {loading ? "Sprawdzanie..." : "Dalej"}
          </button>
        </div>
      </>
    );
  };

  const renderPasswordStep = () => {
    return (
      <>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-500">
            Krok 3 z 4
          </div>

          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Ustaw hasło
          </h1>

          <p className="mt-3 text-sm leading-6 text-neutral-400">
            Hasło zabezpiecza dostęp do Twojego konta. Użyj minimum 8 znaków.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <InputField
            label="Hasło"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={setPassword}
            placeholder="Ustaw hasło"
            autoComplete="new-password"
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

          <InputField
            label="Potwierdź hasło"
            type={showPassword2 ? "text" : "password"}
            value={password2}
            onChange={setPassword2}
            placeholder="Powtórz hasło"
            autoComplete="new-password"
            rightSlot={
              <button
                type="button"
                onClick={() => setShowPassword2((v) => !v)}
                className="rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 transition hover:bg-neutral-800"
              >
                {showPassword2 ? "Ukryj" : "Pokaż"}
              </button>
            }
            error={passwordMismatch ? "Hasła nie są identyczne." : null}
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <PasswordRule ok={passwordHasMin}>Minimum 8 znaków</PasswordRule>
          <PasswordRule ok={passwordHasUpper}>Jedna duża litera</PasswordRule>
          <PasswordRule ok={passwordHasLower}>Jedna mała litera</PasswordRule>
          <PasswordRule ok={passwordHasDigit}>Jedna cyfra</PasswordRule>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={goToProfileStep}
            className="rounded-2xl border border-neutral-800 bg-neutral-950 py-3 text-sm font-semibold text-neutral-300 transition hover:bg-neutral-900"
          >
            Wstecz
          </button>

          <button
            type="submit"
            disabled={!passwordValid || passwordMismatch || !password2}
            className="rounded-2xl bg-white py-3 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            Dalej
          </button>
        </div>
      </>
    );
  };

  const renderSummaryStep = () => {
    return (
      <>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-500">
            Krok 4 z 4
          </div>

          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Sprawdź dane
          </h1>

          <p className="mt-3 text-sm leading-6 text-neutral-400">
            Jeżeli wszystko się zgadza, utworzymy konto i wyślemy link
            potwierdzający na podany adres e-mail.
          </p>
        </div>

        <div className="space-y-3 rounded-3xl border border-neutral-800 bg-neutral-950/70 p-5">
          <div className="flex items-center justify-between gap-4 border-b border-neutral-800 pb-3">
            <span className="text-sm text-neutral-500">E-mail</span>
            <span className="text-right text-sm font-semibold text-white">
              {cleanEmail}
            </span>
          </div>

          <div className="flex items-center justify-between gap-4 border-b border-neutral-800 pb-3">
            <span className="text-sm text-neutral-500">Imię i nazwisko</span>
            <span className="text-right text-sm font-semibold text-white">
              {firstName.trim()} {lastName.trim()}
            </span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-neutral-500">Nazwa użytkownika</span>
            <span className="text-right text-sm font-semibold text-white">
              @{cleanUsername}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-yellow-500/25 bg-yellow-500/10 p-4 text-sm leading-6 text-yellow-100">
          Po kliknięciu „Utwórz konto” wyślemy wiadomość na adres{" "}
          <span className="font-semibold text-white">{cleanEmail}</span>. Konto
          będzie wymagało potwierdzenia przez link w tej wiadomości.
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={goToPasswordStep}
            disabled={loading}
            className="rounded-2xl border border-neutral-800 bg-neutral-950 py-3 text-sm font-semibold text-neutral-300 transition hover:bg-neutral-900 disabled:opacity-60"
          >
            Wstecz
          </button>

          <button
            type="submit"
            disabled={loading}
            className="rounded-2xl bg-white py-3 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            {loading ? "Tworzenie konta..." : "Utwórz konto"}
          </button>
        </div>
      </>
    );
  };

  const renderSuccessStep = () => {
    const emailToShow = confirmedEmail || cleanEmail;

    return (
      <>
        <div className="rounded-full border border-green-500/30 bg-green-500/10 px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-green-300">
          Konto utworzone
        </div>

        <div className="text-center">
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">
            Potwierdź swój adres e-mail
          </h1>

          <p className="mt-4 text-sm leading-7 text-neutral-400">
            Wysłaliśmy wiadomość aktywacyjną na adres:
          </p>

          <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm font-semibold text-white">
            {emailToShow}
          </div>

          <p className="mt-4 text-sm leading-7 text-neutral-400">
            Otwórz swoją skrzynkę pocztową i kliknij link potwierdzający. Dopiero
            po potwierdzeniu adresu e-mail konto będzie gotowe do logowania.
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 text-sm leading-6 text-neutral-400">
          Nie widzisz wiadomości? Sprawdź folder spam, oferty lub powiadomienia.
        </div>

        <Link
          href={`/login?registered=1&email=${encodeURIComponent(emailToShow)}`}
          className="block w-full rounded-2xl bg-white py-3 text-center text-sm font-semibold text-black transition hover:bg-neutral-200"
        >
          Przejdź do logowania
        </Link>
      </>
    );
  };

  return (
    <div className="mx-auto flex min-h-[calc(100svh-112px)] max-w-3xl -translate-y-6 items-center justify-center px-4 py-6">
      <section className="w-full overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950/80 shadow-[0_18px_80px_rgba(0,0,0,0.35)]">
        <div className="border-b border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.10),transparent_36%),linear-gradient(135deg,rgba(23,23,23,0.95),rgba(5,5,5,0.98))] p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <StepPill active={step === "email"} done={stepIndex > 1} label="E-mail" />
            <StepPill
              active={step === "profile"}
              done={stepIndex > 2}
              label="Dane"
            />
            <StepPill
              active={step === "password"}
              done={stepIndex > 3}
              label="Hasło"
            />
            <StepPill
              active={step === "summary"}
              done={stepIndex > 4}
              label="Koniec"
            />
          </div>
        </div>

        {notice ? (
          <div
            className={cn(
              "border-b p-5 text-sm leading-6 sm:p-6",
              noticeClasses(notice.tone)
            )}
          >
            {notice.text}
          </div>
        ) : null}

        <form onSubmit={handleFormSubmit} className="space-y-5 p-5 sm:p-6">
          {step === "email" ? renderEmailStep() : null}
          {step === "profile" ? renderProfileStep() : null}
          {step === "password" ? renderPasswordStep() : null}
          {step === "summary" ? renderSummaryStep() : null}
          {step === "success" ? renderSuccessStep() : null}

          {step !== "success" ? (
            <div className="pt-2 text-sm text-neutral-400">
              Masz już konto?{" "}
              <Link
                href="/login"
                className="font-medium text-white underline underline-offset-2"
              >
                Zaloguj się
              </Link>
            </div>
          ) : null}
        </form>
      </section>
    </div>
  );
}