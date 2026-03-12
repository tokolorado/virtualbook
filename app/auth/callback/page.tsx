"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function getRedirectPath(type: string | null, fallbackToLogin = false) {
  if (type === "signup") return "/login?confirmed=1";
  return fallbackToLogin ? "/login" : "/events";
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ranRef = useRef(false);
  const [message, setMessage] = useState("Potwierdzamy logowanie...");

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const redirectTo = (target: string) => {
      window.history.replaceState({}, document.title, target);
      router.replace(target);
    };

    const run = async () => {
      try {
        const queryType = searchParams.get("type");
        const code = searchParams.get("code");

        const hash = window.location.hash.startsWith("#")
          ? window.location.hash.slice(1)
          : "";

        const hashParams = new URLSearchParams(hash);

        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        const hashType = hashParams.get("type");

        const finalType = hashType || queryType || null;

        // 1) PKCE / code flow
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            setMessage("Nie udało się potwierdzić sesji. Przekierowuję do logowania...");
            redirectTo("/login");
            return;
          }

          if (finalType === "signup") {
            setMessage("E-mail potwierdzony. Przekierowuję do logowania...");
            redirectTo("/login?confirmed=1");
            return;
          }

          setMessage("Logowanie zakończone. Przekierowuję...");
          redirectTo("/events");
          return;
        }

        // 2) Hash tokens flow
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) {
            setMessage("Nie udało się zapisać sesji. Przekierowuję do logowania...");
            redirectTo("/login");
            return;
          }

          if (finalType === "signup") {
            setMessage("E-mail potwierdzony. Przekierowuję do logowania...");
            redirectTo("/login?confirmed=1");
            return;
          }

          setMessage("Logowanie zakończone. Przekierowuję...");
          redirectTo("/events");
          return;
        }

        // 3) Fallback: sprawdzenie aktywnej sesji
        const { data } = await supabase.auth.getSession();

        if (data.session) {
          if (finalType === "signup") {
            setMessage("E-mail potwierdzony. Przekierowuję do logowania...");
            redirectTo("/login?confirmed=1");
            return;
          }

          setMessage("Sesja aktywna. Przekierowuję...");
          redirectTo("/events");
          return;
        }

        // 4) Jeśli to był signup, ale nie ma sesji — i tak pokaż sukces potwierdzenia
        if (finalType === "signup") {
          setMessage("E-mail potwierdzony. Przekierowuję do logowania...");
          redirectTo("/login?confirmed=1");
          return;
        }

        setMessage("Brak danych sesji. Przekierowuję do logowania...");
        redirectTo("/login");
      } catch {
        setMessage("Wystąpił błąd. Przekierowuję do logowania...");
        redirectTo("/login");
      }
    };

    run();
  }, [router, searchParams]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-900/40 p-6 text-center shadow-2xl">
        <div className="inline-flex items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-300">
          VirtualBook
        </div>

        <h1 className="mt-4 text-2xl font-semibold text-white">
          Przetwarzanie autoryzacji
        </h1>

        <p className="mt-3 text-sm text-neutral-300">{message}</p>

        <div className="mt-5 text-xs text-neutral-500">
          Za chwilę zostaniesz automatycznie przekierowany.
        </div>
      </div>
    </div>
  );
}