// components/BetSlip.tsx
"use client";

import type { ReactNode } from "react";
import { formatOdd, formatVB } from "@/lib/format";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  useBetSlip,
  type BetSlipMode,
  type SlipItem,
} from "@/lib/BetSlipContext";
import { formatBetSelectionLabels } from "@/lib/odds/labels";
import { priceAccumulatorSlip } from "@/lib/bets/slipPricing";

const MIN_STAKE = 1;
const MAX_STAKE = 10000;

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

// started = kickoff osiągnięty
function isStarted(kickoffUtc?: string | null) {
  if (!kickoffUtc) return false;
  const t = Date.parse(kickoffUtc);
  if (!Number.isFinite(t)) return false;
  return Date.now() >= t;
}

function parseStake(raw: string): number | null {
  const s = String(raw ?? "")
    .trim()
    .replace(/[\s\u00A0]/g, "")
    .replace(",", ".");

  if (!s) return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFromUnknown(value: unknown, fallback: string) {
  if (value instanceof Error) return value.message;
  if (isRecord(value) && typeof value.message === "string") {
    return value.message;
  }
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

function keyOf(it: SlipItem) {
  return `${it.matchId}__${it.market}`;
}

function buildAttemptFingerprint(
  items: SlipItem[],
  stakeNum: number | null,
  mode: BetSlipMode
) {
  const normalizedStake =
    stakeNum != null && Number.isFinite(stakeNum) ? stakeNum.toFixed(2) : "null";

  const normalizedItems = [...items]
    .map((it) => {
      const matchId = Number(it.matchId);
      const market = String(it.market ?? "").trim().toLowerCase();
      const pick = String(it.pick ?? "").trim();
      return `${matchId}:${market}:${pick}`;
    })
    .sort()
    .join("|");

  return `${mode}__${normalizedStake}__${normalizedItems}`;
}

type SuccessModalData = {
  mode: BetSlipMode;
  itemsCount: number;
  stake: number;
  totalOdds: number;
  potentialWin: number;
  slipSnapshot: SlipItem[];
  betId?: string | null;
};

type BetBuilderQuote = {
  ok: true;
  totalOdds: number;
  potentialWin?: number;
  jointProbability: number;
  productOdds: number;
  correlationFactor: number;
};

function formatStakeInput(v: string) {
  if (!v) return v;

  const normalized = String(v).replace(/[\s\u00A0]/g, "").replace(",", ".");
  const parts = normalized.split(".");

  const int = parts[0].replace(/\D/g, "");
  const formattedInt = int ? Number(int).toLocaleString("pl-PL") : "";

  if (parts.length === 1) return formattedInt;

  const decimals = parts[1].replace(/\D/g, "");
  return `${formattedInt},${decimals}`;
}

export default function BetSlip({ variant }: { variant?: string }) {
  const {
    slip,
    stake,
    setStake,
    mode,
    setMode,
    removeFromSlip,
    clearSlip,
    addToSlip,
  } = useBetSlip();

  const isMobile = variant === "mobile";
  const isDesktop = variant === "desktop";

  const [open, setOpen] = useState(false);
  const [stakeInput, setStakeInput] = useState(formatStakeInput(stake || ""));

  const prevSlipRef = useRef<SlipItem[]>([]);
  const [flashKey, setFlashKey] = useState<string | null>(null);

  const [shake, setShake] = useState(false);

  const [successModal, setSuccessModal] = useState<SuccessModalData | null>(
    null
  );
  const [showTicket, setShowTicket] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [builderQuote, setBuilderQuote] = useState<BetBuilderQuote | null>(null);
  const [builderQuoteLoading, setBuilderQuoteLoading] = useState(false);
  const [builderQuoteError, setBuilderQuoteError] = useState<string | null>(null);

  // Stabilny klucz dla jednej próby submitu
  const attemptKeyRef = useRef<string | null>(null);
  const attemptFingerprintRef = useRef<string>("");

  useEffect(() => {
    setStakeInput(formatStakeInput(stake || ""));
  }, [stake]);

  useEffect(() => {
    if (slip.length > 0 && (!stake || !String(stake).trim())) {
      setStake("10");
      setStakeInput(formatStakeInput("10"));
    }
  }, [slip.length, stake, setStake]);

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

  useEffect(() => {
    if (!isMobile || !open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobile, open]);

  useEffect(() => {
    if (!successModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSuccessModal(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [successModal]);

  useEffect(() => {
    if (!errorModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setErrorModal(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [errorModal]);

  const stakeNum = useMemo(() => parseStake(stakeInput), [stakeInput]);

  const currentAttemptFingerprint = useMemo(() => {
    return buildAttemptFingerprint(slip, stakeNum, mode);
  }, [slip, stakeNum, mode]);

  // Reset idempotency key tylko gdy zaczyna się nowa, istotnie zmieniona próba
  useEffect(() => {
    if (!slip.length) {
      attemptKeyRef.current = null;
      attemptFingerprintRef.current = "";
      return;
    }

    if (
      attemptFingerprintRef.current &&
      attemptFingerprintRef.current !== currentAttemptFingerprint
    ) {
      attemptKeyRef.current = null;
    }

    attemptFingerprintRef.current = currentAttemptFingerprint;
  }, [currentAttemptFingerprint, slip.length]);

  const standardPricing = useMemo(() => priceAccumulatorSlip(slip), [slip]);
  const builderLocalError = useMemo(() => {
    if (mode !== "bet_builder" || slip.length === 0) return null;
    if (slip.length < 2) return "Bet Builder wymaga minimum 2 typów z jednego meczu.";

    const matchIds = new Set(slip.map((item) => String(item.matchId)));
    if (matchIds.size !== 1) {
      return "Bet Builder działa tylko dla jednego meczu naraz.";
    }

    return null;
  }, [mode, slip]);

  useEffect(() => {
    if (mode !== "bet_builder" || slip.length === 0) {
      setBuilderQuote(null);
      setBuilderQuoteLoading(false);
      setBuilderQuoteError(null);
      return;
    }

    if (builderLocalError) {
      setBuilderQuote(null);
      setBuilderQuoteLoading(false);
      setBuilderQuoteError(builderLocalError);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setBuilderQuoteLoading(true);
        setBuilderQuoteError(null);

        const response = await fetch("/api/bet-builder/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slip, stake: stakeNum }),
          signal: controller.signal,
        });

        const payload = (await response.json().catch(() => null)) as unknown;

        if (cancelled) return;

        if (!response.ok || !isRecord(payload) || payload.ok !== true) {
          const message = isRecord(payload)
            ? messageFromUnknown(payload.error, "Nie udalo sie policzyc kursu Bet Buildera.")
            : "Nie udalo sie policzyc kursu Bet Buildera.";
          setBuilderQuote(null);
          setBuilderQuoteError(message);
          return;
        }

        setBuilderQuote(payload as BetBuilderQuote);
        setBuilderQuoteError(null);
      } catch (error: unknown) {
        if (cancelled || controller.signal.aborted) return;
        setBuilderQuote(null);
        setBuilderQuoteError(
          messageFromUnknown(error, "Nie udalo sie policzyc kursu Bet Buildera.")
        );
      } finally {
        if (!cancelled) {
          setBuilderQuoteLoading(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [builderLocalError, mode, slip, stakeNum]);

  const slipPricingError =
    mode === "bet_builder"
      ? builderQuoteLoading
        ? "Licze kurs Bet Buildera..."
        : builderQuoteError
      : standardPricing.ok
        ? null
        : standardPricing.message;
  const totalOdds =
    mode === "bet_builder"
      ? builderQuote?.totalOdds ?? 0
      : standardPricing.ok
        ? standardPricing.totalOdds
        : 0;

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

  const hasStarted = useMemo(() => {
    return slip.some((it) => isStarted(it.kickoffUtc));
  }, [slip]);

  const canSubmit = useMemo(() => {
    return (
      slip.length > 0 &&
      !stakeError &&
      !submitting &&
      !hasStarted &&
      !slipPricingError &&
      (mode === "standard" || (!!builderQuote && !builderQuoteLoading))
    );
  }, [
    slip.length,
    stakeError,
    submitting,
    hasStarted,
    slipPricingError,
    mode,
    builderQuote,
    builderQuoteLoading,
  ]);

  const resetAttemptIdentity = () => {
    attemptKeyRef.current = null;
    attemptFingerprintRef.current = "";
  };

  const resetSlipState = () => {
    clearSlip();
    setStake("");
    setStakeInput("");
    setSubmitError(null);
    resetAttemptIdentity();
  };

  const changeMode = (nextMode: BetSlipMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setSubmitError(null);
    setErrorModal(null);
    setBuilderQuote(null);
    setBuilderQuoteError(null);
    resetAttemptIdentity();
  };

  const restoreSlip = (snapshot: SlipItem[]) => {
    resetAttemptIdentity();
    for (const it of snapshot) addToSlip(it);
    if (isMobile) setOpen(true);
  };

  function addStake(amount: number) {
    const current = parseStake(stakeInput) ?? 0;
    const next = Math.min(current + amount, MAX_STAKE);

    const formatted = formatStakeInput(String(next));

    setStakeInput(formatted);
    setStake(String(next));
  }

  const onSubmit = async () => {
    setSubmitError(null);
    setErrorModal(null);

    if (!canSubmit) {
      if (slipPricingError) {
        setSubmitError(slipPricingError);
        setErrorModal(slipPricingError);
      } else if (mode === "bet_builder" && builderQuoteLoading) {
        const message = "Czekam na kurs Bet Buildera.";
        setSubmitError(message);
      }
      setShake(true);
      window.setTimeout(() => setShake(false), 260);
      return;
    }

    const snapshot = slip.slice();
    const requestId = attemptKeyRef.current ?? crypto.randomUUID();

    attemptKeyRef.current = requestId;
    attemptFingerprintRef.current = currentAttemptFingerprint;

    try {
      setSubmitting(true);

    const getFreshAccessToken = async () => {
      const { data: sessionData } = await supabase.auth.getSession();

      let session = sessionData.session;
      let token = session?.access_token ?? null;

      const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : null;
      const shouldRefresh =
        !token || (expiresAtMs != null && expiresAtMs <= Date.now() + 60_000);

      if (shouldRefresh) {
        const { data: refreshedData } = await supabase.auth.refreshSession();
        session = refreshedData.session;
        token = session?.access_token ?? null;
      }

      if (!token) {
        throw new Error("Nie jesteś zalogowany.");
      }

      return { token, userId: session?.user?.id ?? null };
    };

    const postBet = async (token: string) => {
      return fetch("/api/bets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-idempotency-key": requestId,
        },
        body: JSON.stringify({
          slip: snapshot,
          stake: stakeNum,
          idempotencyKey: requestId,
          mode,
        }),
      });
    };

    let { token, userId } = await getFreshAccessToken();

    let r = await postBet(token);

    if (r.status === 401) {
      const refreshed = await supabase.auth.refreshSession();
      const retryToken = refreshed.data.session?.access_token;

      if (!retryToken) {
        throw new Error("Sesja wygasła — zaloguj się ponownie.");
      }

      token = retryToken;
      userId = refreshed.data.session?.user?.id ?? userId;
      r = await postBet(token);
    }

      const text = await r.text();
      let j: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(text);
        j = isRecord(parsed) ? parsed : {};
      } catch {
        j = { error: text?.slice(0, 300) || "Non-JSON response" };
      }

      if (!r.ok) {
        throw new Error(
          messageFromUnknown(j.error, `Błąd /api/bets (HTTP ${r.status})`)
        );
      }

      const betId = j.betId ? String(j.betId) : null;

      const totalOddsServer = Number(j.totalOdds ?? j.total_odds);
      const potentialWinServer = Number(j.potentialWin ?? j.potential_win);
      const balanceAfterServer = Number(
        j.balanceAfter ?? j.balance_after ?? j.balance_vb
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

      try {
        const uid = userId;
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
        mode,
        itemsCount: snapshot.length,
        stake: Number(stakeNum ?? 0),
        totalOdds: totalOddsFinal,
        potentialWin: potentialWinFinal,
        slipSnapshot: snapshot,
        betId,
      });

      resetSlipState();
      setOpen(false);
    } catch (e: unknown) {
      const msg = messageFromUnknown(e, "Nie udało się postawić kuponu.");
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
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/70"
        onClick={() => setErrorModal(null)}
      />

      <div className="relative w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-neutral-100">
              Nie udało się postawić kuponu
            </div>
            <div className="mt-1 text-sm text-neutral-400">{errorModal}</div>
          </div>

          <button
            onClick={() => setErrorModal(null)}
            className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-neutral-800"
          >
            Zamknij
          </button>
        </div>

        <div className="mt-4">
          <button
            onClick={() => setErrorModal(null)}
            className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition active:scale-[0.99]"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const successModalNode = successModal ? (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/70"
        onClick={() => setSuccessModal(null)}
      />

      <div className="relative w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-neutral-100">
              Kupon został postawiony ✅
            </div>
            <div className="mt-1 text-sm text-neutral-400">
              Wirtualny zakład — bez prawdziwych pieniędzy.
            </div>
            {successModal.betId ? (
              <div className="mt-1 text-[11px] text-neutral-500">
                ID kuponu: {successModal.betId}
              </div>
            ) : null}
          </div>

          <button
            onClick={() => setSuccessModal(null)}
            className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-neutral-800"
          >
            Zamknij
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-400">Zdarzeń</span>
            <span className="font-semibold text-neutral-100">
              {successModal.itemsCount}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-400">Stawka</span>
            <span className="font-semibold text-neutral-100">
              {formatVB(successModal.stake)} VB
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-400">Kurs łączny</span>
            <span className="font-semibold text-neutral-100">
              {formatOdd(successModal.totalOdds)}
            </span>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="text-xs text-neutral-400">Potencjalna wygrana</div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {formatOdd(successModal.potentialWin)} VB
            </div>
            <div className="mt-1 text-[11px] text-neutral-500">
              Wyliczone jako: stawka × kurs łączny
            </div>
          </div>
        </div>

        <div className="mt-4">
          <button
            onClick={() => setShowTicket((v) => !v)}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm text-neutral-200 transition hover:bg-neutral-800"
          >
            {showTicket ? "Ukryj kupon" : "Zobacz kupon"}
          </button>

          {showTicket ? (
            <div className="mt-3 max-h-[40vh] space-y-2 overflow-auto pr-1">
              {successModal.slipSnapshot.map((it) => {
                const started = isStarted(it.kickoffUtc);
                const labels = formatBetSelectionLabels({
                  market: it.market,
                  pick: it.pick,
                  home: it.home,
                  away: it.away,
                });

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
                      <span className="font-normal text-neutral-400">vs</span>{" "}
                      {it.away}
                    </div>
                    <div className="mt-2 text-sm text-neutral-200">
                      Rynek:{" "}
                      <span className="font-semibold text-neutral-100">
                        {labels.marketLabel}
                      </span>{" "}
                      • Typ:{" "}
                      <span className="font-semibold text-neutral-100">
                        {labels.selectionLabel}
                      </span>
                    </div>

                    {!started ? (
                      <div className="mt-1 text-sm text-neutral-300">
                        Kurs:{" "}
                        <span className="font-semibold text-neutral-100">
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
              setMode(successModal.mode);
              restoreSlip(successModal.slipSnapshot);
              setSuccessModal(null);
            }}
            className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition active:scale-[0.99]"
          >
            Postaw ponownie
          </button>

          <button
            onClick={() => setSuccessModal(null)}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-200 transition hover:bg-neutral-900 active:scale-[0.99]"
          >
            Zamknij okienko
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const slipContent = (
    <div
      className={cx(
        "flex flex-col",
        isDesktop ? "h-full min-h-0" : "space-y-4"
      )}
    >
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

      <div className={cx("shrink-0", isDesktop && "space-y-4")}>
        <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.10),transparent_34%),linear-gradient(135deg,rgba(18,18,18,0.98),rgba(3,3,3,0.99))]">
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                  Bet slip
                </div>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                  Kupon
                </h3>
              </div>

              <div className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs font-semibold text-neutral-300">
                {slip.length} zdarzeń
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 rounded-2xl border border-neutral-800 bg-black/25 p-1">
              {[
                { value: "standard" as BetSlipMode, label: "AKO" },
                { value: "bet_builder" as BetSlipMode, label: "Bet Builder" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => changeMode(option.value)}
                  disabled={submitting}
                  aria-pressed={mode === option.value}
                  className={cx(
                    "rounded-xl px-3 py-2 text-xs font-semibold transition",
                    mode === option.value
                      ? "bg-white text-black"
                      : "text-neutral-400 hover:bg-white/5 hover:text-white",
                    submitting && "cursor-not-allowed opacity-70"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {mode === "bet_builder" ? (
              <div className="mt-3 rounded-2xl border border-sky-500/20 bg-sky-500/10 p-3 text-xs leading-5 text-sky-100">
                Jeden mecz, wiele typów, jeden skorelowany kurs pakietu.
                {builderQuote && !builderQuoteError ? (
                  <span className="mt-1 block text-sky-200/80">
                    Korelacja: {builderQuote.correlationFactor.toFixed(2)}x wobec
                    prostego mnożenia.
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-neutral-800 bg-black/20 p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                  Kurs
                </div>
                <div className="mt-1 text-lg font-semibold text-white">
                  {slip.length && !slipPricingError ? formatOdd(totalOdds) : "—"}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-black/20 p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                  Wygrana
                </div>
                <div className="mt-1 text-lg font-semibold text-white">
                  {potentialWin ? `${formatVB(potentialWin)} VB` : "—"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {hasStarted ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            Masz w kuponie mecz, który już się rozpoczął — usuń go, aby móc postawić
            kupon.
          </div>
        ) : null}

        {slipPricingError ? (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm leading-6 text-amber-100">
            {slipPricingError}
          </div>
        ) : null}
      </div>

      <div
        className={cx(
          "space-y-3",
          isDesktop && "mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
        )}
      >
        {slip.length === 0 ? (
          <div className="rounded-2xl border border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.10),transparent_32%),linear-gradient(135deg,rgba(18,18,18,0.96),rgba(5,5,5,0.99))] p-4 text-sm leading-6 text-neutral-300">
            <div className="font-semibold text-white">Brak zdarzeń</div>
            <div className="mt-1 text-neutral-400">
              Kliknij kurs przy meczu, żeby dodać typ do kuponu.
            </div>
          </div>
        ) : (
          slip.map((it) => {
            const k = keyOf(it);
            const flash = flashKey === k;
            const started = isStarted(it.kickoffUtc);
            const labels = formatBetSelectionLabels({
              market: it.market,
              pick: it.pick,
              home: it.home,
              away: it.away,
            });

            return (
              <div
                key={k}
                className={cx(
                  "rounded-2xl border border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.10),transparent_30%),linear-gradient(135deg,rgba(18,18,18,0.98),rgba(5,5,5,0.99))] p-4 shadow-[0_10px_34px_rgba(0,0,0,0.24)] transition hover:border-neutral-700",
                  flash && "vb-pop ring-2 ring-white/40",
                  started && "opacity-50"
                )}
              >
                <div className="text-xs text-neutral-400">
                  {it.competitionCode || it.league}
                </div>

                <div className="mt-1 text-sm font-semibold">
                  {it.home}{" "}
                  <span className="font-normal text-neutral-400">vs</span>{" "}
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
                      <span className="font-semibold text-neutral-100">
                        {labels.marketLabel}
                      </span>
                    </div>
                    <div>
                      Typ:{" "}
                      <span className="font-semibold text-neutral-100">
                        {labels.selectionLabel}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    {!started ? (
                      <div className="text-sm text-neutral-300">
                        Kurs:{" "}
                        <span className="font-semibold text-neutral-100">
                          {formatOdd(it.odd)}
                        </span>
                      </div>
                    ) : (
                      <div className="text-sm text-neutral-400">Kurs: —</div>
                    )}

                    <button
                      type="button"
                      onClick={() => removeFromSlip(it.matchId, it.market)}
                      disabled={submitting}
                      aria-label={`Usuń z kuponu: ${labels.marketLabel}, ${labels.selectionLabel}`}
                      className={cx(
                        "mt-2 text-xs transition",
                        submitting
                          ? "cursor-not-allowed text-neutral-600"
                          : "text-neutral-400 hover:text-white"
                      )}
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

      <div
        className={cx(
          "shrink-0 space-y-4",
          isDesktop && "border-t border-neutral-800 pt-4"
        )}
      >
        <div className="rounded-2xl border border-sky-500/20 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_32%),linear-gradient(135deg,rgba(8,47,73,0.24),rgba(5,5,5,0.99))] p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-300">Kurs łączny</span>
            <span className="font-semibold">
              {slip.length && !slipPricingError ? formatOdd(totalOdds) : "—"}
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

          <div className="mt-2">
            <div className="relative">
              <input
                value={stakeInput}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d.,\s\u00A0]/g, "");
                  const canonical = raw.replace(/[\s\u00A0]/g, "").replace(",", ".");
                  const formatted = formatStakeInput(raw);

                  setStakeInput(formatted);
                  setStake(canonical);
                }}
                disabled={submitting}
                inputMode="decimal"
                placeholder={`np. ${MIN_STAKE}`}
                className={cx(
                  "w-full rounded-2xl border bg-black/30 px-4 py-3 pr-14 text-sm text-white outline-none transition placeholder:text-neutral-600",
                  submitting && "cursor-not-allowed opacity-70",
                  stakeError
                    ? "border-red-400/60 focus:border-red-300"
                    : "border-neutral-800 focus:border-neutral-600"
                )}
              />

              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
                VB
              </span>
            </div>

            <div className="mt-2 grid grid-cols-4 gap-2">
              {[10, 50, 100, 500].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => addStake(v)}
                  disabled={submitting}
                  className={cx(
                    "rounded-xl border px-2 py-2 text-xs font-semibold transition",
                    submitting
                      ? "cursor-not-allowed border-neutral-900 bg-neutral-950 text-neutral-600"
                      : "border-neutral-800 bg-black/30 text-neutral-300 hover:border-neutral-700 hover:bg-white/5"
                  )}
                >
                  +{v}
                </button>
              ))}
            </div>
          </div>

          {stakeError ? (
            <div className="mt-2 text-xs text-red-300">{stakeError}</div>
          ) : (
            <div className="mt-2 text-xs text-neutral-500">
              Min: {MIN_STAKE} • Max: {MAX_STAKE}
            </div>
          )}
        </div>

        <div className={cx("space-y-2", shake && "vb-shake")}>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className={cx(
              "w-full rounded-xl px-4 py-3 text-sm font-semibold transition",
              canSubmit
              ? "bg-white text-black shadow-[0_12px_34px_rgba(255,255,255,0.10)] hover:bg-neutral-200 active:scale-[0.99]"
              : "cursor-not-allowed bg-neutral-800/80 text-neutral-500"
            )}
          >
            {submitting ? "Stawiam…" : "POSTAW KUPON"}
          </button>

          <button
            type="button"
            onClick={resetSlipState}
            disabled={!slip.length || submitting}
            className={cx(
              "w-full rounded-xl border px-4 py-3 text-sm transition",
              slip.length && !submitting
              ? "border-neutral-800 bg-black/30 text-neutral-200 hover:border-neutral-700 hover:bg-white/5 active:scale-[0.99]"
              : "cursor-not-allowed border-neutral-900 bg-black/20 text-neutral-600"
            )}
          >
            Wyczyść kupon
          </button>

          {submitError ? (
            <div className="text-xs text-red-300">{submitError}</div>
          ) : null}

          <div className="text-xs text-neutral-500">
            Wirtualne zakłady — bez prawdziwych pieniędzy.
          </div>
        </div>
      </div>
    </div>
  );

  const cardWrap = (content: ReactNode, className?: string) => (
    <div
      className={cx(
        "relative overflow-hidden rounded-3xl border border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.10),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.96),rgba(5,5,5,0.99))] shadow-[0_18px_80px_rgba(0,0,0,0.40)]",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-white/30 via-white/10 to-transparent" />
      <div className="relative h-full min-h-0 p-4">{content}</div>
    </div>
  );

  if (isDesktop) {
    return (
      <>
        {successModalNode}
        {errorModalNode}
        <div className="h-full min-h-0">
          {cardWrap(
            slipContent,
            "flex h-full min-h-0 flex-col overflow-hidden"
          )}
        </div>
      </>
    );
  }

  if (isMobile) {
    return (
      <>
        {successModalNode}
        {errorModalNode}

        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.10),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.98),rgba(5,5,5,0.99))] shadow-[0_-18px_60px_rgba(0,0,0,0.45)] backdrop-blur pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-neutral-100">
                Kupon ({slip.length})
              </div>
              <div className="truncate text-xs text-neutral-400">
                Kurs:{" "}
                {slip.length && !slipPricingError ? formatOdd(totalOdds) : "—"} •
                Potencjalna wygrana:{" "}
                {potentialWin != null ? formatVB(potentialWin) : "—"} VB
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={`Otwórz kupon, liczba zdarzeń: ${slip.length}`}
              className="shrink-0 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black transition active:scale-[0.99]"
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
            <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-hidden rounded-t-3xl border border-neutral-800 bg-neutral-950 pb-[env(safe-area-inset-bottom)]">
              <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
                <div className="text-sm font-semibold">Kupon</div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Zamknij kupon"
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-neutral-800"
                >
                  Zamknij
                </button>
              </div>

              <div className="max-h-[calc(85vh-58px)] overflow-y-auto overscroll-contain p-4">
                {slipContent}
              </div>
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
