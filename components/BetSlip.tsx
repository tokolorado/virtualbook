//components/BetSlip.tsx
"use client";

import { formatOdd, formatVB } from "@/lib/format";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBetSlip, type SlipItem } from "@/lib/BetSlipContext";

const MIN_STAKE = 1;
const MAX_STAKE = 10000;

// ✅ started = kickoff osiągnięty (frontowe UX)
function isStarted(kickoffUtc?: string | null) {
  if (!kickoffUtc) return false;
  const t = Date.parse(kickoffUtc);
  if (!Number.isFinite(t)) return false;
  return Date.now() >= t;
}

function parseStake(raw: string): number | null {
  const s = (raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function keyOf(it: SlipItem) {
  return `${it.matchId}__${it.market}`;
}

            function pickLabel(it: SlipItem) {
            const p = String(it.pick || "").toUpperCase();

            if (it.market === "1x2") {
              if (p === "1") return it.home;
              if (p === "2") return it.away;
              if (p === "X") return "Remis";
            }

            return it.pick;
          }


type SuccessModalData = {
  itemsCount: number;
  stake: number;
  totalOdds: number;
  potentialWin: number;
  slipSnapshot: SlipItem[];
  betId?: string | null;
};

export default function BetSlip({ variant }: { variant?: string }) {
  const { slip, stake, setStake, removeFromSlip, clearSlip, addToSlip } =
    useBetSlip();

  const isMobile = variant === "mobile";
  const isDesktop = variant === "desktop";

  // MOBILE drawer state
  const [open, setOpen] = useState(false);

  // ✅ lokalny input stawki — naprawia problem z wpisywaniem wielu cyfr
  const [stakeInput, setStakeInput] = useState(stake);

  // UX: flash on change
  const prevSlipRef = useRef<SlipItem[]>([]);
  const [flashKey, setFlashKey] = useState<string | null>(null);

  // UX: shake on invalid submit / error
  const [shake, setShake] = useState(false);

  // ✅ Modal success
  const [successModal, setSuccessModal] = useState<SuccessModalData | null>(
    null
  );
  const [showTicket, setShowTicket] = useState(false);

  // loading + api error
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ✅ Modal error (np. niewystarczające środki)
  const [errorModal, setErrorModal] = useState<string | null>(null);

  // ✅ sync context -> local input
  useEffect(() => {
    setStakeInput(stake);
  }, [stake]);

  useEffect(() => {
    const prev = prevSlipRef.current;
    const prevMap = new Map(prev.map((x) => [keyOf(x), x]));
    const currMap = new Map(slip.map((x) => [keyOf(x), x]));

    let changed: string | null = null;

    for (const [k, curr] of currMap.entries()) {
      const p = prevMap.get(k);
      if (!p) {
        changed = k;
        break;
      }
      if (p.pick !== curr.pick || p.odd !== curr.odd) {
        changed = k;
        break;
      }
    }

    prevSlipRef.current = slip;

    if (changed) {
      setFlashKey(changed);
      const t = window.setTimeout(() => setFlashKey(null), 450);
      return () => window.clearTimeout(t);
    }
  }, [slip]);

  // Close drawer on ESC
  useEffect(() => {
    if (!isMobile || !open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobile, open]);

  // Close modal on ESC (success)
  useEffect(() => {
    if (!successModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSuccessModal(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [successModal]);

  // Close modal on ESC (error)
  useEffect(() => {
    if (!errorModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setErrorModal(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [errorModal]);

  const stakeNum = useMemo(() => parseStake(stakeInput), [stakeInput]);

  const totalOdds = useMemo(() => {
    if (!slip.length) return 0;
    let prod = 1;
    for (const it of slip) {
      const o = Number(it.odd);
      if (!Number.isFinite(o) || o <= 1e-9) continue;
      prod *= o;
    }
    return prod;
  }, [slip]);

  const potentialWin = useMemo(() => {
    if (!stakeNum || stakeNum <= 0 || !slip.length) return null;
    if (!Number.isFinite(totalOdds) || totalOdds <= 0) return null;
    return stakeNum * totalOdds;
  }, [stakeNum, totalOdds, slip.length]);

  const stakeError = useMemo(() => {
    if (!slip.length) return null;
    if (stakeInput.trim() === "") return "Wpisz stawkę.";
    if (stakeNum == null) return "Nieprawidłowa stawka.";
    if (stakeNum < MIN_STAKE) return `Minimalna stawka: ${MIN_STAKE}.`;
    if (stakeNum > MAX_STAKE) return `Maksymalna stawka: ${MAX_STAKE}.`;
    return null;
  }, [stakeInput, stakeNum, slip.length]);

  // ✅ blokuj postawienie jeśli w kuponie jest mecz rozpoczęty
  const hasStarted = useMemo(() => {
    return slip.some((it) => isStarted(it.kickoffUtc));
  }, [slip]);

  const canSubmit = useMemo(() => {
    return slip.length > 0 && !stakeError && !submitting && !hasStarted;
  }, [slip.length, stakeError, submitting, hasStarted]);

  const restoreSlip = (snapshot: SlipItem[]) => {
    for (const it of snapshot) addToSlip(it);
    if (isMobile) setOpen(true);
  };

  const onSubmit = async () => {
    setSubmitError(null);
    setErrorModal(null);

    if (!canSubmit) {
      setShake(true);
      window.setTimeout(() => setShake(false), 260);
      return;
    }

    const snapshot = slip.slice();

    try {
      setSubmitting(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error("Nie jesteś zalogowany.");
      }

      const r = await fetch("/api/bets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ slip: snapshot, stake: stakeNum }),
      });

      const text = await r.text();
      let j: any = null;
      try {
        j = JSON.parse(text);
      } catch {
        j = { error: text?.slice(0, 300) || "Non-JSON response" };
      }

      if (!r.ok) {
        throw new Error(j?.error || `Błąd /api/bets (HTTP ${r.status})`);
      }

      const betId = j?.betId ? String(j.betId) : null;

      const totalOddsServer = Number(j?.totalOdds ?? j?.total_odds);
      const potentialWinServer = Number(j?.potentialWin ?? j?.potential_win);
      const balanceAfterServer = Number(
        j?.balanceAfter ?? j?.balance_after ?? j?.balance_vb
      );

      const totalOddsFinal =
        Number.isFinite(totalOddsServer) && totalOddsServer > 0
          ? totalOddsServer
          : totalOdds;

      const potentialWinFinal =
        Number.isFinite(potentialWinServer) && potentialWinServer >= 0
          ? potentialWinServer
          : Number(potentialWin ?? 0);

      if (Number.isFinite(balanceAfterServer)) {
        window.dispatchEvent(
          new CustomEvent("vb:refresh-balance", {
            detail: {
              balance_vb: balanceAfterServer,
              balanceAfter: balanceAfterServer,
            },
          })
        );
      } else {
        window.dispatchEvent(new Event("vb:refresh-balance"));
      }

      window.dispatchEvent(new Event("vb:refresh-balance"));

      try {
        const uid = sessionData.session?.user?.id;
        if (uid) {
          const { data: p, error: pErr } = await supabase
            .from("profiles")
            .select("balance_vb")
            .eq("id", uid)
            .maybeSingle();

          if (!pErr && p?.balance_vb != null) {
            const b = Number(p.balance_vb);
            if (Number.isFinite(b)) {
              window.dispatchEvent(
                new CustomEvent("vb:refresh-balance", {
                  detail: { balance_vb: b, balanceAfter: b },
                })
              );
            }
          }
        }
      } catch {
        // ignore
      }

      setShowTicket(false);
      setSuccessModal({
        itemsCount: snapshot.length,
        stake: Number(stakeNum ?? 0),
        totalOdds: totalOddsFinal,
        potentialWin: potentialWinFinal,
        slipSnapshot: snapshot,
        betId,
      });

      clearSlip();
      setStake("");
      setStakeInput("");
      setOpen(false);
    } catch (e: any) {
      const msg = e?.message || "Nie udało się postawić kuponu.";
      setSubmitError(msg);
      setShake(true);
      window.setTimeout(() => setShake(false), 260);

      if (
        typeof msg === "string" &&
        msg.toLowerCase().includes("insufficient balance")
      ) {
        setErrorModal("Niewystarczające środki na koncie.");
      } else if (
        typeof msg === "string" &&
        msg.toLowerCase().includes("mecz rozpoczęty")
      ) {
        setErrorModal(
          "Mecz już się rozpoczął — usuń go z kuponu, aby móc postawić zakład."
        );
      } else if (
        typeof msg === "string" &&
        msg.toLowerCase().includes("not authenticated")
      ) {
        setErrorModal("Sesja wygasła — odśwież stronę i zaloguj się ponownie.");
      } else {
        setErrorModal(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const errorModalNode = errorModal ? (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={() => setErrorModal(null)} />

      <div className="relative w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-neutral-100">
              Nie udało się postawić kuponu
            </div>
            <div className="text-sm text-neutral-400 mt-1">{errorModal}</div>
          </div>

          <button
            onClick={() => setErrorModal(null)}
            className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 transition"
          >
            Zamknij
          </button>
        </div>

        <div className="mt-4">
          <button
            onClick={() => setErrorModal(null)}
            className="w-full rounded-xl bg-white text-black px-4 py-3 text-sm font-semibold active:scale-[0.99] transition"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const successModalNode = successModal ? (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={() => setSuccessModal(null)} />

      <div className="relative w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-neutral-100">
              Kupon został postawiony ✅
            </div>
            <div className="text-sm text-neutral-400 mt-1">
              Wirtualny zakład — bez prawdziwych pieniędzy.
            </div>
            {successModal.betId ? (
              <div className="text-[11px] text-neutral-500 mt-1">
                ID kuponu: {successModal.betId}
              </div>
            ) : null}
          </div>

          <button
            onClick={() => setSuccessModal(null)}
            className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 transition"
          >
            Zamknij
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-400">Zdarzeń</span>
            <span className="text-neutral-100 font-semibold">
              {successModal.itemsCount}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-400">Stawka</span>
            <span className="text-neutral-100 font-semibold">
              {formatVB(successModal.stake)} VB
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-400">Kurs łączny</span>
            <span className="text-neutral-100 font-semibold">
              {formatOdd(successModal.totalOdds)}
            </span>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="text-xs text-neutral-400">Potencjalna wygrana</div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {potentialWin ? `${formatVB(potentialWin)} VB` : "—"}
            </div>
            <div className="mt-1 text-[11px] text-neutral-500">
              Wyliczone jako: stawka × kurs łączny
            </div>
          </div>
        </div>

        <div className="mt-4">
          <button
            onClick={() => setShowTicket((v) => !v)}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm text-neutral-200 hover:bg-neutral-800 transition"
          >
            {showTicket ? "Ukryj kupon" : "Zobacz kupon"}
          </button>

          {showTicket ? (
            <div className="mt-3 space-y-2 max-h-[40vh] overflow-auto pr-1">
              {successModal.slipSnapshot.map((it) => {
                const started = isStarted(it.kickoffUtc);
                return (
                  <div
                    key={`${it.matchId}__${it.market}`}
                    className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3"
                  >
                    <div className="text-xs text-neutral-400">
                      {it.competitionCode || it.league}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-neutral-100">
                      {it.home}{" "}
                      <span className="text-neutral-400 font-normal">vs</span>{" "}
                      {it.away}
                    </div>
                    <div className="mt-2 text-sm text-neutral-200">
                      Rynek:{" "}
                      <span className="text-neutral-100 font-semibold">
                        {it.market}
                      </span>{" "}
                      • Typ:{" "}
                      <span className="text-neutral-100 font-semibold">
                        {pickLabel(it)}
                      </span>
                    </div>

                    {!started ? (
                      <div className="mt-1 text-sm text-neutral-300">
                        Kurs:{" "}
                        <span className="text-neutral-100 font-semibold">
                          {formatOdd(it.odd)}
                        </span>
                      </div>
                    ) : (
                      <div className="mt-1 text-sm text-neutral-400">Kurs: —</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2">
          <button
            onClick={() => {
              for (const it of successModal.slipSnapshot) addToSlip(it);
              if (isMobile) setOpen(true);
              setSuccessModal(null);
            }}
            className="w-full rounded-xl bg-white text-black px-4 py-3 text-sm font-semibold active:scale-[0.99] transition"
          >
            Postaw ponownie
          </button>

          <button
            onClick={() => setSuccessModal(null)}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-200 hover:bg-neutral-900 active:scale-[0.99] transition"
          >
            Zamknij okienko
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const slipContent = (
    <div className="space-y-4">
      <style jsx global>{`
        @keyframes vb-shake {
          0% {
            transform: translateX(0);
          }
          25% {
            transform: translateX(-6px);
          }
          50% {
            transform: translateX(6px);
          }
          75% {
            transform: translateX(-4px);
          }
          100% {
            transform: translateX(0);
          }
        }
        .vb-shake {
          animation: vb-shake 0.26s ease-in-out 1;
        }

        @keyframes vb-pop {
          0% {
            transform: scale(1);
          }
          45% {
            transform: scale(1.02);
          }
          100% {
            transform: scale(1);
          }
        }
        .vb-pop {
          animation: vb-pop 0.45s ease-in-out 1;
        }
      `}</style>

      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">Kupon</h3>
        <div className="text-sm text-neutral-400">{slip.length} zdarzeń</div>
      </div>

      {hasStarted ? (
        <div className="rounded-xl border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-200">
          Masz w kuponie mecz, który już się rozpoczął — usuń go, aby móc postawić kupon.
        </div>
      ) : null}

      <div
        className={
          isDesktop ? "space-y-3 max-h-[46vh] overflow-auto pr-1" : "space-y-3"
        }
      >
        {slip.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-300">
            Brak zdarzeń. Kliknij kurs, żeby dodać do kuponu.
          </div>
        ) : (
          slip.map((it) => {
            const k = keyOf(it);

            const flash = flashKey === k;
            const started = isStarted(it.kickoffUtc);

            return (
              <div
                key={k}
                className={[
                  "rounded-2xl border border-neutral-800 bg-neutral-950 p-4 transition",
                  flash ? "vb-pop ring-2 ring-neutral-200/60" : "",
                  started ? "opacity-50" : "",
                ].join(" ")}
              >
                <div className="text-xs text-neutral-400">
                  {it.competitionCode || it.league}
                </div>

                <div className="mt-1 text-sm font-semibold">
                  {it.home}{" "}
                  <span className="text-neutral-400 font-normal">vs</span>{" "}
                  {it.away}
                </div>

                {started ? (
                  <div className="mt-2 inline-flex items-center rounded-full border border-red-400/30 bg-red-950/30 px-3 py-1 text-xs text-red-200">
                    Mecz rozpoczęty — zakłady zamknięte
                  </div>
                ) : null}

                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="text-sm text-neutral-200">
                    <div>
                      Rynek:{" "}
                      <span className="text-neutral-100 font-semibold">
                        {it.market}
                      </span>
                    </div>
                    <div>
                      Typ:{" "}
                      <span className="text-neutral-100 font-semibold">
                        {pickLabel(it)}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    {!started ? (
                      <div className="text-sm text-neutral-300">
                        Kurs:{" "}
                        <span className="text-neutral-100 font-semibold">
                          {Number(it.odd).toFixed(2)}
                        </span>
                      </div>
                    ) : (
                      <div className="text-sm text-neutral-400">Kurs: —</div>
                    )}

                    <button
                      onClick={() => removeFromSlip(it.matchId, it.market)}
                      className="mt-2 text-xs text-neutral-400 hover:text-white transition"
                    >
                      Usuń
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-300">Kurs łączny</span>
          <span className="font-semibold">
            {slip.length ? formatOdd(totalOdds) : "—"}
          </span>
        </div>

        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-neutral-300">Potencjalna wygrana</span>
          <span className="font-semibold">
            {potentialWin ? `${formatVB(potentialWin)} VB` : "—"}
          </span>
        </div>
      </div>

      <div>
        <label className="text-sm text-neutral-300">Stawka</label>
        <input
          value={stakeInput}
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d.,]/g, "");
            setStakeInput(v);
            setStake(v);
          }}
          inputMode="decimal"
          placeholder={`np. ${MIN_STAKE}`}
          className={[
            "mt-2 w-full rounded-xl border bg-neutral-950 px-3 py-3 text-sm outline-none transition",
            stakeError
              ? "border-red-400/60 focus:border-red-300"
              : "border-neutral-800 focus:border-neutral-600",
          ].join(" ")}
        />
        {stakeError ? (
          <div className="mt-2 text-xs text-red-300">{stakeError}</div>
        ) : (
          <div className="mt-2 text-xs text-neutral-500">
            Min: {MIN_STAKE} • Max: {MAX_STAKE}
          </div>
        )}
      </div>

      <div className={["space-y-2", shake ? "vb-shake" : ""].join(" ")}>
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          className={[
            "w-full rounded-xl px-4 py-3 text-sm font-semibold transition",
            canSubmit
              ? "bg-white text-black hover:opacity-95 active:scale-[0.99]"
              : "bg-neutral-800 text-neutral-500 cursor-not-allowed",
          ].join(" ")}
        >
          {submitting ? "Stawiam…" : "POSTAW KUPON"}
        </button>

        <button
          onClick={() => {
            clearSlip();
            setStake("");
            setStakeInput("");
          }}
          disabled={!slip.length || submitting}
          className={[
            "w-full rounded-xl border px-4 py-3 text-sm transition",
            slip.length
              ? "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900 active:scale-[0.99]"
              : "border-neutral-900 bg-neutral-950 text-neutral-600 cursor-not-allowed",
          ].join(" ")}
        >
          Wyczyść kupon
        </button>

        <div className="text-xs text-neutral-500">
          Wirtualne zakłady — bez prawdziwych pieniędzy.
        </div>
      </div>
    </div>
  );

  const cardWrap = (content: React.ReactNode) => (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
      {content}
    </div>
  );

  if (isDesktop) {
    return (
      <>
        {successModalNode}
        {errorModalNode}
        <div className="sticky top-24">{cardWrap(slipContent)}</div>
      </>
    );
  }

  if (isMobile) {
    return (
      <>
        {successModalNode}
        {errorModalNode}

        <div className="fixed left-0 right-0 bottom-0 z-40 border-t border-neutral-800 bg-neutral-950/95 backdrop-blur">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-neutral-100">
                Kupon ({slip.length})
              </div>
              <div className="text-xs text-neutral-400 truncate">
                Kurs: {slip.length ? formatOdd(totalOdds) : "—"} • Potencjalna wygrana:{" "}
                {potentialWin != null ? formatVB(potentialWin) : "—"} VB
              </div>
            </div>

            <button
              onClick={() => setOpen(true)}
              className="shrink-0 rounded-xl bg-white text-black px-4 py-2 text-sm font-semibold active:scale-[0.99] transition"
            >
              Otwórz
            </button>
          </div>
        </div>

        <div className="h-20" />

        {open ? (
          <div className="fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setOpen(false)}
            />
            <div className="absolute left-0 right-0 bottom-0 rounded-t-3xl border border-neutral-800 bg-neutral-950 max-h-[85vh] overflow-auto">
              <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
                <div className="text-sm font-semibold">Kupon</div>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 transition"
                >
                  Zamknij
                </button>
              </div>

              <div className="p-4">{slipContent}</div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      {successModalNode}
      {errorModalNode}
      {cardWrap(slipContent)}
    </>
  );
}