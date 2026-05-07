// app/(main)/events/[matchId]/MatchMarketsClient.tsx
"use client";

import MatchInsightsSection from "@/components/match/MatchInsightsSection";
import { LeagueIcon } from "@/components/LeagueIcon";
import { formatOdd } from "@/lib/format";
import { formatPolishDateTime, localDateKeyFromISO } from "@/lib/date";
import { supabase } from "@/lib/supabase";
import { useBetSlip } from "@/lib/BetSlipContext";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type OddsRow = {
  match_id: number;
  market_id: string;
  selection: string;
  book_odds: number;
  updated_at: string;
  source?: string | null;
  pricing_method?: string | null;
};

type MatchUI = {
  home: string;
  away: string;
  homeCrest: string | null;
  awayCrest: string | null;
  leagueName: string;
  leagueEmblem: string | null;
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
  source: string | null;
  pricingMethod: string | null;
  isModel: boolean;
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

type LineMarketFamily = {
  key: string;
  label: string;
  sortOrder: number;
};

type MarketDisplayBlock =
  | {
      type: "line";
      key: string;
      label: string;
      sortOrder: number;
      markets: MarketUI[];
    }
  | {
      type: "single";
      key: string;
      sortOrder: number;
      market: MarketUI;
    };

const BETTING_CLOSE_BUFFER_MS = 60_000;
const ESTIMATED_LIVE_AFTER_KICKOFF_MS = 150 * 60 * 1000;
const INTERNAL_FALLBACK_SOURCE = "internal_model";
const INTERNAL_FALLBACK_PRICING_METHOD = "internal_model_fallback";
const NO_ODDS_MESSAGE = "Jeszcze nie ma kursów dla tego meczu.";

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

function isDateParam(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
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

function lineFromMarketId(marketId: string) {
  const underscore = marketId.match(/(?:^|_)(\d+)_(\d+)$/);
  if (underscore) {
    const value = Number(`${underscore[1]}.${underscore[2]}`);
    return {
      value,
      label: `${underscore[1]},${underscore[2]}`,
    };
  }

  const decimal = marketId.match(/(?:^|_)(\d+\.\d+)$/);
  if (decimal) {
    const value = Number(decimal[1]);
    return {
      value,
      label: decimal[1].replace(".", ","),
    };
  }

  return null;
}

function getLineMarketFamily(marketId: string): LineMarketFamily | null {
  if (
    /^(ou|ft_ou)_\d+_\d+$/.test(marketId) ||
    /^ft_total_\d+(?:[._]\d+)?$/.test(marketId)
  ) {
    return {
      key: "full_time_goals",
      label: "Liczba goli w meczu",
      sortOrder: 10,
    };
  }

  if (
    /^home_ou_\d+_\d+$/.test(marketId) ||
    /^ft_home_tg_\d+(?:[._]\d+)?$/.test(marketId)
  ) {
    return { key: "home_goals", label: "Gole gospodarzy", sortOrder: 10 };
  }

  if (
    /^away_ou_\d+_\d+$/.test(marketId) ||
    /^ft_away_tg_\d+(?:[._]\d+)?$/.test(marketId)
  ) {
    return { key: "away_goals", label: "Gole gości", sortOrder: 10 };
  }

  if (/^ht_ou_\d+_\d+$/.test(marketId)) {
    return {
      key: "first_half_goals",
      label: "Gole w 1. połowie",
      sortOrder: 20,
    };
  }

  if (/^ht_home_ou_\d+_\d+$/.test(marketId)) {
    return {
      key: "first_half_home_goals",
      label: "Gole gospodarzy w 1. połowie",
      sortOrder: 30,
    };
  }

  if (/^ht_away_ou_\d+_\d+$/.test(marketId)) {
    return {
      key: "first_half_away_goals",
      label: "Gole gości w 1. połowie",
      sortOrder: 40,
    };
  }

  if (/^(st|sh)_ou_\d+_\d+$/.test(marketId)) {
    return {
      key: "second_half_goals",
      label: "Gole w 2. połowie",
      sortOrder: 20,
    };
  }

  if (/^(st|sh)_home_ou_\d+_\d+$/.test(marketId)) {
    return {
      key: "second_half_home_goals",
      label: "Gole gospodarzy w 2. połowie",
      sortOrder: 30,
    };
  }

  if (/^(st|sh)_away_ou_\d+_\d+$/.test(marketId)) {
    return {
      key: "second_half_away_goals",
      label: "Gole gości w 2. połowie",
      sortOrder: 40,
    };
  }

  return null;
}

function lineHint(marketId: string) {
  const line = lineFromMarketId(marketId);
  if (!line || !Number.isFinite(line.value)) return null;

  const underMax = Math.floor(line.value);
  const overMin = underMax + 1;
  const underLabel = underMax <= 0 ? "0" : `0-${underMax}`;

  return `Powyżej = ${overMin}+ · Poniżej = ${underLabel}`;
}

function formatThresholdCount(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (count === 1) return "1 próg";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} progi`;
  }

  return `${count} progów`;
}

function sortLineMarkets(a: MarketUI, b: MarketUI) {
  const aLine = lineFromMarketId(a.marketId);
  const bLine = lineFromMarketId(b.marketId);
  const aValue = aLine?.value ?? Number.MAX_SAFE_INTEGER;
  const bValue = bLine?.value ?? Number.MAX_SAFE_INTEGER;

  if (aValue !== bValue) return aValue - bValue;
  return a.sortOrder - b.sortOrder;
}

function buildMarketDisplayBlocks(markets: MarketUI[]): MarketDisplayBlock[] {
  const blocks: MarketDisplayBlock[] = [];
  const lineBlocks = new Map<
    string,
    Extract<MarketDisplayBlock, { type: "line" }>
  >();

  for (const market of markets) {
    const family = getLineMarketFamily(market.marketId);

    if (!family) {
      blocks.push({
        type: "single",
        key: market.marketId,
        sortOrder: market.sortOrder,
        market,
      });
      continue;
    }

    const key = `${market.groupKey}__${family.key}`;
    let block = lineBlocks.get(key);

    if (!block) {
      block = {
        type: "line",
        key,
        label: family.label,
        sortOrder: market.sortOrder + family.sortOrder / 100,
        markets: [],
      };
      lineBlocks.set(key, block);
      blocks.push(block);
    }

    block.markets.push(market);
  }

  for (const block of lineBlocks.values()) {
    block.markets.sort(sortLineMarkets);
  }

  return blocks.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.key.localeCompare(b.key);
  });
}

function hasVisibleScore(match: MatchUI) {
  return match.homeScore !== null || match.awayScore !== null;
}

function formatMatchMinute(match: MatchUI) {
  if (match.minute === null) return null;
  if (match.injuryTime !== null && match.injuryTime > 0) {
    return `${match.minute}+${match.injuryTime}'`;
  }
  return `${match.minute}'`;
}

function liveStatusCopy(match: MatchUI, effectiveLive: boolean) {
  const status = String(match.status || "").toUpperCase();

  if (status === "PAUSED") {
    return {
      label: "LIVE",
      title: "Mecz jest na żywo",
      detail: "Spotkanie jest aktualnie wstrzymane albo trwa przerwa.",
    };
  }

  if (effectiveLive) {
    return {
      label: "LIVE",
      title: "Mecz jest na żywo",
      detail:
        "Statystyki, momentum i timeline są teraz najważniejszym kontekstem meczu.",
    };
  }

  return {
    label: "LIVE",
    title: "Mecz jest na żywo",
    detail: "Dane live są odświeżane automatycznie.",
  };
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
          source: row.source ?? null,
          pricingMethod: row.pricing_method ?? null,
          isModel:
            row.source === INTERNAL_FALLBACK_SOURCE &&
            row.pricing_method === INTERNAL_FALLBACK_PRICING_METHOD,
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
  const returnDateQS = sp.get("date") || "";

  const { addToSlip, removeFromSlip, isActivePick } = useBetSlip();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [noOdds, setNoOdds] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [matchUI, setMatchUI] = useState<MatchUI>({
    home: homeNameQS || "Home",
    away: awayNameQS || "Away",
    homeCrest: null,
    awayCrest: null,
    leagueName: competitionCode || "Liga",
    leagueEmblem: null,
    kickoffLocal: kickoffUtcQS ? formatPolishDateTime(kickoffUtcQS) : "",
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
  const [matchCenterOpen, setMatchCenterOpen] = useState(false);

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
  const liveMinute = effectiveIsLive ? formatMatchMinute(matchUI) : null;
  const liveCopy = liveStatusCopy(matchUI, effectiveIsLive);

  const closed = useMemo(() => {
    if (effectiveIsLive || matchUI.isFinished) return true;
    return kickoffIso ? isBettingClosed(kickoffIso, nowMs) : false;
  }, [effectiveIsLive, kickoffIso, nowMs, matchUI.isFinished]);

  useEffect(() => {
    if (effectiveIsLive) {
      setMatchCenterOpen(true);
    }
  }, [effectiveIsLive]);

  const backDate = useMemo(() => {
    if (isDateParam(returnDateQS)) return returnDateQS;

    const source = kickoffIso || kickoffUtcQS;
    if (!source) return "";

    const parsed = Date.parse(source);
    return Number.isFinite(parsed) ? localDateKeyFromISO(source) : "";
  }, [kickoffIso, kickoffUtcQS, returnDateQS]);

  const backHref = backDate
    ? `/events?date=${encodeURIComponent(backDate)}`
    : "/events";

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
      setNoOdds(false);

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
              "home_team, away_team, home_team_id, away_team_id, competition_id, competition_name, utc_date, status, home_score, away_score, minute, injury_time"
            )
            .eq("source", "bsd")
            .eq("id", matchIdNum)
            .maybeSingle(),

          supabase
            .from("odds")
            .select(
              "match_id, market_id, selection, book_odds, updated_at, source, pricing_method"
            )
            .eq("match_id", matchIdNum)
            .or(`source.eq.bsd,source.eq.${INTERNAL_FALLBACK_SOURCE}`)
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
              home_team_id?: number | null;
              away_team_id?: number | null;
              competition_id?: string | null;
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
        const homeTeamId = safeInt(row?.home_team_id);
        const awayTeamId = safeInt(row?.away_team_id);

        const leagueCode = row?.competition_id
          ? String(row.competition_id)
          : competitionCode;

        const leagueName = row?.competition_name
          ? String(row.competition_name)
          : leagueCode || "Liga";

        let leagueEmblem: string | null = null;

        if (leagueCode) {
          const { data: iconLeagueRow, error: iconLeagueError } = await supabase
            .from("icons_leagues")
            .select("icon_url")
            .eq("provider", "bsd")
            .eq("app_code", leagueCode)
            .maybeSingle();

          if (!iconLeagueError) {
            const iconUrl = (
              iconLeagueRow as { icon_url?: string | null } | null
            )?.icon_url;

            leagueEmblem =
              typeof iconUrl === "string" && iconUrl.trim().length > 0
                ? iconUrl.trim()
                : null;
          }
        }

        if (!leagueEmblem && leagueCode) {
          const { data: competitionRow } = await supabase
            .from("competitions")
            .select("emblem")
            .eq("id", leagueCode)
            .maybeSingle();

          const emblem = (competitionRow as { emblem?: string | null } | null)
            ?.emblem;

          leagueEmblem =
            typeof emblem === "string" && emblem.trim().length > 0
              ? emblem.trim()
              : null;
        }

        let homeCrest: string | null = null;
        let awayCrest: string | null = null;
        const teamIds = [homeTeamId, awayTeamId].filter(
          (id): id is number => id !== null
        );

        if (teamIds.length > 0) {
          const { data: iconTeamRows, error: iconTeamError } = await supabase
            .from("icons_teams")
            .select("provider_team_id, icon_url")
            .eq("provider", "bsd")
            .in("provider_team_id", teamIds);

          if (!iconTeamError) {
            for (const team of (iconTeamRows ?? []) as Array<{
              provider_team_id?: number | string | null;
              icon_url?: string | null;
            }>) {
              const id = safeInt(team.provider_team_id);
              const crest =
                typeof team.icon_url === "string" &&
                team.icon_url.trim().length > 0
                  ? team.icon_url.trim()
                  : null;

              if (id !== null && id === homeTeamId) homeCrest = crest;
              if (id !== null && id === awayTeamId) awayCrest = crest;
            }
          }
        }

        const missingTeamIds = teamIds.filter((id) => {
          if (id === homeTeamId && homeCrest) return false;
          if (id === awayTeamId && awayCrest) return false;
          return true;
        });

        if (missingTeamIds.length > 0) {
          const { data: teamRows } = await supabase
            .from("teams")
            .select("id, crest")
            .in("id", missingTeamIds);

          for (const team of (teamRows ?? []) as Array<{
            id?: number | null;
            crest?: string | null;
          }>) {
            const id = safeInt(team.id);
            const crest =
              typeof team.crest === "string" && team.crest.trim().length > 0
                ? team.crest.trim()
                : null;

            if (id !== null && id === homeTeamId) homeCrest = crest;
            if (id !== null && id === awayTeamId) awayCrest = crest;
          }
        }

        const kickoff = row?.utc_date ? String(row.utc_date) : kickoffUtcQS || "";
        const status = row?.status ? String(row.status) : "SCHEDULED";

        const normalizedStatus = status.toUpperCase();
        const isLive =
          normalizedStatus === "LIVE" ||
          normalizedStatus === "IN_PLAY" ||
          normalizedStatus === "PAUSED";
        const isFinished = normalizedStatus === "FINISHED";

        const kickoffLocal = kickoff ? formatPolishDateTime(kickoff) : "";

        if (!cancelled) {
          setMatchUI({
            home,
            away,
            homeCrest,
            awayCrest,
            leagueName,
            leagueEmblem,
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
            setNoOdds(true);
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
      const bySelection = new Map<string, OddsRow>();

      for (const row of oddsRows) {
        const isBsd =
          row.source === "bsd" && row.pricing_method === "bsd_market_normalized";
        const isModel =
          row.source === INTERNAL_FALLBACK_SOURCE &&
          row.pricing_method === INTERNAL_FALLBACK_PRICING_METHOD;

        if (!isBsd && !isModel) continue;

        const key = `${row.market_id}__${row.selection}`;
        const existing = bySelection.get(key);
        if (existing?.source === "bsd" && !isBsd) continue;
        bySelection.set(key, row);
      }

      const filteredOddsRows = Array.from(bySelection.values());

      return groupMarkets(
        filteredOddsRows,
        marketCatalog,
        selectionCatalog,
        matchUI.home,
        matchUI.away
      );
    }, [
    oddsRows,
    marketCatalog,
    selectionCatalog,
    matchUI.home,
    matchUI.away,
  ]);

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
        marketCount: value.markets.length,
        blocks: buildMarketDisplayBlocks(
          value.markets.sort((a, b) => a.sortOrder - b.sortOrder)
        ),
      }))
      .sort((a, b) => a.order - b.order);
  }, [markets]);

  const hasModelMarkets = useMemo(
    () => markets.some((market) => market.selections.some((item) => item.isModel)),
    [markets]
  );

  const renderSelectionButton = (
    market: MarketUI,
    item: MarketSelectionUI,
    compact = false
  ) => {
    const hasOdd =
      typeof item.odd === "number" &&
      Number.isFinite(item.odd) &&
      item.odd >= 1.01;
    const isModelOdd = item.isModel;

    const active = isActivePick(matchId, market.marketId, item.selection);

    return (
      <button
        key={`${market.marketId}__${item.selection}`}
        type="button"
        disabled={!hasOdd || closed}
        aria-pressed={active}
        aria-label={`${market.marketLabel}: ${item.label}, ${
          hasOdd ? `kurs ${formatOdd(item.odd!)}` : "brak kursu"
        }`}
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
          "rounded-2xl border text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400",
          compact ? "min-h-[62px] px-3 py-2.5" : "px-3 py-3",
          !hasOdd || closed
            ? "cursor-not-allowed border-neutral-800 bg-neutral-950 text-neutral-600"
            : active
              ? "border-neutral-200 bg-white text-black"
              : isModelOdd
                ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-100 hover:border-cyan-400/40 hover:bg-cyan-500/15"
                : "border-neutral-800 bg-neutral-950 text-white hover:bg-neutral-800"
        )}
        title={
          !hasOdd
            ? NO_ODDS_MESSAGE
            : closed
              ? "Zakłady zamknięte"
              : active
                ? "Kliknij ponownie, aby usunąć z kuponu"
                : `Kurs: ${formatOdd(item.odd!)}`
        }
      >
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-sm font-medium">{item.label}</div>
          {isModelOdd ? (
            <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-cyan-200">
              model
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-sm font-semibold">
          {hasOdd ? formatOdd(item.odd!) : "—"}
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <section
        className={cn(
          "relative overflow-hidden rounded-[34px] border bg-[#050505]",
          effectiveIsLive
            ? "border-red-400/25 shadow-[0_0_90px_rgba(239,68,68,0.12)]"
            : "border-white/10"
        )}
      >
          <div
            className={cn(
              "pointer-events-none absolute inset-0",
              effectiveIsLive
                ? "bg-[radial-gradient(circle_at_13%_0%,rgba(239,68,68,0.28),transparent_34%),radial-gradient(circle_at_88%_18%,rgba(14,165,233,0.08),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_50%)]"
                : "bg-[radial-gradient(circle_at_14%_0%,rgba(255,255,255,0.11),transparent_34%),radial-gradient(circle_at_88%_18%,rgba(255,255,255,0.045),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_48%)]"
            )}
          />

          {loading ? (
            <div className="relative px-6 py-8 text-neutral-400 sm:px-10 sm:py-10">
              Ładowanie…
            </div>
          ) : (
            <div className="relative px-6 py-5 sm:px-10 sm:py-7 xl:px-12 xl:py-8">
              <div className="flex flex-col gap-5">
                <div>
                  <Link
                    href={backHref}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-sky-400/40 hover:bg-sky-400/10 hover:text-white"
                  >
                    <span aria-hidden="true">←</span>
                    <span>Wstecz</span>
                    {backDate ? (
                      <span className="hidden text-neutral-500 sm:inline">
                        {backDate}
                      </span>
                    ) : null}
                  </Link>
                </div>

                {effectiveIsLive ? (
                  <div className="flex flex-col gap-3 rounded-[24px] border border-red-400/25 bg-red-500/10 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="relative flex size-3 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex size-3 rounded-full bg-red-400" />
                      </span>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-red-300/30 bg-red-400/15 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-red-100">
                            {liveCopy.label}
                          </span>
                          {liveMinute ? (
                            <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs font-bold tabular-nums text-white">
                              {liveMinute}
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-2 text-sm font-semibold text-white">
                          {liveCopy.title}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-red-100/75">
                          {liveCopy.detail}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-left sm:text-right">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
                        Aktualny wynik
                      </div>
                      <div className="mt-1 text-2xl font-black tabular-nums text-white">
                        {matchUI.homeScore ?? 0} : {matchUI.awayScore ?? 0}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                      <LeagueIcon
                        src={matchUI.leagueEmblem}
                        alt={matchUI.leagueName}
                        size={18}
                        fallback={(competitionCode || matchUI.leagueName).slice(0, 4)}
                      />
                    </div>

                    <div className="min-w-0">
                      <div className="text-[11px] font-medium uppercase tracking-[0.28em] text-neutral-500">
                        Rozgrywki
                      </div>

                      <div className="mt-1 truncate text-base font-semibold text-white">
                        {matchUI.leagueName}
                      </div>
                    </div>
                  </div>

                  {matchUI.kickoffLocal ? (
                    <div className="sm:text-right">
                      <div className="text-[11px] font-medium uppercase tracking-[0.28em] text-neutral-500">
                        Data meczu
                      </div>

                      <div className="mt-1 text-base font-semibold text-white">
                        {matchUI.kickoffLocal}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div>
                  <h1 className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 text-[clamp(2rem,2.8vw,3.5rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-white">
                    <span className="inline-flex min-w-0 max-w-full items-center gap-3">
                      <LeagueIcon
                        src={matchUI.homeCrest}
                        alt={matchUI.home}
                        size={34}
                        fallback={matchUI.home.slice(0, 1)}
                        className="rounded-full"
                      />
                      <span className="min-w-0 truncate">{matchUI.home}</span>
                    </span>
                    <span className="font-normal text-neutral-600">vs</span>
                    <span className="inline-flex min-w-0 max-w-full items-center gap-3">
                      <LeagueIcon
                        src={matchUI.awayCrest}
                        alt={matchUI.away}
                        size={34}
                        fallback={matchUI.away.slice(0, 1)}
                        className="rounded-full"
                      />
                      <span className="min-w-0 truncate">{matchUI.away}</span>
                    </span>
                  </h1>

                  {hasVisibleScore(matchUI) && !effectiveIsLive ? (
                    <div className="mt-6 inline-flex items-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-lg font-semibold text-white">
                      {matchUI.homeScore ?? 0} : {matchUI.awayScore ?? 0}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </section>

      <section
        className={cn(
          "overflow-hidden rounded-[28px] border shadow-[0_18px_70px_rgba(0,0,0,0.35)]",
          effectiveIsLive
            ? "border-red-400/25 bg-[linear-gradient(135deg,rgba(239,68,68,0.18),rgba(14,165,233,0.08)_42%,rgba(0,0,0,0.5))]"
            : "border-white/10 bg-[linear-gradient(135deg,rgba(14,165,233,0.12),rgba(255,255,255,0.035)_42%,rgba(0,0,0,0.45))]"
        )}
      >
        <button
          type="button"
          onClick={() => setMatchCenterOpen((open) => !open)}
          className="group flex w-full flex-col gap-4 px-5 py-4 text-left transition hover:bg-white/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-center gap-4">
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-2xl border text-[11px] font-black uppercase tracking-[0.12em] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
                effectiveIsLive
                  ? "border-red-300/30 bg-red-400/15 text-red-100"
                  : "border-sky-400/25 bg-sky-400/10 text-sky-200"
              )}
            >
              {effectiveIsLive ? "ON" : "MC"}
            </div>

            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-300">
                Match Center
              </div>
              <div className="mt-1 text-sm font-semibold text-white">
                {effectiveIsLive
                  ? "Centrum live meczu"
                  : "Centrum danych meczu"}
              </div>
              <div className="mt-1 text-xs leading-5 text-neutral-400">
                {effectiveIsLive
                  ? "Dla meczu live Match Center otwiera się automatycznie. Statystyki, momentum i timeline są pod ręką."
                  : "Info, składy, statystyki, tabela i timeline są ładowane dopiero po rozwinięciu."}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-neutral-300">
                  Dane BSD
                </span>
                <span
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                    effectiveIsLive
                      ? "border-red-300/25 bg-red-400/10 text-red-100"
                      : "border-sky-400/20 bg-sky-400/10 text-sky-200"
                  )}
                >
                  {effectiveIsLive ? "Live data" : "Ładowanie na żądanie"}
                </span>
              </div>
            </div>
          </div>
          <span className="rounded-full border border-white/10 bg-white px-3 py-2 text-xs font-bold text-neutral-950 transition group-hover:bg-sky-100">
            {matchCenterOpen ? "Zwiń" : "Rozwiń"}
          </span>
        </button>

        {matchCenterOpen ? (
          <div className="border-t border-white/10 p-4 sm:p-5">
            <MatchInsightsSection
              matchId={matchId}
              competitionCode={competitionCode || matchUI.leagueName}
              homeTeam={matchUI.home}
              awayTeam={matchUI.away}
              matchStatus={effectiveMatchStatus}
              isLive={effectiveIsLive}
              isFinished={matchUI.isFinished}
            />
          </div>
        ) : null}
      </section>

      {err ? (
        <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          {err}
        </div>
      ) : null}

      {noOdds && !loading ? (
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-300">
          {NO_ODDS_MESSAGE}
        </div>
      ) : null}

      {hasModelMarkets && !loading ? (
        <div className="rounded-3xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-100">
          Kursy modelowe są fallbackiem VirtualBook, bo BSD nie podało kursów dla tych rynków. Są oznaczone osobno i zapisywane do audytu.
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
                {section.marketCount}
              </span>
            </div>

            {section.blocks.map((block) => {
              if (block.type === "line") {
                return (
                  <div
                    key={block.key}
                    className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {block.label}
                        </div>
                      </div>
                      <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[11px] font-semibold text-neutral-300">
                        {formatThresholdCount(block.markets.length)}
                      </span>
                    </div>

                    <div className="mt-3 overflow-hidden rounded-2xl border border-neutral-800">
                      {block.markets.map((market) => {
                        const line = lineFromMarketId(market.marketId);
                        const hint = lineHint(market.marketId);

                        return (
                          <div
                            key={market.marketId}
                            className="grid gap-3 border-t border-neutral-800 p-3 first:border-t-0 sm:grid-cols-[minmax(120px,0.55fr)_1fr] sm:items-center"
                          >
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                                Próg
                              </div>
                              <div className="mt-1 text-base font-semibold text-white">
                                {line ? line.label : market.marketLabel}
                              </div>
                              {hint ? (
                                <div className="mt-1 text-xs text-neutral-500">
                                  {hint}
                                </div>
                              ) : null}
                            </div>

                            <div
                              className={selectionGridClass(
                                market.selections.length
                              )}
                            >
                              {market.selections.map((item) =>
                                renderSelectionButton(market, item, true)
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              const { market } = block;

              return (
                <div
                  key={market.marketId}
                  className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4"
                >
                  <div className="text-sm font-semibold text-white">
                    {market.marketLabel}
                  </div>

                  <div
                    className={`mt-3 ${selectionGridClass(
                      market.selections.length
                    )}`}
                  >
                    {market.selections.map((item) =>
                      renderSelectionButton(market, item)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))
      ) : noOdds ? null : (
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-300">
          {NO_ODDS_MESSAGE}
        </div>
      )}
    </div>
  );
}
