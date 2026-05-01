// app/(noslip)/register/page.tsx
"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type NoticeTone = "success" | "error" | "warning" | "info";

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
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
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
    <div className="space-y-2">
      <label className="text-sm font-semibold text-neutral-200">{label}</label>

      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          className={cn(
            "w-full rounded-2xl border bg-black/60 px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-neutral-600",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
            rightSlot ? "pr-24" : "",
            error
              ? "border-red-500/50 focus:border-red-400 focus:ring-4 focus:ring-red-500/10"
              : "border-neutral-800 focus:border-neutral-500 focus:ring-4 focus:ring-white/5"
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
        "rounded-2xl border px-3 py-2.5 text-[11px] font-medium transition",
        ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-neutral-800 bg-black/40 text-neutral-500"
      )}
    >
      <span className="mr-2">{ok ? "✓" : "•"}</span>
      {children}
    </div>
  );
}

function FeatureCard({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-yellow-400/80">
        {eyebrow}
      </div>

      <div className="mt-2 text-base font-semibold text-white">{title}</div>

      <p className="mt-2 text-sm leading-6 text-neutral-400">{text}</p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "yellow";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        tone === "yellow"
          ? "border-yellow-500/25 bg-yellow-500/10"
          : "border-white/10 bg-white/[0.035]"
      )}
    >
      <div
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.2em]",
          tone === "yellow" ? "text-yellow-400/80" : "text-neutral-500"
        )}
      >
        {label}
      </div>

      <div
        className={cn(
          "mt-2 text-xl font-semibold",
          tone === "yellow" ? "text-yellow-200" : "text-white"
        )}
      >
        {value}
      </div>
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
  const [notice, setNotice] = useState<{
    tone: NoticeTone;
    text: string;
  } | null>(null);

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

  const handleSignUp = async (e?: FormEvent) => {
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

  return (
    <div className="relative min-h-[calc(100vh-72px)] overflow-hidden bg-black px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(250,204,21,0.16),transparent_28%),radial-gradient(circle_at_88%_20%,rgba(14,165,233,0.14),transparent_26%),radial-gradient(circle_at_50%_90%,rgba(34,197,94,0.08),transparent_34%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      <div className="relative mx-auto max-w-7xl">
        <div className="grid gap-6 lg:grid-cols-[1.02fr_0.98fr] lg:items-stretch">
          <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-neutral-950/80 shadow-[0_24px_120px_rgba(0,0,0,0.65)]">
            <div className="relative h-full p-6 sm:p-8 lg:p-10">
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_34%),radial-gradient(circle_at_top_right,rgba(250,204,21,0.10),transparent_38%)]" />

              <div className="relative">
                <div className="inline-flex items-center gap-2 rounded-full border border-yellow-500/25 bg-yellow-500/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-yellow-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-yellow-300 shadow-[0_0_18px_rgba(250,204,21,0.9)]" />
                  VirtualBook Football
                </div>

                <h1 className="mt-7 max-w-2xl text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
                  Dołącz do gry o piłkową wiedzę, kupony i{" "}
                  <span className="bg-gradient-to-r from-yellow-200 via-yellow-400 to-amber-500 bg-clip-text text-transparent">
                    VirtualBucks
                  </span>
                  .
                </h1>

                <p className="mt-5 max-w-2xl text-sm leading-7 text-neutral-400 sm:text-base">
                  Stwórz konto i wejdź do świata piłkowej rywalizacji bez
                  prawdziwych pieniędzy. Typuj mecze, rozwiązuj quizy,
                  odblokowuj kolejne poziomy i buduj swoją pozycję za pomocą
                  wirtualnej waluty{" "}
                  <span className="font-semibold text-yellow-200">
                    VirtualBucks (VB)
                  </span>
                  .
                </p>

                <div className="mt-7 grid gap-3 sm:grid-cols-3">
                  <MiniStat label="Waluta" value="VirtualBucks" tone="yellow" />
                  <MiniStat label="Ryzyko" value="0 PLN" />
                  <MiniStat label="Tryb" value="Rywalizacja" />
                </div>

                <div className="mt-7 grid gap-3 xl:grid-cols-2">
                  <FeatureCard
                    eyebrow="VB"
                    title="Zdobywaj VirtualBucks"
                    text="Zbieraj VB za aktywność, quizy i skuteczne decyzje. To Twoja wirtualna waluta do zabawy w aplikacji."
                  />

                  <FeatureCard
                    eyebrow="Quiz dnia"
                    title="Sprawdzaj piłkarską wiedzę"
                    text="Codzienne quizy mają poziomy trudności, nagrody i system odblokowywania kolejnych etapów."
                  />

                  <FeatureCard
                    eyebrow="Kupony"
                    title="Typuj bez realnego ryzyka"
                    text="Buduj kupony i testuj swoje przeczucie piłkarskie bez wpłacania prawdziwych pieniędzy."
                  />

                  <FeatureCard
                    eyebrow="Ranking"
                    title="Rywalizuj z innymi"
                    text="Porównuj wyniki, pnij się w tabeli i pokaż, kto najlepiej czyta futbol."
                  />
                </div>

                <div className="mt-7 rounded-3xl border border-white/10 bg-black/40 p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-500">
                    Jak to działa
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
                      <div className="text-sm font-semibold text-white">
                        1. Zakładasz konto
                      </div>
                      <p className="mt-2 text-xs leading-5 text-neutral-500">
                        Wypełnij formularz i potwierdź adres e-mail.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
                      <div className="text-sm font-semibold text-white">
                        2. Zdobywasz VB
                      </div>
                      <p className="mt-2 text-xs leading-5 text-neutral-500">
                        Graj w quizy i korzystaj z funkcji aplikacji.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
                      <div className="text-sm font-semibold text-white">
                        3. Rywalizujesz
                      </div>
                      <p className="mt-2 text-xs leading-5 text-neutral-500">
                        Twórz kupony, zbieraj wyniki i walcz o ranking.
                      </p>
                    </div>
                  </div>
                </div>

                <p className="mt-5 text-xs leading-5 text-neutral-600">
                  VirtualBook Football służy wyłącznie do rozrywki. VirtualBucks
                  (VB) są walutą wirtualną i nie są prawdziwymi pieniędzmi.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-neutral-950/90 p-5 shadow-[0_24px_120px_rgba(0,0,0,0.65)] sm:p-6 lg:p-8">
            <div className="rounded-[1.6rem] border border-neutral-800 bg-black/40 p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-500">
                    Rejestracja
                  </div>

                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                    Utwórz konto
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-neutral-400">
                    Wypełnij dane, a następnie aktywuj konto przez link wysłany
                    na e-mail.
                  </p>
                </div>

                <div className="rounded-2xl border border-yellow-500/25 bg-yellow-500/10 px-4 py-3 text-right">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-yellow-400/80">
                    Start
                  </div>
                  <div className="mt-1 text-sm font-semibold text-yellow-100">
                    VB ready
                  </div>
                </div>
              </div>

              {notice ? (
                <div
                  className={cn(
                    "mt-5 rounded-2xl border p-4 text-sm leading-6",
                    noticeClasses(notice.tone)
                  )}
                >
                  {notice.text}
                </div>
              ) : null}

              <form onSubmit={handleSignUp} className="mt-6 space-y-4">
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
                        className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:border-neutral-700 hover:bg-neutral-800"
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
                        className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:border-neutral-700 hover:bg-neutral-800"
                      >
                        {showPassword2 ? "Ukryj" : "Pokaż"}
                      </button>
                    }
                    error={passwordMismatch ? "Hasła nie są identyczne." : null}
                  />
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <PasswordRule ok={passwordHasMin}>
                    Minimum 8 znaków
                  </PasswordRule>
                  <PasswordRule ok={passwordHasUpper}>
                    Jedna duża litera
                  </PasswordRule>
                  <PasswordRule ok={passwordHasLower}>
                    Jedna mała litera
                  </PasswordRule>
                  <PasswordRule ok={passwordHasDigit}>Jedna cyfra</PasswordRule>
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={cn(
                    "group relative w-full overflow-hidden rounded-2xl px-5 py-4 text-sm font-semibold transition",
                    canSubmit
                      ? "bg-white text-black shadow-[0_18px_60px_rgba(255,255,255,0.12)] hover:bg-neutral-200"
                      : "cursor-not-allowed bg-neutral-800 text-neutral-500"
                  )}
                >
                  <span className="relative z-10">
                    {loading ? "Tworzenie konta..." : "Utwórz konto"}
                  </span>

                  {canSubmit ? (
                    <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent opacity-40 transition duration-700 group-hover:translate-x-full" />
                  ) : null}
                </button>

                <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 text-sm leading-6 text-neutral-400">
                  Masz już konto?{" "}
                  <Link
                    href="/login"
                    className="font-semibold text-white underline underline-offset-4 transition hover:text-yellow-200"
                  >
                    Zaloguj się
                  </Link>
                </div>
              </form>
            </div>

            <div className="mt-4 rounded-3xl border border-neutral-800 bg-black/30 p-5">
              <div className="text-sm font-semibold text-white">
                Po rejestracji otrzymasz link aktywacyjny.
              </div>

              <p className="mt-2 text-sm leading-6 text-neutral-500">
                Po kliknięciu w link potwierdzający wrócisz do aplikacji i
                będziesz mógł rozpocząć grę o VirtualBucks (VB).
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}