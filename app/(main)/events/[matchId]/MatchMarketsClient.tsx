"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBetSlip } from "@/lib/BetSlipContext";

type Pick1X2 = "1" | "X" | "2";

type OddsRow = {
  match_id: number;
  market_id: string;
  selection: string;
  book_odds: number;
  updated_at: string;
};

type MatchUI = {
  home: string;
  away: string;
  leagueName: string;
  kickoffLocal: string;
};

const MARKET_1X2 = "1x2";

// ✅ PRE-MATCH ONLY: zamykamy zakłady 60s przed kickoff
const BETTING_CLOSE_BUFFER_MS = 60_000;

function safeNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function format2(n: number) {
  return n.toFixed(2);
}

function isBettingClosed(kickoffUtc: string, nowMs: number) {
  const t = Date.parse(kickoffUtc);
  if (!Number.isFinite(t)) return false;
  return nowMs >= t - BETTING_CLOSE_BUFFER_MS;
}

export default function MatchMarketsClient({ matchId }: { matchId: string }) {
  const sp = useSearchParams();

  const competitionCode = sp.get("c") || "";
  const kickoffUtcQS = sp.get("k") || "";

  const homeNameQS = sp.get("hn") || "";
  const awayNameQS = sp.get("an") || "";

  const { addToSlip, removeFromSlip, isActivePick } = useBetSlip();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [matchUI, setMatchUI] = useState<MatchUI>({
    home: homeNameQS || "Home",
    away: awayNameQS || "Away",
    leagueName: competitionCode || "Liga",
    kickoffLocal: kickoffUtcQS ? new Date(kickoffUtcQS).toLocaleString() : "",
  });

  const [kickoffIso, setKickoffIso] = useState<string>(kickoffUtcQS || "");

  // ✅ żeby UI samo przełączyło się na “zamknięte” bez reload
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const closed = useMemo(() => {
    return kickoffIso ? isBettingClosed(kickoffIso, nowMs) : false;
  }, [kickoffIso, nowMs]);

  const [odds1x2, setOdds1x2] = useState<{
    "1": number | null;
    X: number | null;
    "2": number | null;
  }>({ "1": null, X: null, "2": null });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setErr(null);

      const matchIdNum = safeNum(matchId);
      if (matchIdNum == null) {
        setErr("Nieprawidłowy matchId.");
        setLoading(false);
        return;
      }

      try {
        // 1) pobierz mecz z DB dla pewnych nazw i czasu
        const { data: mRow, error: mErr } = await supabase
          .from("matches")
          .select("home_team, away_team, competition_name, utc_date")
          .eq("id", matchIdNum)
          .maybeSingle();

        if (mErr) {
          // fallback i tak mamy z querystring
        }

        const home = (mRow as any)?.home_team
          ? String((mRow as any).home_team)
          : homeNameQS || "Home";
        const away = (mRow as any)?.away_team
          ? String((mRow as any).away_team)
          : awayNameQS || "Away";
        const leagueName =
          (mRow as any)?.competition_name
            ? String((mRow as any).competition_name)
            : competitionCode || "Liga";

        const kickoff =
          (mRow as any)?.utc_date
            ? String((mRow as any).utc_date)
            : kickoffUtcQS || "";

        const kickoffLocal = kickoff ? new Date(kickoff).toLocaleString() : "";

        if (!cancelled) {
          setMatchUI({ home, away, leagueName, kickoffLocal });
          setKickoffIso(kickoff);
        }

        // ✅ jeśli zakłady są zamknięte — nie pokazujemy kursów i nawet nie musimy ich pobierać
        const shouldHideOdds = kickoff ? isBettingClosed(kickoff, Date.now()) : false;
        if (shouldHideOdds) {
          if (!cancelled) {
            setOdds1x2({ "1": null, X: null, "2": null });
            setLoading(false);
            setErr(null);
          }
          return;
        }

        // 2) pobierz odds z DB (TYLKO źródło prawdy)
        const { data: oddsRows, error: oErr } = await supabase
          .from("odds")
          .select("match_id, market_id, selection, book_odds, updated_at")
          .eq("match_id", matchIdNum)
          .eq("market_id", MARKET_1X2)
          .order("updated_at", { ascending: false });

        if (oErr) {
          throw new Error(`Nie udało się pobrać kursów z bazy: ${oErr.message}`);
        }

        const latest: { "1": number | null; X: number | null; "2": number | null } = {
          "1": null,
          X: null,
          "2": null,
        };

        for (const r of (oddsRows as any[] as OddsRow[])) {
          const sel = String(r.selection).trim() as Pick1X2;
          const val = safeNum(r.book_odds);
          if (val == null || val <= 1e-9) continue;

          if (sel === "1" && latest["1"] == null) latest["1"] = val;
          if (sel === "X" && latest["X"] == null) latest["X"] = val;
          if (sel === "2" && latest["2"] == null) latest["2"] = val;

          if (latest["1"] && latest["X"] && latest["2"]) break;
        }

        if (!cancelled) setOdds1x2(latest);

        if (!latest["1"] && !latest["X"] && !latest["2"]) {
          if (!cancelled) {
            setErr("Brak kursów w bazie dla tego meczu (1x2).");
          }
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Błąd pobierania kursów.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [matchId, competitionCode, kickoffUtcQS, homeNameQS, awayNameQS]);

  const picks: Array<{ pick: Pick1X2; odd: number | null }> = useMemo(
    () => [
      { pick: "1", odd: odds1x2["1"] },
      { pick: "X", odd: odds1x2["X"] },
      { pick: "2", odd: odds1x2["2"] },
    ],
    [odds1x2]
  );

  return (
    <div className="space-y-4">
      {/* Nagłówek meczu */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        {loading ? (
          <div className="text-neutral-400">Ładowanie…</div>
        ) : err ? (
          <div className="text-red-300">{err}</div>
        ) : (
          <>
            <div className="text-xs text-neutral-400 flex items-center justify-between gap-2">
              <span>
                {matchUI.leagueName} • {matchUI.kickoffLocal}
              </span>
              {closed ? (
                <span className="text-[11px] px-2 py-1 rounded-lg border border-neutral-800 bg-neutral-950 text-amber-300">
                  Zakłady zamknięte
                </span>
              ) : (
                <span className="text-[11px] px-2 py-1 rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-300">
                  Pre-match
                </span>
              )}
            </div>

            <div className="mt-1 text-xl font-semibold">
              {matchUI.home}{" "}
              <span className="text-neutral-400 font-normal">vs</span>{" "}
              {matchUI.away}
            </div>
          </>
        )}
      </div>

      {/* Rynek: 1X2 z bazy */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="text-sm font-semibold">1X2</div>

        {closed ? (
          <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-300">
            Mecz rozpoczęty — nie można już obstawiać zakładów na ten mecz.
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {picks.map(({ pick, odd }) => {
              const hasOdd = typeof odd === "number" && Number.isFinite(odd) && odd > 0;
              const active = isActivePick(matchId, MARKET_1X2, pick);

              return (
                <button
                  key={pick}
                  disabled={!hasOdd}
                  onClick={() => {
                    if (!hasOdd) return;

                    if (active) {
                      removeFromSlip(matchId, MARKET_1X2);
                      return;
                    }

                    addToSlip({
                      matchId,
                      competitionCode,
                      league: matchUI.leagueName,
                      home: matchUI.home,
                      away: matchUI.away,
                      market: MARKET_1X2,
                      pick,
                      odd: odd!,
                      kickoffUtc: kickoffIso || null,
                    });
                  }}
                  className={[
                    "rounded-xl border px-3 py-2 flex items-center justify-between transition",
                    !hasOdd
                      ? "border-neutral-800 bg-neutral-950 text-neutral-600 cursor-not-allowed"
                      : active
                      ? "border-neutral-200 bg-white text-black"
                      : "border-neutral-800 bg-neutral-950 hover:bg-neutral-800",
                  ].join(" ")}
                  title={
                    !hasOdd
                      ? "Brak kursu w bazie"
                      : active
                      ? "Kliknij ponownie, aby usunąć z kuponu"
                      : `Kurs: ${format2(odd!)}`
                  }
                >
                  <span className="text-sm">{pick}</span>
                  <span className="text-sm font-semibold">
                    {hasOdd ? format2(odd!) : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-3 text-xs text-neutral-500">
          Kursy są pobierane wyłącznie z bazy (public.odds).
        </div>
      </div>
    </div>
  );
}