// app/(noslip)/register/page.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function RegisterPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignUp = async () => {
    if (!firstName.trim() || !lastName.trim() || !username.trim()) {
      alert("Uzupełnij imię, nazwisko i nazwę użytkownika.");
      return;
    }

    if (!email.trim() || !password.trim()) {
      alert("Uzupełnij email i hasło.");
      return;
    }

    if (password.trim().length < 6) {
      alert("Hasło musi mieć co najmniej 6 znaków.");
      return;
    }

    setLoading(true);

    try {
      const cleanUsername = username.trim();

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
        email: email.trim(),
        password: password.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
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

  return (
    <div className="max-w-md mx-auto mt-20 space-y-4">
      <h1 className="text-2xl font-semibold">Rejestracja</h1>
      <p className="text-sm text-neutral-400">
        Załóż konto, żeby dostać wirtualne saldo i grać ze znajomymi.
      </p>

      <input
        type="text"
        placeholder="Imię"
        className="w-full p-3 rounded-xl bg-neutral-900 border border-neutral-800"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
      />

      <input
        type="text"
        placeholder="Nazwisko"
        className="w-full p-3 rounded-xl bg-neutral-900 border border-neutral-800"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
      />

      <input
        type="text"
        placeholder="Nazwa użytkownika"
        className="w-full p-3 rounded-xl bg-neutral-900 border border-neutral-800"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />

      <input
        type="email"
        placeholder="Email"
        className="w-full p-3 rounded-xl bg-neutral-900 border border-neutral-800"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <input
        type="password"
        placeholder="Hasło (min. 6 znaków)"
        className="w-full p-3 rounded-xl bg-neutral-900 border border-neutral-800"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <button
        onClick={handleSignUp}
        disabled={loading}
        className="w-full bg-white text-black py-3 rounded-xl font-semibold disabled:opacity-60"
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