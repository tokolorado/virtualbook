"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
  if (error.message.toLowerCase().includes("email not confirmed")) {
    alert("Musisz potwierdzić email w wiadomości od Supabase (albo wyłącz email confirmation w Supabase na czas developmentu).");
  } else {
    alert(error.message);
  }
  return;
}

    window.location.href = "/events";
  };

  return (
    <div className="max-w-md mx-auto mt-20 space-y-4">
      <h1 className="text-2xl font-semibold">Logowanie</h1>

      <input
        type="email"
        placeholder="Email"
        className="w-full p-3 rounded-xl bg-neutral-900 border border-neutral-800"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <input
        type="password"
        placeholder="Hasło"
        className="w-full p-3 rounded-xl bg-neutral-900 border border-neutral-800"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <button
        onClick={handleSignIn}
        disabled={loading}
        className="w-full bg-white text-black py-3 rounded-xl font-semibold disabled:opacity-60"
      >
        {loading ? "Logowanie..." : "Zaloguj"}
      </button>

      <div className="text-sm text-neutral-400">
        Nie masz konta?{" "}
        <Link href="/register" className="text-white underline">
          Zarejestruj się
        </Link>
      </div>
    </div>
  );
}