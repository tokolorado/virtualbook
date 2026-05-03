// lib/odds/labels.ts

export type BetSelectionLabelsInput = {
  market?: string | null;
  pick?: string | null;
  home?: string | null;
  away?: string | null;
};

export type BetSelectionLabels = {
  marketLabel: string;
  selectionLabel: string;
  label: string;
};

function clean(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

function normalizeSelection(value: unknown): string {
  return clean(value).toLowerCase();
}

function normalizeMarket(value: unknown): string {
  return clean(value).toLowerCase();
}

function teamName(value: unknown, fallback: string): string {
  return clean(value, fallback);
}

function marketLabel(market: string): string {
  const map: Record<string, string> = {
    "1x2": "1X2",
    dc: "Podwójna szansa",
    dnb: "Draw No Bet",
    btts: "Obie strzelą",
    ou_1_5: "Powyżej/Poniżej 1.5",
    ou_2_5: "Powyżej/Poniżej 2.5",
    ou_3_5: "Powyżej/Poniżej 3.5",
    home_ou_0_5: "Gole gospodarzy 0.5",
    home_ou_1_5: "Gole gospodarzy 1.5",
    home_ou_2_5: "Gole gospodarzy 2.5",
    away_ou_0_5: "Gole gości 0.5",
    away_ou_1_5: "Gole gości 1.5",
    away_ou_2_5: "Gole gości 2.5",
    ht_1x2: "Wynik 1. połowy",
    ht_dc: "Podwójna szansa 1. połowa",
    ht_ou_0_5: "Gole w 1. połowie 0.5",
    ht_ou_1_5: "Gole w 1. połowie 1.5",
    ht_btts: "Obie strzelą w 1. połowie",
    ht_home_ou_0_5: "Gole gospodarzy w 1. połowie 0.5",
    ht_home_ou_1_5: "Gole gospodarzy w 1. połowie 1.5",
    ht_away_ou_0_5: "Gole gości w 1. połowie 0.5",
    ht_away_ou_1_5: "Gole gości w 1. połowie 1.5",
    st_1x2: "Wynik 2. połowy",
    st_ou_0_5: "Gole w 2. połowie 0.5",
    st_ou_1_5: "Gole w 2. połowie 1.5",
    st_btts: "Obie strzelą w 2. połowie",
    odd_even: "Parzysta/Nieparzysta liczba goli",
    exact_score: "Dokładny wynik",
    home_win_to_nil: "Gospodarze wygrają do zera",
    away_win_to_nil: "Goście wygrają do zera",
    clean_sheet_home: "Gospodarze zachowają czyste konto",
    clean_sheet_away: "Goście zachowają czyste konto",
  };

  return map[market] ?? market;
}

function selectionLabel(args: {
  market: string;
  pick: string;
  home: string;
  away: string;
}): string {
  const { market, pick, home, away } = args;

  if (market === "1x2" || market === "ht_1x2" || market === "st_1x2") {
    if (pick === "1") return home;
    if (pick === "x") return "Remis";
    if (pick === "2") return away;
  }

  if (market === "dc" || market === "ht_dc") {
    if (pick === "1x") return `${home} lub remis`;
    if (pick === "12") return `${home} lub ${away}`;
    if (pick === "x2") return `Remis lub ${away}`;
  }

  if (market === "dnb") {
    if (pick === "1") return home;
    if (pick === "2") return away;
  }

  if (
    market === "btts" ||
    market === "ht_btts" ||
    market === "st_btts" ||
    market === "home_win_to_nil" ||
    market === "away_win_to_nil" ||
    market === "clean_sheet_home" ||
    market === "clean_sheet_away"
  ) {
    if (pick === "yes") return "Tak";
    if (pick === "no") return "Nie";
  }

  if (
    market.includes("_ou_") ||
    market === "ou_1_5" ||
    market === "ou_2_5" ||
    market === "ou_3_5" ||
    market === "ht_ou_0_5" ||
    market === "ht_ou_1_5" ||
    market === "st_ou_0_5" ||
    market === "st_ou_1_5"
  ) {
    if (pick === "over") return "Powyżej";
    if (pick === "under") return "Poniżej";
  }

  if (market === "odd_even") {
    if (pick === "even") return "Parzysta";
    if (pick === "odd") return "Nieparzysta";
  }

  if (market === "exact_score") {
    if (pick === "other") return "Inny wynik";
    return pick;
  }

  if (pick === "x") return "X";
  if (pick === "yes") return "Tak";
  if (pick === "no") return "Nie";
  if (pick === "over") return "Powyżej";
  if (pick === "under") return "Poniżej";

  return pick || "—";
}

export function formatBetSelectionLabels(
  input: BetSelectionLabelsInput
): BetSelectionLabels {
  const market = normalizeMarket(input.market);
  const pick = normalizeSelection(input.pick);
  const home = teamName(input.home, "Gospodarze");
  const away = teamName(input.away, "Goście");

  const resolvedMarketLabel = marketLabel(market);
  const resolvedSelectionLabel = selectionLabel({
    market,
    pick,
    home,
    away,
  });

  return {
    marketLabel: resolvedMarketLabel,
    selectionLabel: resolvedSelectionLabel,
    label: `${resolvedMarketLabel}: ${resolvedSelectionLabel}`,
  };
}

export function formatBetSelectionLabel(input: BetSelectionLabelsInput): string {
  return formatBetSelectionLabels(input).label;
}