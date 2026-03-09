"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const ranRef = useRef(false);
  const [message, setMessage] = useState("Potwierdzamy logowanie...");

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const run = async () => {
      try {
        const hash = window.location.hash.startsWith("#")
          ? window.location.hash.slice(1)
          : "";

        const params = new URLSearchParams(hash);

        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        const type = params.get("type");

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) {
            setMessage("Nie udało się zapisać sesji. Przekierowuję do logowania...");
            window.history.replaceState({}, document.title, "/login");
            router.replace("/login");
            return;
          }

          if (type === "signup") {
            setMessage("Email potwierdzony. Przekierowuję do logowania...");
          } else {
            setMessage("Logowanie zakończone. Przekierowuję...");
          }

          window.history.replaceState({}, document.title, "/login");
          router.replace("/login");
          return;
        }

        const { data } = await supabase.auth.getSession();

        if (data.session) {
          setMessage("Sesja aktywna. Przekierowuję...");
          window.history.replaceState({}, document.title, "/login");
          router.replace("/login");
          return;
        }

        setMessage("Brak danych sesji. Przekierowuję do logowania...");
        window.history.replaceState({}, document.title, "/login");
        router.replace("/login");
      } catch {
        setMessage("Wystąpił błąd. Przekierowuję do logowania...");
        window.history.replaceState({}, document.title, "/login");
        router.replace("/login");
      }
    };

    run();
  }, [router]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-center">
        <h1 className="text-2xl font-semibold text-white">VirtualBook</h1>
        <p className="mt-3 text-sm text-neutral-300">{message}</p>
      </div>
    </div>
  );
}