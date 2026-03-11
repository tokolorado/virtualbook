"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type NoticeTone = "success" | "error" | "warning" | "info";

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

function PasswordRule({
  ok,
  children,
}: {
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={[
        "rounded-xl border px-3 py-2 text-[11px]",
        ok
          ? "border-green-500/30 bg-green-500/10 text-green-300"
          : "border-neutral-800 bg-neutral-950/50 text-neutral-400",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showPassword2, setShowPassword2] = useState(false);

  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);

  const cleanUsername = useMemo(() => username.trim().toLowerCase(), [username]);
  const cleanEmail = useMemo(() => normalizeEmail(email), [email]);

  const usernameError =
    username.length === 0
      ? null
      : isValidUsername(cleanUsername)
        ? null
        : "Nazwa użytkownika musi mieć 3-20 znaków i może zawierać tylko małe litery, cyfry oraz _.";

  const emailError =
    email.length === 0 ? null : isValidEmail(cleanEmail) ? null : "Podaj poprawny adres e-mail.";

  const passwordHasMin = password.length >= 8;
  const passwordHasUpper = /[A-Z]/.test(password);
  const passwordHasLower = /[a-z]/.test(password);
  const passwordHasDigit = /\d/.test(password);

  const passwordValid =
    passwordHasMin && passwordHasUpper && passwordHasLower && passwordHasDigit;

  const passwordMismatch =
    password2.length > 0 && password !== password2;

  const canSubmit =
    !loading &&
    !!firstName.trim() &&
    !!lastName.trim() &&
    !!cleanUsername &&
    !!cleanEmail &&
    !!password &&
    !!password2 &&
    !usernameError &&
    !emailError &&
    passwordValid &&
    !passwordMismatch;

  const handleSignUp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setNotice(null);

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
        text: "Wszystkie pola są wymagane.",
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

    if (!isValidEmail(cleanEmail)) {
      setNotice({
        tone: "error",
        text: "Podaj poprawny adres e-mail.",
      });
      return;
    }

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

      const { error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: cleanPassword,
        options: {
          emailRedirectTo: `${window.location.origin}/login?confirmed=1`,
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
        } else {
          setNotice({
            tone: "error",
            text: error.message,
          });
        }
        return;
      }

      router.replace(
        `/login?registered=1&email=${encodeURIComponent(cleanEmail)}`
      );
    } catch (e: any) {
      setNotice({
        tone: "error",
        text: e?.message || "Wystąpił błąd podczas rejestracji.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-6xl px-4 pb-10">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.05fr]">
        <section className="rounded-3xl border border-neutral-800 bg-gradient-to-br from-neutral-900 via-neutral-900 to-sky-950/20 p-6">
          <div className="inline-flex items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-300">
            Rejestracja
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
            Załóż konto i zacznij grać
          </h1>

          <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-400">
            Po utworzeniu konta wyślemy na Twój adres e-mail link potwierdzający.
            Dopiero po potwierdzeniu adresu e-mail konto będzie gotowe do pełnego logowania.
          </p>

          <div className="mt-6 space-y-3">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4">
              <div className="text-xs text-neutral-400">Po rejestracji</div>
              <div className="mt-2 text-sm font-medium text-white">Potwierdzenie e-mail</div>
              <div className="mt-1 text-sm text-neutral-500">
                Wyślemy wiadomość z linkiem potwierdzającym. Po kliknięciu wrócisz
                na stronę logowania z komunikatem o powodzeniu.
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4">
              <div className="text-xs text-neutral-400">Wymagania hasła</div>
              <div className="mt-2 text-sm text-neutral-500">
                Minimum 8 znaków, przynajmniej jedna duża litera, jedna mała litera
                i jedna cyfra.
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4 text-sm text-neutral-400">
              Masz już konto?{" "}
              <Link href="/login" className="font-medium text-white underline underline-offset-2">
                Zaloguj się
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-white">Utwórz konto</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Wypełnij formularz i aktywuj konto przez e-mail.
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

          <form onSubmit={handleSignUp} className="space-y-4">
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
              onChange={setUsername}
              placeholder="np. typer_99"
              autoComplete="username"
              error={usernameError}
              help="Dozwolone: małe litery, cyfry i _. Bez spacji."
            />

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

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <PasswordRule ok={passwordHasMin}>Minimum 8 znaków</PasswordRule>
              <PasswordRule ok={passwordHasUpper}>Jedna duża litera</PasswordRule>
              <PasswordRule ok={passwordHasLower}>Jedna mała litera</PasswordRule>
              <PasswordRule ok={passwordHasDigit}>Jedna cyfra</PasswordRule>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-2xl bg-white py-3 text-sm font-semibold text-black transition hover:opacity-95 disabled:opacity-60"
            >
              {loading ? "Tworzenie konta..." : "Utwórz konto"}
            </button>

            <div className="pt-2 text-sm text-neutral-400">
              Masz już konto?{" "}
              <Link href="/login" className="text-white underline underline-offset-2">
                Zaloguj się
              </Link>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}