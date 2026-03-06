"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type SlipItem = {
  matchId: string;
  competitionCode: string;
  league: string;
  home: string;
  away: string;
  market: string; // np. "1X2", "Over/Under 2.5"
  pick: string; // np. "1", "X", "2", "Over 2.5"
  odd: number;
  kickoffUtc?: string | null;
};

type BetSlipContextType = {
  slip: SlipItem[];
  stake: string;
  setStake: (v: string) => void;

  // ✅ Mobile drawer open/close (używane przez BetSlip)
  open: boolean;
  setOpen: (v: boolean) => void;
  toggleOpen: () => void;

  addToSlip: (item: SlipItem) => void;
  removeFromSlip: (matchId: string, market: string) => void;
  clearSlip: () => void;

  // helpers for UI highlighting
  getItem: (matchId: string, market: string) => SlipItem | undefined;
  isActivePick: (matchId: string, market: string, pick: string) => boolean;
};

const BetSlipContext = createContext<BetSlipContextType | null>(null);

const LS_SLIP = "vb_slip_v2";
const LS_STAKE = "vb_stake_v2";
const LS_OPEN = "vb_slip_open_v1";

export function BetSlipProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const [slip, setSlip] = useState<SlipItem[]>([]);
  const [stake, setStake] = useState<string>("");

  // ✅ drawer open state (ważne na mobile)
  const [open, setOpen] = useState<boolean>(false);

  // load from localStorage once
  useEffect(() => {
    try {
      const rawSlip = localStorage.getItem(LS_SLIP);
      const rawStake = localStorage.getItem(LS_STAKE);
      const rawOpen = localStorage.getItem(LS_OPEN);

      if (rawSlip) {
        const parsed = JSON.parse(rawSlip);
        if (Array.isArray(parsed)) setSlip(parsed);
      }
      if (rawStake != null) setStake(rawStake);

      if (rawOpen != null) setOpen(rawOpen === "1");
    } catch {
      // ignore
    }
  }, []);

  // persist slip
  useEffect(() => {
    try {
      localStorage.setItem(LS_SLIP, JSON.stringify(slip));
    } catch {}
  }, [slip]);

  // persist stake
  useEffect(() => {
    try {
      localStorage.setItem(LS_STAKE, stake);
    } catch {}
  }, [stake]);

  // persist open
  useEffect(() => {
    try {
      localStorage.setItem(LS_OPEN, open ? "1" : "0");
    } catch {}
  }, [open]);

  // ✅ auto-close slip na stronach bez kuponu
  useEffect(() => {
    if (!pathname) return;

    if (
      pathname.startsWith("/account") ||
      pathname.startsWith("/admin") ||
      pathname.startsWith("/wallet")
    ) {
      setOpen(false);
    }
  }, [pathname]);

  const addToSlip = (item: SlipItem) => {
    setSlip((prev) => {
      const idx = prev.findIndex((x) => x.matchId === item.matchId && x.market === item.market);
      if (idx >= 0) {
        const copy = prev.slice();
        copy[idx] = item; // replace same match+market
        return copy;
      }
      return [...prev, item];
    });

    // ✅ UX: jak user doda typ, otwórz slip na mobile
    setOpen(true);
  };

  const removeFromSlip = (matchId: string, market: string) => {
    setSlip((prev) => prev.filter((x) => !(x.matchId === matchId && x.market === market)));
  };

  const clearSlip = () => setSlip([]);

  const getItem = (matchId: string, market: string) =>
    slip.find((x) => x.matchId === matchId && x.market === market);

  const isActivePick = (matchId: string, market: string, pick: string) => {
    const it = getItem(matchId, market);
    return !!it && it.pick === pick;
  };

  const toggleOpen = () => setOpen((v) => !v);

  const value = useMemo(
    () => ({
      slip,
      stake,
      setStake,
      open,
      setOpen,
      toggleOpen,
      addToSlip,
      removeFromSlip,
      clearSlip,
      getItem,
      isActivePick,
    }),
    [slip, stake, open]
  );

  return <BetSlipContext.Provider value={value}>{children}</BetSlipContext.Provider>;
}

export function useBetSlip() {
  const ctx = useContext(BetSlipContext);
  if (!ctx) throw new Error("useBetSlip must be used inside BetSlipProvider");
  return ctx;
}