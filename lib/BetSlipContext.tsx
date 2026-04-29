"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

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

export type BetSlipMode = "standard" | "bet_builder";

type BetSlipContextType = {
  slip: SlipItem[];
  stake: string;
  setStake: (v: string) => void;
  mode: BetSlipMode;
  setMode: (mode: BetSlipMode) => void;

  open: boolean;
  setOpen: (v: boolean) => void;
  toggleOpen: () => void;

  addToSlip: (item: SlipItem) => void;
  removeFromSlip: (matchId: string, market: string) => void;
  clearSlip: () => void;

  getItem: (matchId: string, market: string) => SlipItem | undefined;
  isActivePick: (matchId: string, market: string, pick: string) => boolean;
};

const BetSlipContext = createContext<BetSlipContextType | null>(null);

const LS_SLIP = "vb_slip_v2";
const LS_STAKE = "vb_stake_v2";
const LS_OPEN = "vb_slip_open_v1";
const LS_MODE = "vb_slip_mode_v1";

function readSlipFromStorage(): SlipItem[] {
  if (typeof window === "undefined") return [];

  try {
    const rawSlip = window.localStorage.getItem(LS_SLIP);
    if (!rawSlip) return [];

    const parsed: unknown = JSON.parse(rawSlip);
    return Array.isArray(parsed) ? (parsed as SlipItem[]) : [];
  } catch {
    return [];
  }
}

function readStakeFromStorage(): string {
  if (typeof window === "undefined") return "";

  try {
    return window.localStorage.getItem(LS_STAKE) ?? "";
  } catch {
    return "";
  }
}

function readOpenFromStorage(): boolean {
  if (typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem(LS_OPEN) === "1";
  } catch {
    return false;
  }
}

function readModeFromStorage(): BetSlipMode {
  if (typeof window === "undefined") return "standard";

  try {
    return window.localStorage.getItem(LS_MODE) === "bet_builder"
      ? "bet_builder"
      : "standard";
  } catch {
    return "standard";
  }
}

export function BetSlipProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";

  const [slip, setSlip] = useState<SlipItem[]>(readSlipFromStorage);
  const [stake, setStake] = useState<string>(readStakeFromStorage);
  const [open, setOpen] = useState<boolean>(readOpenFromStorage);
  const [mode, setMode] = useState<BetSlipMode>(readModeFromStorage);

  const shouldHideSlip =
    pathname.startsWith("/account") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/wallet");

  const effectiveOpen = open && !shouldHideSlip;

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_SLIP, JSON.stringify(slip));
    } catch {}
  }, [slip]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_STAKE, stake);
    } catch {}
  }, [stake]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_OPEN, open ? "1" : "0");
    } catch {}
  }, [open]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_MODE, mode);
    } catch {}
  }, [mode]);

  const addToSlip = useCallback((item: SlipItem) => {
    setSlip((prev) => {
      const targetMatchId = String(item.matchId);

      const idx = prev.findIndex(
        (x) => x.matchId === item.matchId && x.market === item.market
      );

      if (idx >= 0) {
        const copy = prev.slice();
        copy[idx] = item;
        return copy;
      }

      if (
        mode === "bet_builder" &&
        prev.some((x) => String(x.matchId) !== targetMatchId)
      ) {
        return [item];
      }

      return [...prev, item];
    });

    setOpen(true);
  }, [mode]);

  const removeFromSlip = useCallback((matchId: string, market: string) => {
    setSlip((prev) =>
      prev.filter((x) => !(x.matchId === matchId && x.market === market))
    );
  }, []);

  const clearSlip = useCallback(() => {
    setSlip([]);
  }, []);

  const getItem = useCallback(
    (matchId: string, market: string) =>
      slip.find((x) => x.matchId === matchId && x.market === market),
    [slip]
  );

  const isActivePick = useCallback(
    (matchId: string, market: string, pick: string) => {
      const it = getItem(matchId, market);
      return !!it && it.pick === pick;
    },
    [getItem]
  );

  const toggleOpen = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  const value = useMemo(
    () => ({
      slip,
      stake,
      setStake,
      mode,
      setMode,
      open: effectiveOpen,
      setOpen,
      toggleOpen,
      addToSlip,
      removeFromSlip,
      clearSlip,
      getItem,
      isActivePick,
    }),
    [
      slip,
      stake,
      mode,
      effectiveOpen,
      toggleOpen,
      addToSlip,
      removeFromSlip,
      clearSlip,
      getItem,
      isActivePick,
    ]
  );

  return (
    <BetSlipContext.Provider value={value}>{children}</BetSlipContext.Provider>
  );
}

export function useBetSlip() {
  const ctx = useContext(BetSlipContext);
  if (!ctx) throw new Error("useBetSlip must be used inside BetSlipProvider");
  return ctx;
}
