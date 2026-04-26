// app/(main)/events/[matchId]/MatchMarketsClient.tsx
"use client";

import MatchInsightsSection from "@/components/match/MatchInsightsSection";
import { formatOdd } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useBetSlip } from "@/lib/BetSlipContext";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type OddsRow = {
  match_id: number;
  market_id: string;
  selection: string;
  book_odds: number;
  updated_at: string;
  engine_version?: string | null;
};

type MatchUI = {
  home: string;
  away: string;
  leagueName: string;
  kickoffLocal: string;
  status: string;
  isLive: boolean;
  isFinished: boolean;
  homeScore: number | null;
  awayScore: number | null;
  minute: number | null;
  injuryTime: number | null;
};

type MarketCatalogRow = {
  market_id: string;
  group_key: string;
  group_label: string;
  group_order: number;
  market_label: string;
  sort_order: number;
  enabled: boolean;
};

type MarketSelectionCatalogRow = {
  market_id: string;
  selection_key: string;
  label_template: string;
  short_label: string | null;
  sort_order: number;
};

type MarketSelectionUI = {
  selection: string;
  label: string;
  odd: number | null;
  sortOrder: number;
};

type MarketUI = {
  marketId: string;
  groupKey: string;
  groupLabel: string;
  groupOrder: number;
  marketLabel: string;
  sortOrder: number;
  selections: MarketSelectionUI[];
};

const BETTING_CLOSE_BUFFER_MS = 60_000;
const ESTIMATED_LIVE_AFTER_KICKOFF_MS = 150 * 60 * 1000;

const FALLBACK_MARKETS: Record<
  string,
  {
    groupKey: string;
    groupLabel: string;
    groupOrder: number;
    marketLabel: string;
    sortOrder: number;
  }
> = {
  "1x2": {
    groupKey: "main",
    groupLabel: "Główne",
    groupOrder: 10,
    marketLabel: "1X2",
    sortOrder: 10,
  },
  dc: {
    groupKey: "main",
    groupLabel: "Główne",
    groupOrder: 10,
    marketLabel: "Podwójna szansa",
    sortOrder: 20,
  },
  dnb: {
    groupKey: "main",
    groupLabel: "Główne",
    groupOrder: 10,
    marketLabel: "Draw No Bet",
    sortOrder: 25,
  },
  btts: {
    groupKey: "main",
    groupLabel: "Główne",
    groupOrder: 10,
    marketLabel: "Obie strzelą",
    sortOrder: 30,
  },
  ou_1_5: {
    groupKey: "goals",
    groupLabel: "Liczba goli",
    groupOrder: 20,
    marketLabel: "Powyżej/Poniżej 1.5",
    sortOrder: 10,
  },
  ou_2_5: {
    groupKey: "goals",
    groupLabel: "Liczba goli",
    groupOrder: 20,
    marketLabel: "Powyżej/Poniżej 2.5",
    sortOrder: 20,
  },
  ou_3_5: {
    groupKey: "goals",
    groupLabel: "Liczba goli",
    groupOrder: 20,
    marketLabel: "Powyżej/Poniżej 3.5",
    sortOrder: 30,
  },
  home_ou_0_5: {
    groupKey: "home_goals",
    groupLabel: "Gole gospodarzy",
    groupOrder: 30,
    marketLabel: "Gole gospodarzy 0.5",
    sortOrder: 10,
  },
  home_ou_1_5: {
    groupKey: "home_goals",
    groupLabel: "Gole gospodarzy",
    groupOrder: 30,
    marketLabel: "Gole gospodarzy 1.5",
    sortOrder: 20,
  },
  home_ou_2_5: {
    groupKey: "home_goals",
    groupLabel: "Gole gospodarzy",
    groupOrder: 30,
    marketLabel: "Gole gospodarzy 2.5",
    sortOrder: 30,
  },
  away_ou_0_5: {
    groupKey: "away_goals",
    groupLabel: "Gole gości",
    groupOrder: 40,
    marketLabel: "Gole gości 0.5",
    sortOrder: 10,
  },
  away_ou_1_5: {
    groupKey: "away_goals",
    groupLabel: "Gole gości",
    groupOrder: 40,
    marketLabel: "Gole gości 1.5",
    sortOrder: 20,
  },
  away_ou_2_5: {
    groupKey: "away_goals",
    groupLabel: "Gole gości",
    groupOrder: 40,
    marketLabel: "Gole gości 2.5",
    sortOrder: 30,
  },
  ht_1x2: {
    groupKey: "first_half",
    groupLabel: "1. połowa",
    groupOrder: 50,
    marketLabel: "Wynik 1. połowy",
    sortOrder: 10,
  },
  ht_dc: {
    groupKey: "first_half",
    groupLabel: "1. połowa",
    groupOrder: 50,
    marketLabel: "Podwójna szansa 1. połowa",
    sortOrder: 15,
  },
  ht_ou_0_5: {
    groupKey: "first_half",
    groupLabel: "1. połowa",
    groupOrder: 50,
    marketLabel: "Gole w 1. połowie 0.5",
    sortOrder: 20,
  },
  ht_ou_1_5: {
    groupKey: "first_half",
    groupLabel: "1. połowa",
    groupOrder: 50,
    marketLabel: "Gole w 1. połowie 1.5",
    sortOrder: 30,
  },
  ht_btts: {
    groupKey: "first_half",
    groupLabel: "1. połowa",
    groupOrder: 50,
    marketLabel: "Obie strzelą w 1. połowie",
    sortOrder: 40,
  },
  ht_home_ou_0_5: {
    groupKey: "first_half",
    groupLabel: "1. połowa",
    groupOrder: 50,
    marketLabel: "Gole gospodarzy w 1. połowie 0.5",
    sortOrder: 50,
  },
  ht_home_ou_1_5: {
    groupKey: "first_half",
    groupLabel: "1. połowa",
    groupOrder: 50,
    marketLabel: "Gole gospodarzy w 1. połowie 1.5",
    sortOrder: 60,
  },
  ht_away_ou_0_5: {
    groupKey: "first_half",
    groupLabel: "1. połowa",
    groupOrder: 50,
    marketLabel: "Gole gości w 1. połowie 0.5",
    sortOrder: 70,
  },
  ht_away_ou_1_5: {
    groupKey: "first_half",
    groupLabel: "1. połowa",
    groupOrder: 50,
    marketLabel: "Gole gości w 1. połowie 1.5",
    sortOrder: 80,
  },
  st_1x2: {
    groupKey: "second_half",
    groupLabel: "2. połowa",
    groupOrder: 60,
    marketLabel: "Wynik 2. połowy",
    sortOrder: 5,
  },
  st_ou_0_5: {
    groupKey: "second_half",
    groupLabel: "2. połowa",
    groupOrder: 60,
    marketLabel: "Gole w 2. połowie 0.5",
    sortOrder: 10,
  },
  st_ou_1_5: {
    groupKey: "second_half",
    groupLabel: "2. połowa",
    groupOrder: 60,
    marketLabel: "Gole w 2. połowie 1.5",
    sortOrder: 20,
  },
  st_btts: {
    groupKey: "second_half",
    groupLabel: "2. połowa",
    groupOrder: 60,
    marketLabel: "Obie strzelą w 2. połowie",
    sortOrder: 30,
  },
  odd_even: {
    groupKey: "extras",
    groupLabel: "Dodatkowe",
    groupOrder: 70,
    marketLabel: "Parzysta/Nieparzysta liczba goli",
    sortOrder: 10,
  },
  exact_score: {
    groupKey: "extras",
    groupLabel: "Dodatkowe",
    groupOrder: 70,
    marketLabel: "Dokładny wynik",
    sortOrder: 20,
  },
  home_win_to_nil: {
    groupKey: "extras",
    groupLabel: "Dodatkowe",
    groupOrder: 70,
    marketLabel: "Gospodarze wygrają do zera",
    sortOrder: 30,
  },
  away_win_to_nil: {
    groupKey: "extras",
    groupLabel: "Dodatkowe",
    groupOrder: 70,
    marketLabel: "Goście wygrają do zera",
    sortOrder: 40,
  },
  clean_sheet_home: {
    groupKey: "extras",
    groupLabel: "Dodatkowe",
    groupOrder: 70,
    marketLabel: "Gospodarze zachowają czyste konto",
    sortOrder: 50,
  },
  clean_sheet_away: {
    groupKey: "extras",
    groupLabel: "Dodatkowe",
    groupOrder: 70,
    marketLabel: "Goście zachowają czyste konto",
    sortOrder: 60,
  },
};

const FALLBACK_SELECTIONS: Record<
  string,
  Record<string, { labelTemplate: string; sortOrder: number }>
> = {
  "1x2": {
    "1": { labelTemplate: "{HOME}", sortOrder: 10 },
    X: { labelTemplate: "Remis", sortOrder: 20 },
    "2": { labelTemplate: "{AWAY}", sortOrder: 30 },
  },
  dc: {
    "1X": { labelTemplate: "{HOME} lub remis", sortOrder: 10 },
    "12": { labelTemplate: "{HOME} lub {AWAY}", sortOrder: 20 },
    X2: { labelTemplate: "Remis lub {AWAY}", sortOrder: 30 },
  },
  dnb: {
    "1": { labelTemplate: "{HOME}", sortOrder: 10 },
    "2": { labelTemplate: "{AWAY}", sortOrder: 20 },
  },
  btts: {
    yes: { labelTemplate: "Tak", sortOrder: 10 },
    no: { labelTemplate: "Nie", sortOrder: 20 },
  },
  ou_1_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  ou_2_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  ou_3_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  home_ou_0_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  home_ou_1_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  home_ou_2_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  away_ou_0_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  away_ou_1_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  away_ou_2_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  ht_1x2: {
    "1": { labelTemplate: "{HOME}", sortOrder: 10 },
    X: { labelTemplate: "Remis", sortOrder: 20 },
    "2": { labelTemplate: "{AWAY}", sortOrder: 30 },
  },
  ht_dc: {
    "1X": { labelTemplate: "{HOME} lub remis", sortOrder: 10 },
    "12": { labelTemplate: "{HOME} lub {AWAY}", sortOrder: 20 },
    X2: { labelTemplate: "Remis lub {AWAY}", sortOrder: 30 },
  },
  ht_ou_0_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  ht_ou_1_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  ht_btts: {
    yes: { labelTemplate: "Tak", sortOrder: 10 },
    no: { labelTemplate: "Nie", sortOrder: 20 },
  },
  ht_home_ou_0_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  ht_home_ou_1_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  ht_away_ou_0_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  ht_away_ou_1_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  st_1x2: {
    "1": { labelTemplate: "{HOME}", sortOrder: 10 },
    X: { labelTemplate: "Remis", sortOrder: 20 },
    "2": { labelTemplate: "{AWAY}", sortOrder: 30 },
  },
  st_ou_0_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  st_ou_1_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  st_btts: {
    yes: { labelTemplate: "Tak", sortOrder: 10 },
    no: { labelTemplate: "Nie", sortOrder: 20 },
  },
  odd_even: {
    even: { labelTemplate: "Parzysta", sortOrder: 10 },
    odd: { labelTemplate: "Nieparzysta", sortOrder: 20 },
  },
  home_win_to_nil: {
    yes: { labelTemplate: "Tak", sortOrder: 10 },
    no: { labelTemplate: "Nie", sortOrder: 20 },
  },
  away_win_to_nil: {
    yes: { labelTemplate: "Tak", sortOrder: 10 },
    no: { labelTemplate: "Nie", sortOrder: 20 },
  },
  clean_sheet_home: {
    yes: { labelTemplate: "Tak", sortOrder: 10 },
    no: { labelTemplate: "Nie", sortOrder: 20 },
  },
  clean_sheet_away: {
    yes: { labelTemplate: "Tak", sortOrder: 10 },
    no: { labelTemplate: "Nie", sortOrder: 20 },
  },
  exact_score: {
    "0:0": { labelTemplate: "0:0", sortOrder: 10 },
    "1:0": { labelTemplate: "1:0", sortOrder: 20 },
    "2:0": { labelTemplate: "2:0", sortOrder: 30 },
    "2:1": { labelTemplate: "2:1", sortOrder: 40 },
    "1:1": { labelTemplate: "1:1", sortOrder: 50 },
    "0:1": { labelTemplate: "0:1", sortOrder: 60 },
    "0:2": { labelTemplate: "0:2", sortOrder: 70 },
    "1:2": { labelTemplate: "1:2", sortOrder: 80 },
    "3:0": { labelTemplate: "3:0", sortOrder: 90 },
    "3:1": { labelTemplate: "3:1", sortOrder: 100 },
    "2:2": { labelTemplate: "2:2", sortOrder: 110 },
    "1:3": { labelTemplate: "1:3", sortOrder: 120 },
    "0:3": { labelTemplate: "0:3", sortOrder: 130 },
    "3:2": { labelTemplate: "3:2", sortOrder: 140 },
    "2:3": { labelTemplate: "2:3", sortOrder: 150 },
    other: { labelTemplate: "Inny wynik", sortOrder: 999 },
  },
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function safeNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;

  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function isBettingClosed(kickoffUtc: string, nowMs: number) {
  const t = Date.parse(kickoffUtc);
  if (!Number.isFinite(t)) return false;
  return nowMs >= t - BETTING_CLOSE_BUFFER_MS;
}

function isLiveStatus(status?: string | null) {
  const s = String(status || "").toUpperCase();
  return s === "LIVE" || s === "IN_PLAY" || s === "PAUSED";
}

function isNonLiveTerminalStatus(status?: string | null) {
  const s = String(status || "").toUpperCase();

  return (
    s === "FINISHED" ||
    s === "CANCELED" ||
    s === "CANCELLED" ||
    s === "POSTPONED" ||
    s === "SUSPENDED" ||
    s === "AWARDED"
  );
}

function isEffectivelyLiveByClock(args: {
  status?: string | null;
  kickoffUtc?: string | null;
  explicitLive?: boolean;
  explicitFinished?: boolean;
  nowMs: number;
}) {
  if (args.explicitFinished) return false;
  if (args.explicitLive) return true;

  const status = String(args.status || "").toUpperCase();

  if (isLiveStatus(status)) return true;
  if (isNonLiveTerminalStatus(status)) return false;

  const canEstimateLive =
    status === "TIMED" ||
    status === "SCHEDULED" ||
    status === "PRE_MATCH" ||
    status === "NOT_STARTED";

  if (!canEstimateLive) return false;

  const kickoffTs = Date.parse(String(args.kickoffUtc || ""));
  if (!Number.isFinite(kickoffTs)) return false;

  return (
    args.nowMs >= kickoffTs &&
    args.nowMs <= kickoffTs + ESTIMATED_LIVE_AFTER_KICKOFF_MS
  );
}

function estimateLiveMinute(kickoffUtc: string, nowMs: number): number | null {
  const kickoffTs = Date.parse(kickoffUtc);
  if (!Number.isFinite(kickoffTs)) return null;

  const elapsed = Math.floor((nowMs - kickoffTs) / 60_000) + 1;
  if (elapsed < 1) return null;

  if (elapsed <= 45) return elapsed;
  if (elapsed <= 60) return 45;

  const secondHalfMinute = elapsed - 15;
  if (secondHalfMinute <= 90) return Math.max(46, secondHalfMinute);

  return 90;
}

function formatLiveClock(args: {
  match: MatchUI;
  kickoffIso: string;
  nowMs: number;
  effectiveIsLive: boolean;
}) {
  if (!args.effectiveIsLive) return null;

  const minute =
    typeof args.match.minute === "number" &&
    Number.isFinite(args.match.minute) &&
    args.match.minute >= 0
      ? args.match.minute
      : estimateLiveMinute(args.kickoffIso, args.nowMs);

  if (minute === null) return null;

  const injuryTime =
    typeof args.match.injuryTime === "number" &&
    Number.isFinite(args.match.injuryTime) &&
    args.match.injuryTime > 0
      ? args.match.injuryTime
      : null;

  if (injuryTime !== null) return `${minute}+${injuryTime}'`;
  return `${minute}'`;
}

function resolveTemplate(template: string, home: string, away: string) {
  return template.replaceAll("{HOME}", home).replaceAll("{AWAY}", away);
}

function resolveSelectionLabel(
  marketId: string,
  selection: string,
  home: string,
  away: string,
  selectionMeta?: MarketSelectionCatalogRow
) {
  const template =
    selectionMeta?.label_template ??
    FALLBACK_SELECTIONS[marketId]?.[selection]?.labelTemplate ??
    selection;

  return resolveTemplate(template, home, away);
}

function selectionSortOrder(
  marketId: string,
  selection: string,
  selectionMeta?: MarketSelectionCatalogRow
) {
  return (
    selectionMeta?.sort_order ??
    FALLBACK_SELECTIONS[marketId]?.[selection]?.sortOrder ??
    999
  );
}

function selectionGridClass(count: number) {
  if (count <= 2) return "grid grid-cols-2 gap-2";
  if (count === 3) return "grid grid-cols-3 gap-2";
  if (count === 4) return "grid grid-cols-2 sm:grid-cols-4 gap-2";
  return "grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2";
}

function hasVisibleScore(match: MatchUI) {
  return match.homeScore !== null || match.awayScore !== null;
}

function groupMarkets(
  oddsRows: OddsRow[],
  marketCatalog: MarketCatalogRow[],
  selectionCatalog: MarketSelectionCatalogRow[],
  home: string,
  away: string
) {
  const marketMetaMap = new Map<string, MarketCatalogRow>();
  const selectionMetaMap = new Map<string, MarketSelectionCatalogRow>();

  for (const row of marketCatalog) {
    marketMetaMap.set(row.market_id, row);
  }

  for (const row of selectionCatalog) {
    selectionMetaMap.set(`${row.market_id}__${row.selection_key}`, row);
  }

  const byMarket = new Map<string, OddsRow[]>();

  for (const row of oddsRows) {
    const list = byMarket.get(row.market_id) ?? [];
    list.push(row);
    byMarket.set(row.market_id, list);
  }

  const markets: MarketUI[] = [];

  for (const [marketId, rows] of byMarket.entries()) {
    const marketMeta = marketMetaMap.get(marketId);
    const fallbackMeta = FALLBACK_MARKETS[marketId];

    const groupKey = marketMeta?.group_key ?? fallbackMeta?.groupKey ?? "other";
    const groupLabel =
      marketMeta?.group_label ?? fallbackMeta?.groupLabel ?? "Pozostałe";
    const groupOrder =
      marketMeta?.group_order ?? fallbackMeta?.groupOrder ?? 999;
    const marketLabel =
      marketMeta?.market_label ?? fallbackMeta?.marketLabel ?? marketId;
    const sortOrder = marketMeta?.sort_order ?? fallbackMeta?.sortOrder ?? 999;

    const selections: MarketSelectionUI[] = rows
      .map((row) => {
        const meta = selectionMetaMap.get(`${row.market_id}__${row.selection}`);
        return {
          selection: row.selection,
          label: resolveSelectionLabel(marketId, row.selection, home, away, meta),
          odd: safeNum(row.book_odds),
          sortOrder: selectionSortOrder(marketId, row.selection, meta),
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);

    markets.push({
      marketId,
      groupKey,
      groupLabel,
      groupOrder,
      marketLabel,
      sortOrder,
      selections,
    });
  }

  return markets.sort((a, b) => {
    if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.marketLabel.localeCompare(b.marketLabel);
  });
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
  const [refreshKey, setRefreshKey] = useState(0);

  const [matchUI, setMatchUI] = useState<MatchUI>({
    home: homeNameQS || "Home",
    away: awayNameQS || "Away",
    leagueName: competitionCode || "Liga",
    kickoffLocal: kickoffUtcQS ? new Date(kickoffUtcQS).toLocaleString() : "",
    status: "SCHEDULED",
    isLive: false,
    isFinished: false,
    homeScore: null,
    awayScore: null,
    minute: null,
    injuryTime: null,
  });

  const [kickoffIso, setKickoffIso] = useState<string>(kickoffUtcQS || "");
  const [oddsRows, setOddsRows] = useState<OddsRow[]>([]);
  const [marketCatalog, setMarketCatalog] = useState<MarketCatalogRow[]>([]);
  const [selectionCatalog, setSelectionCatalog] = useState<
    MarketSelectionCatalogRow[]
  >([]);

  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const effectiveIsLive = useMemo(() => {
    return isEffectivelyLiveByClock({
      status: matchUI.status,
      kickoffUtc: kickoffIso,
      explicitLive: matchUI.isLive,
      explicitFinished: matchUI.isFinished,
      nowMs,
    });
  }, [
    kickoffIso,
    matchUI.isFinished,
    matchUI.isLive,
    matchUI.status,
    nowMs,
  ]);

  const effectiveMatchStatus = effectiveIsLive ? "LIVE" : matchUI.status;
  const liveClockLabel = useMemo(() => {
    return formatLiveClock({
      match: matchUI,
      kickoffIso,
      nowMs,
      effectiveIsLive,
    });
  }, [effectiveIsLive, kickoffIso, matchUI, nowMs]);

  const closed = useMemo(() => {
    if (effectiveIsLive || matchUI.isFinished) return true;
    return kickoffIso ? isBettingClosed(kickoffIso, nowMs) : false;
  }, [effectiveIsLive, kickoffIso, nowMs, matchUI.isFinished]);

  const shouldAutoRefreshMatch = useMemo(() => {
    const status = String(matchUI.status || "").toUpperCase();
    if (status === "FINISHED") return false;
    if (!kickoffIso) return false;

    const kickoffTs = Date.parse(kickoffIso);
    if (!Number.isFinite(kickoffTs)) return true;

    return (
      nowMs >= kickoffTs - 2 * 60 * 60 * 1000 &&
      nowMs <= kickoffTs + 4 * 60 * 60 * 1000
    );
  }, [matchUI.status, kickoffIso, nowMs]);

  useEffect(() => {
    if (!shouldAutoRefreshMatch) return;

    const id = window.setInterval(() => {
      setRefreshKey((v) => v + 1);
    }, 20_000);

    return () => window.clearInterval(id);
  }, [shouldAutoRefreshMatch]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (refreshKey === 0) {
        setLoading(true);
      }
      setErr(null);

      const matchIdNum = safeNum(matchId);
      if (matchIdNum == null) {
        setErr("Nieprawidłowy matchId.");
        setLoading(false);
        return;
      }

      try {
        const [
          { data: mRow, error: mErr },
          { data: oRows, error: oErr },
          { data: marketData, error: marketErr },
          { data: selectionData, error: selectionErr },
        ] = await Promise.all([
          supabase
            .from("matches")
            .select(
              "home_team, away_team, competition_name, utc_date, status, home_score, away_score, minute, injury_time"
            )
            .eq("id", matchIdNum)
            .maybeSingle(),

          supabase
            .from("odds")
            .select(
              "match_id, market_id, selection, book_odds, updated_at, engine_version"
            )
            .eq("match_id", matchIdNum)
            .order("market_id", { ascending: true })
            .order("selection", { ascending: true }),

          supabase
            .from("market_catalog")
            .select(
              "market_id, group_key, group_label, group_order, market_label, sort_order, enabled"
            )
            .eq("enabled", true)
            .order("group_order", { ascending: true })
            .order("sort_order", { ascending: true }),

          supabase
            .from("market_selection_catalog")
            .select(
              "market_id, selection_key, label_template, short_label, sort_order"
            )
            .order("market_id", { ascending: true })
            .order("sort_order", { ascending: true }),
        ]);

        if (mErr) {
          throw new Error(`Nie udało się pobrać meczu: ${mErr.message}`);
        }

        if (oErr) {
          throw new Error(`Nie udało się pobrać kursów z bazy: ${oErr.message}`);
        }

        if (marketErr) {
          throw new Error(
            `Nie udało się pobrać katalogu rynków: ${marketErr.message}`
          );
        }

        if (selectionErr) {
          throw new Error(
            `Nie udało się pobrać katalogu selekcji: ${selectionErr.message}`
          );
        }

        const row = (mRow ?? null) as
          | {
              home_team?: string | null;
              away_team?: string | null;
              competition_name?: string | null;
              utc_date?: string | null;
              status?: string | null;
              home_score?: number | null;
              away_score?: number | null;
              minute?: number | null;
              injury_time?: number | null;
            }
          | null;

        const home = row?.home_team ? String(row.home_team) : homeNameQS || "Home";
        const away = row?.away_team ? String(row.away_team) : awayNameQS || "Away";
        const leagueName = row?.competition_name
          ? String(row.competition_name)
          : competitionCode || "Liga";
        const kickoff = row?.utc_date ? String(row.utc_date) : kickoffUtcQS || "";
        const status = row?.status ? String(row.status) : "SCHEDULED";

        const normalizedStatus = status.toUpperCase();
        const isLive =
          normalizedStatus === "LIVE" ||
          normalizedStatus === "IN_PLAY" ||
          normalizedStatus === "PAUSED";
        const isFinished = normalizedStatus === "FINISHED";

        const kickoffLocal = kickoff ? new Date(kickoff).toLocaleString() : "";

        if (!cancelled) {
          setMatchUI({
            home,
            away,
            leagueName,
            kickoffLocal,
            status,
            isLive,
            isFinished,
            homeScore:
              typeof row?.home_score === "number" ? row.home_score : null,
            awayScore:
              typeof row?.away_score === "number" ? row.away_score : null,
            minute: safeInt(row?.minute),
            injuryTime: safeInt(row?.injury_time),
          });
          setKickoffIso(kickoff);
          setOddsRows((oRows ?? []) as OddsRow[]);
          setMarketCatalog((marketData ?? []) as MarketCatalogRow[]);
          setSelectionCatalog(
            (selectionData ?? []) as MarketSelectionCatalogRow[]
          );
        }

        if (!oRows || oRows.length === 0) {
          if (!cancelled) {
            setErr("Brak kursów w bazie dla tego meczu.");
          }
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Błąd pobierania kursów.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    matchId,
    competitionCode,
    kickoffUtcQS,
    homeNameQS,
    awayNameQS,
    refreshKey,
  ]);

  const markets = useMemo(() => {
    return groupMarkets(
      oddsRows,
      marketCatalog,
      selectionCatalog,
      matchUI.home,
      matchUI.away
    );
  }, [oddsRows, marketCatalog, selectionCatalog, matchUI.home, matchUI.away]);

  const groupedSections = useMemo(() => {
    const groups = new Map<
      string,
      { label: string; order: number; markets: MarketUI[] }
    >();

    for (const market of markets) {
      const existing = groups.get(market.groupKey);
      if (existing) {
        existing.markets.push(market);
      } else {
        groups.set(market.groupKey, {
          label: market.groupLabel,
          order: market.groupOrder,
          markets: [market],
        });
      }
    }

    return Array.from(groups.entries())
      .map(([key, value]) => ({
        key,
        label: value.label,
        order: value.order,
        markets: value.markets.sort((a, b) => a.sortOrder - b.sortOrder),
      }))
      .sort((a, b) => a.order - b.order);
  }, [markets]);

  const oddsUpdatedAt = useMemo(() => {
    if (!oddsRows.length) return null;

    const latest = oddsRows
      .map((r) => Date.parse(r.updated_at))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];

    return Number.isFinite(latest) ? new Date(latest).toLocaleString() : null;
  }, [oddsRows]);

  const engineVersionLabel = useMemo(() => {
    const versions = Array.from(
      new Set(
        oddsRows
          .map((row) => row.engine_version)
          .filter(
            (v): v is string => typeof v === "string" && v.trim().length > 0
          )
      )
    );

    if (!versions.length) return null;
    return versions.join(", ");
  }, [oddsRows]);

  const statusPill = useMemo(() => {
    if (effectiveIsLive) {
      return (
        <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-300">
          LIVE
        </span>
      );
    }

    if (matchUI.isFinished) {
      return (
        <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs font-semibold text-neutral-300">
          Zakończony
        </span>
      );
    }

    if (closed) {
      return (
        <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs font-semibold text-yellow-300">
          Zakłady zamknięte
        </span>
      );
    }

    return (
      <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs font-semibold text-neutral-300">
        Pre-match
      </span>
    );
  }, [closed, effectiveIsLive, matchUI.isFinished]);

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-5 sm:p-6">
        {loading ? (
          <div className="text-neutral-400">Ładowanie…</div>
        ) : (
          <>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                  {matchUI.leagueName}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {statusPill}

                  {liveClockLabel ? (
                    <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-300">
                      {liveClockLabel}
                    </span>
                  ) : null}

                  {matchUI.kickoffLocal ? (
                    <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-300">
                      {matchUI.kickoffLocal}
                    </span>
                  ) : null}

                  {oddsUpdatedAt ? (
                    <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-500">
                      Kursy: {oddsUpdatedAt}
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 text-2xl font-semibold leading-tight text-white sm:text-3xl">
                  {matchUI.home}{" "}
                  <span className="font-normal text-neutral-500">vs</span>{" "}
                  {matchUI.away}
                </div>

                {hasVisibleScore(matchUI) ? (
                  <div className="mt-4 inline-flex items-center rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-lg font-semibold text-white">
                    {matchUI.homeScore ?? 0} : {matchUI.awayScore ?? 0}
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:w-[340px]">
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Rynki
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {markets.length}
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Selekcje
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {oddsRows.length}
                  </div>
                </div>

                <div className="col-span-2 rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4 sm:col-span-1">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Silnik
                  </div>
                  <div className="mt-2 break-words text-sm font-semibold text-white">
                    {engineVersionLabel ?? "—"}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      <MatchInsightsSection
        matchId={matchId}
        competitionCode={competitionCode}
        homeTeam={matchUI.home}
        awayTeam={matchUI.away}
        matchStatus={effectiveMatchStatus}
        isLive={effectiveIsLive}
        isFinished={matchUI.isFinished}
      />

      {err ? (
        <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          {err}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="animate-pulse rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4"
            >
              <div className="h-4 w-40 rounded bg-neutral-800" />
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
                <div className="h-12 rounded-xl bg-neutral-800" />
                <div className="h-12 rounded-xl bg-neutral-800" />
                <div className="h-12 rounded-xl bg-neutral-800" />
              </div>
            </div>
          ))}
        </div>
      ) : groupedSections.length > 0 ? (
        groupedSections.map((section) => (
          <div key={section.key} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-neutral-100">
                {section.label}
              </h3>
              <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[11px] font-semibold text-neutral-300">
                {section.markets.length}
              </span>
            </div>

            {section.markets.map((market) => (
              <div
                key={market.marketId}
                className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4"
              >
                <div className="text-sm font-semibold text-white">
                  {market.marketLabel}
                </div>

                <div className={`mt-3 ${selectionGridClass(market.selections.length)}`}>
                  {market.selections.map((item) => {
                    const hasOdd =
                      typeof item.odd === "number" &&
                      Number.isFinite(item.odd) &&
                      item.odd > 0;

                    const active = isActivePick(
                      matchId,
                      market.marketId,
                      item.selection
                    );

                    return (
                      <button
                        key={`${market.marketId}__${item.selection}`}
                        disabled={!hasOdd || closed}
                        onClick={() => {
                          if (!hasOdd || closed) return;

                          if (active) {
                            removeFromSlip(matchId, market.marketId);
                            return;
                          }

                          addToSlip({
                            matchId,
                            competitionCode,
                            league: matchUI.leagueName,
                            home: matchUI.home,
                            away: matchUI.away,
                            market: market.marketId,
                            pick: item.selection,
                            odd: item.odd!,
                            kickoffUtc: kickoffIso || null,
                          });
                        }}
                        className={cn(
                          "rounded-2xl border px-3 py-3 text-left transition",
                          !hasOdd || closed
                            ? "cursor-not-allowed border-neutral-800 bg-neutral-950 text-neutral-600"
                            : active
                              ? "border-neutral-200 bg-white text-black"
                              : "border-neutral-800 bg-neutral-950 text-white hover:bg-neutral-800"
                        )}
                        title={
                          !hasOdd
                            ? "Brak kursu w bazie"
                            : closed
                              ? "Zakłady zamknięte"
                              : active
                                ? "Kliknij ponownie, aby usunąć z kuponu"
                                : `Kurs: ${formatOdd(item.odd!)}`
                        }
                      >
                        <div className="truncate text-sm font-medium">
                          {item.label}
                        </div>
                        <div className="mt-1 text-sm font-semibold">
                          {hasOdd ? formatOdd(item.odd!) : "—"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))
      ) : (
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-300">
          Brak aktywnych rynków w bazie dla tego meczu.
        </div>
      )}
    </div>
  );
}