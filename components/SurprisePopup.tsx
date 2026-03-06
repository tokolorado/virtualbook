// components/SurprisePopup.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function SurprisePopup() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [hearts, setHearts] = useState<number[]>([]);
  const [burst, setBurst] = useState<number[]>([]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) return;

        const r = await fetch("/api/surprise", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });

        const data = await r.json();

        if (!mounted) return;

        if (data?.show) {
          setMessage(String(data.message ?? ""));
          setOpen(true);
          setHearts(Array.from({ length: 20 }, (_, i) => i));
        }
      } catch (e) {
        console.error("Surprise popup error:", e);
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, []);

  const closePopup = async () => {
    setBurst(Array.from({ length: 14 }, (_, i) => i));

    // subtle "pop" sound via Web Audio API
    try {
      const Ctx =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (Ctx) {
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = "triangle";
        osc.frequency.setValueAtTime(520, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.18);

        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);

        osc.start();
        osc.stop(ctx.currentTime + 0.22);
      }
    } catch (e) {
      console.error("Pop sound error:", e);
    }

    setTimeout(async () => {
      try {
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
      } catch (e) {
        console.error("Surprise ack error:", e);
      } finally {
        setOpen(false);
      }
    }, 700);
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
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 px-4">
        <div className="surprise-popup-bg relative w-full max-w-md rounded-3xl border border-pink-400/30 p-10 text-center shadow-2xl overflow-hidden">
          <div className="pointer-events-none absolute inset-0 rounded-3xl bg-white/5" />

          <div className="relative z-10">
            <div className="mb-4 text-5xl animate-bounce">💖</div>

            <h2 className="mb-4 text-3xl font-bold text-white">
              Niespodzianka
            </h2>

            <div className="surprise-love-text text-3xl font-semibold animate-pulse">
              {message}
            </div>

            <div className="relative inline-block mt-8">
              <button
                onClick={closePopup}
                className="relative z-10 rounded-xl bg-pink-600 px-6 py-3 text-white transition hover:bg-pink-500"
              >
                ❤️
              </button>

              {burst.map((b) => {
                const angle = (360 / 14) * b;
                const x = Math.cos((angle * Math.PI) / 180).toFixed(3);
                const y = Math.sin((angle * Math.PI) / 180).toFixed(3);

                return (
                  <span
                    key={b}
                    className="absolute left-1/2 top-1/2 text-xl animate-heartburst"
                    style={
                      {
                        "--x": x,
                        "--y": y,
                      } as React.CSSProperties
                    }
                  >
                    ❤️
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}