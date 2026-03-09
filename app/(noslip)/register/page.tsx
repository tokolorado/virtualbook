"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

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

export default function RegisterPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignUp = async () => {
    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();
    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    if (
      !cleanFirstName ||
      !cleanLastName ||
      !cleanUsername ||
      !cleanEmail ||
      !cleanPassword
    ) {
      alert("Wszystkie pola są wymagane.");
      return;
    }

    if (!isValidUsername(cleanUsername)) {
      alert(
        "Nazwa użytkownika jest nieprawidłowa. Użyj 3-20 znaków: małe litery, cyfry i _. Bez wulgaryzmów i nazw zastrzeżonych."
      );
      return;
    }

    if (cleanPassword.length < 6) {
      alert("Hasło musi mieć co najmniej 6 znaków.");
      return;
    }

    setLoading(true);

    try {
      const checkRes = await fetch(
        `/api/username/check?username=${encodeURIComponent(cleanUsername)}`,
        { cache: "no-store" }
      );

      const checkData = await checkRes.json();

      if (checkData.exists) {
        alert("Ta nazwa użytkownika jest już zajęta.");
        setLoading(false);
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

      setLoading(false);

      if (error) {
        alert(error.message);
        return;
      }

      alert("Konto utworzone. Możesz się zalogować.");
      window.location.href = "/login";
    } catch (e: any) {
      setLoading(false);
      alert(e?.message || "Wystąpił błąd podczas rejestracji.");
    }
  };

  const inputClass =
    "w-full p-3 rounded-xl bg-neutral-900 text-white placeholder:text-neutral-500 border border-neutral-800 focus:border-neutral-600 outline-none transition";

  return (
    <div className="max-w-md mx-auto mt-20 space-y-4">
      <h1 className="text-2xl font-semibold text-white">Rejestracja</h1>

      <p className="text-sm text-neutral-400">
        Załóż konto, żeby dostać wirtualne saldo i grać ze znajomymi.
      </p>

      <input
        type="text"
        placeholder="Imię"
        required
        className={inputClass}
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
      />

      <input
        type="text"
        placeholder="Nazwisko"
        required
        className={inputClass}
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
      />

      <input
        type="text"
        placeholder="Nazwa użytkownika"
        required
        className={inputClass}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />

      <input
        type="email"
        placeholder="Email"
        required
        className={inputClass}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <input
        type="password"
        placeholder="Hasło (min. 6 znaków)"
        required
        className={inputClass}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <button
        onClick={handleSignUp}
        disabled={loading}
        className="w-full bg-white text-black py-3 rounded-xl font-semibold disabled:opacity-60 hover:opacity-95 transition"
      >
        {loading ? "Tworzenie konta..." : "Utwórz konto"}
      </button>

      <div className="text-sm text-neutral-400">
        Masz już konto?{" "}
        <Link href="/login" className="text-white underline">
          Zaloguj się
        </Link>
      </div>
    </div>
  );
}