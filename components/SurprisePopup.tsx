"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function SurprisePopup() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [hearts, setHearts] = useState<number[]>([]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) return;

      const r = await fetch("/api/surprise", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await r.json();

      if (!mounted) return;

      if (data?.show) {
        setMessage(data.message);
        setOpen(true);

        // generujemy serduszka
        setHearts(Array.from({ length: 20 }, (_, i) => i));
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, []);

  const closePopup = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (token) {
      await fetch("/api/surprise", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    }

    setOpen(false);
  };

  if (!open) return null;

  return (
    <>
      {/* Falling hearts */}
      <div className="pointer-events-none fixed inset-0 z-[9998] overflow-hidden">
        {hearts.map((h) => (
          <div
            key={h}
            className="absolute text-2xl animate-heartfall"
            style={{
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
            }}
          >
            ❤️
          </div>
        ))}
      </div>

      {/* Popup */}
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70">
        <div className="relative rounded-3xl border border-pink-500/30 bg-neutral-950 p-10 text-center shadow-2xl">
          <div className="text-5xl mb-4 animate-bounce">💖</div>

          <h2 className="text-3xl font-bold text-white mb-4">
            Niespodzianka
          </h2>

          <div className="text-3xl text-pink-400 font-semibold animate-pulse">
            {message}
          </div>

          <button
            onClick={closePopup}
            className="mt-8 rounded-xl bg-pink-600 px-6 py-3 text-white hover:bg-pink-500 transition"
          >
            ❤️
          </button>
        </div>
      </div>
    </>
  );
}