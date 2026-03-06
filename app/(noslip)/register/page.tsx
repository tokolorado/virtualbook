"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignUp = async () => {
    setLoading(true);

    const { error } = await supabase.auth.signUp({
  email,
  password,
  options: {
    emailRedirectTo: "http://localhost:3000/auth/callback",
  },
});

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Konto utworzone. Możesz się zalogować.");
    window.location.href = "/login";
  };

  return (
    <div className="max-w-md mx-auto mt-20 space-y-4">
      <h1 className="text-2xl font-semibold">Rejestracja</h1>
      <p className="text-sm text-neutral-400">
        Załóż konto, żeby dostać wirtualne saldo i grać ze znajomymi.
      </p>

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