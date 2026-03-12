//app/(main)/events/[matchId]/MatchMarketsClient.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBetSlip } from "@/lib/BetSlipContext";

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
  status: string;
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

    dnb: {
    groupKey: "main",
    groupLabel: "Główne",
    groupOrder: 10,
    marketLabel: "Draw No Bet",
    sortOrder: 25,
  },
  ht_dc: {
    groupKey: "first_half",
    groupLabel: "1. połowa",
    groupOrder: 50,
    marketLabel: "Podwójna szansa 1. połowa",
    sortOrder: 15,
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
  st_btts: {
    groupKey: "second_half",
    groupLabel: "2. połowa",
    groupOrder: 60,
    marketLabel: "Obie strzelą w 2. połowie",
    sortOrder: 30,
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
  st_ou_0_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  st_ou_1_5: {
    over: { labelTemplate: "Powyżej", sortOrder: 10 },
    under: { labelTemplate: "Poniżej", sortOrder: 20 },
  },
  odd_even: {
    even: { labelTemplate: "Parzysta", sortOrder: 10 },
    odd: { labelTemplate: "Nieparzysta", sortOrder: 20 },
  },
    dnb: {
    "1": { labelTemplate: "{HOME}", sortOrder: 10 },
    "2": { labelTemplate: "{AWAY}", sortOrder: 20 },
  },
  ht_dc: {
    "1X": { labelTemplate: "{HOME} lub remis", sortOrder: 10 },
    "12": { labelTemplate: "{HOME} lub {AWAY}", sortOrder: 20 },
    X2: { labelTemplate: "Remis lub {AWAY}", sortOrder: 30 },
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
  st_btts: {
    yes: { labelTemplate: "Tak", sortOrder: 10 },
    no: { labelTemplate: "Nie", sortOrder: 20 },
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

  const [matchUI, setMatchUI] = useState<MatchUI>({
    home: homeNameQS || "Home",
    away: awayNameQS || "Away",
    leagueName: competitionCode || "Liga",
    kickoffLocal: kickoffUtcQS ? new Date(kickoffUtcQS).toLocaleString() : "",
    status: "SCHEDULED",
  });

  const [kickoffIso, setKickoffIso] = useState<string>(kickoffUtcQS || "");
  const [oddsRows, setOddsRows] = useState<OddsRow[]>([]);
  const [marketCatalog, setMarketCatalog] = useState<MarketCatalogRow[]>([]);
  const [selectionCatalog, setSelectionCatalog] = useState<MarketSelectionCatalogRow[]>([]);

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const closed = useMemo(() => {
    return kickoffIso ? isBettingClosed(kickoffIso, nowMs) : false;
  }, [kickoffIso, nowMs]);

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
        const [{ data: mRow, error: mErr }, { data: oRows, error: oErr }] =
          await Promise.all([
            supabase
              .from("matches")
              .select("home_team, away_team, competition_name, utc_date, status")
              .eq("id", matchIdNum)
              .maybeSingle(),
            supabase
              .from("odds")
              .select("match_id, market_id, selection, book_odds, updated_at")
              .eq("match_id", matchIdNum)
              .order("market_id", { ascending: true })
              .order("selection", { ascending: true }),
          ]);

        if (mErr) {
          // fallback below
        }

        if (oErr) {
          throw new Error(`Nie udało się pobrać kursów z bazy: ${oErr.message}`);
        }

        let marketRows: MarketCatalogRow[] = [];
        let selectionRows: MarketSelectionCatalogRow[] = [];

        // optional metadata tables — if missing, fallback labels still work
        try {
          const [{ data: marketData }, { data: selectionData }] = await Promise.all([
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
              .select("market_id, selection_key, label_template, short_label, sort_order")
              .order("market_id", { ascending: true })
              .order("sort_order", { ascending: true }),
          ]);

          marketRows = (marketData ?? []) as MarketCatalogRow[];
          selectionRows = (selectionData ?? []) as MarketSelectionCatalogRow[];
        } catch {
          marketRows = [];
          selectionRows = [];
        }

        const home = (mRow as any)?.home_team
          ? String((mRow as any).home_team)
          : homeNameQS || "Home";
        const away = (mRow as any)?.away_team
          ? String((mRow as any).away_team)
          : awayNameQS || "Away";
        const leagueName = (mRow as any)?.competition_name
          ? String((mRow as any).competition_name)
          : competitionCode || "Liga";
        const kickoff = (mRow as any)?.utc_date
          ? String((mRow as any).utc_date)
          : kickoffUtcQS || "";
        const status = (mRow as any)?.status
          ? String((mRow as any).status)
          : "SCHEDULED";

        const kickoffLocal = kickoff ? new Date(kickoff).toLocaleString() : "";

        if (!cancelled) {
          setMatchUI({ home, away, leagueName, kickoffLocal, status });
          setKickoffIso(kickoff);
          setOddsRows((oRows ?? []) as OddsRow[]);
          setMarketCatalog(marketRows);
          setSelectionCatalog(selectionRows);
        }

        if (!oRows || oRows.length === 0) {
          if (!cancelled) {
            setErr("Brak kursów w bazie dla tego meczu.");
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

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        {loading ? (
          <div className="text-neutral-400">Ładowanie…</div>
        ) : (
          <>
            <div className="text-xs text-neutral-400 flex items-center justify-between gap-2">
              <span>
                {matchUI.leagueName} • {matchUI.kickoffLocal}
              </span>

              {matchUI.status && String(matchUI.status).toUpperCase() === "FINISHED" ? (
                <span className="text-[11px] px-2 py-1 rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-300">
                  Zakończony
                </span>
              ) : closed ? (
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

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-neutral-300">
                Rynki: <span className="font-semibold text-white">{markets.length}</span>
              </span>

              <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-neutral-300">
                Selekcje:{" "}
                <span className="font-semibold text-white">{oddsRows.length}</span>
              </span>

              {oddsUpdatedAt ? (
                <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-neutral-500">
                  Aktualizacja kursów: {oddsUpdatedAt}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>

      {err ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          {err}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="animate-pulse rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4"
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
              <h3 className="text-sm font-semibold text-neutral-100">{section.label}</h3>
              <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[11px] font-semibold text-neutral-300">
                {section.markets.length}
              </span>
            </div>

            {section.markets.map((market) => (
              <div
                key={market.marketId}
                className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4"
              >
                <div className="text-sm font-semibold">{market.marketLabel}</div>

                <div className={`mt-3 ${selectionGridClass(market.selections.length)}`}>
                  {market.selections.map((item) => {
                    const hasOdd =
                      typeof item.odd === "number" &&
                      Number.isFinite(item.odd) &&
                      item.odd > 0;

                    const active = isActivePick(matchId, market.marketId, item.selection);

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
                        className={[
                          "rounded-xl border px-3 py-2 text-left transition",
                          !hasOdd || closed
                            ? "border-neutral-800 bg-neutral-950 text-neutral-600 cursor-not-allowed"
                            : active
                              ? "border-neutral-200 bg-white text-black"
                              : "border-neutral-800 bg-neutral-950 hover:bg-neutral-800",
                        ].join(" ")}
                        title={
                          !hasOdd
                            ? "Brak kursu w bazie"
                            : closed
                              ? "Zakłady zamknięte"
                              : active
                                ? "Kliknij ponownie, aby usunąć z kuponu"
                                : `Kurs: ${format2(item.odd!)}`
                        }
                      >
                        <div className="text-sm font-medium truncate">{item.label}</div>
                        <div className="mt-1 text-sm font-semibold">
                          {hasOdd ? format2(item.odd!) : "—"}
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
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-300">
          Brak aktywnych rynków w bazie dla tego meczu.
        </div>
      )}
    </div>
  );
}