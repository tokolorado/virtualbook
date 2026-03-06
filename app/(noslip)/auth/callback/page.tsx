"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  useEffect(() => {
    // Po wejściu na tę stronę: Supabase finalizuje sesję po kliknięciu linka w mailu
    supabase.auth.getSession().then(() => {
      window.location.href = "/events";
    });
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center">
      <div className="text-neutral-300">Potwierdzanie konta...</div>
    </div>
  );
}