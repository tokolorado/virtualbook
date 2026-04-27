export type BetLabelInput = {
  market: string | null | undefined;
  pick: string | null | undefined;
  home?: string | null;
  away?: string | null;
};

const MARKET_LABELS: Record<string, string> = {
  "1x2": "1X2",
  ft_1x2: "1X2",
  dc: "Podwójna szansa",
  ht_dc: "Podwójna szansa 1. połowa",
  dnb: "Zakład bez remisu",
  btts: "Obie drużyny strzelą",
  ht_1x2: "Wynik 1. połowy",
  st_1x2: "Wynik 2. połowy",
  sh_1x2: "Wynik 2. połowy",
  ht_btts: "Obie drużyny strzelą w 1. połowie",
  st_btts: "Obie drużyny strzelą w 2. połowie",
  odd_even: "Parzysta/Nieparzysta liczba goli",
  exact_score: "Dokładny wynik",
  ft_total_exact: "Dokładna liczba goli",
  home_win_to_nil: "Gospodarze wygrają do zera",
  away_win_to_nil: "Goście wygrają do zera",
  clean_sheet_home: "Czyste konto gospodarzy",
  clean_sheet_away: "Czyste konto gości",
};

function normalizeMarket(market: BetLabelInput["market"]) {
  return String(market ?? "").trim().toLowerCase();
}

function cleanTeam(value: string | null | undefined, fallback: string) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function prettifyUnknown(value: string | null | undefined, fallback: string) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!cleaned) return fallback;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatLineToken(raw: string | null | undefined) {
  if (!raw) return null;

  const normalized = raw.trim().replace("_", ".").replace(",", ".");
  const match = normalized.match(/^(\d+)(?:\.(\d+))?$/);

  if (!match) return raw.replace(".", ",").replace("_", ",");
  return `${match[1]},${match[2] ?? "0"}`;
}

function lineFromMarket(marketId: string) {
  const decimal = marketId.match(/(?:^|_)(\d+\.\d+)$/);
  if (decimal) return formatLineToken(decimal[1]);

  const underscore = marketId.match(/(?:^|_)(\d+)_(\d+)$/);
  if (underscore) return `${underscore[1]},${underscore[2]}`;

  return null;
}

function lineFromPick(pick: string) {
  const match = pick.match(/(\d+(?:[.,_]\d+)?)/);
  return match ? formatLineToken(match[1]) : null;
}

function isFullTimeOverUnder(marketId: string) {
  return (
    /^ou_\d+_\d+$/.test(marketId) ||
    /^ft_ou_\d+_\d+$/.test(marketId) ||
    /^ft_total_\d+(?:[._]\d+)?$/.test(marketId)
  );
}

function isHomeOverUnder(marketId: string) {
  return /^home_ou_\d+_\d+$/.test(marketId) || /^ft_home_tg_\d+(?:[._]\d+)?$/.test(marketId);
}

function isAwayOverUnder(marketId: string) {
  return /^away_ou_\d+_\d+$/.test(marketId) || /^ft_away_tg_\d+(?:[._]\d+)?$/.test(marketId);
}

function isFirstHalfOverUnder(marketId: string) {
  return /^ht_ou_\d+_\d+$/.test(marketId);
}

function isSecondHalfOverUnder(marketId: string) {
  return /^(st|sh)_ou_\d+_\d+$/.test(marketId);
}

function isFirstHalfHomeOverUnder(marketId: string) {
  return /^ht_home_ou_\d+_\d+$/.test(marketId);
}

function isFirstHalfAwayOverUnder(marketId: string) {
  return /^ht_away_ou_\d+_\d+$/.test(marketId);
}

function isOverUnderMarket(marketId: string) {
  return (
    isFullTimeOverUnder(marketId) ||
    isHomeOverUnder(marketId) ||
    isAwayOverUnder(marketId) ||
    isFirstHalfOverUnder(marketId) ||
    isSecondHalfOverUnder(marketId) ||
    isFirstHalfHomeOverUnder(marketId) ||
    isFirstHalfAwayOverUnder(marketId)
  );
}

function isOutcomeMarket(marketId: string) {
  return ["1x2", "ft_1x2", "ht_1x2", "st_1x2", "sh_1x2", "dnb"].includes(
    marketId
  );
}

function isDoubleChanceMarket(marketId: string) {
  return marketId === "dc" || marketId === "ht_dc";
}

function formatOutcomePick(pickUpper: string, home: string, away: string) {
  if (pickUpper === "1") return home;
  if (pickUpper === "X") return "Remis";
  if (pickUpper === "2") return away;
  return null;
}

function formatDoubleChancePick(pickUpper: string, home: string, away: string) {
  if (pickUpper === "1X") return `${home} lub remis`;
  if (pickUpper === "12") return `${home} lub ${away}`;
  if (pickUpper === "X2") return `Remis lub ${away}`;
  return null;
}

function formatOverUnderPick(pick: string, line: string | null) {
  const lower = pick.toLowerCase();
  const pickLine = line ?? lineFromPick(pick);

  if (lower === "over" || lower.startsWith("over ")) {
    return pickLine ? `Powyżej ${pickLine}` : "Powyżej";
  }

  if (lower === "under" || lower.startsWith("under ")) {
    return pickLine ? `Poniżej ${pickLine}` : "Poniżej";
  }

  return null;
}

function formatScorePick(pick: string) {
  const lower = pick.toLowerCase();
  if (lower === "other") return "Inny wynik";

  const normalized = pick.replace(/[_-]/g, ":");
  return /^\d+:\d+$/.test(normalized) ? normalized : null;
}

export function formatMarketLabel(market: BetLabelInput["market"]) {
  const marketId = normalizeMarket(market);
  if (!marketId) return "Rynek";

  if (MARKET_LABELS[marketId]) return MARKET_LABELS[marketId];
  if (isFullTimeOverUnder(marketId)) return "Liczba goli";
  if (isHomeOverUnder(marketId)) return "Gole gospodarzy";
  if (isAwayOverUnder(marketId)) return "Gole gości";
  if (isFirstHalfOverUnder(marketId)) return "Gole w 1. połowie";
  if (isSecondHalfOverUnder(marketId)) return "Gole w 2. połowie";
  if (isFirstHalfHomeOverUnder(marketId)) {
    return "Gole gospodarzy w 1. połowie";
  }
  if (isFirstHalfAwayOverUnder(marketId)) return "Gole gości w 1. połowie";

  return prettifyUnknown(market, "Rynek");
}

export function formatSelectionLabel(input: BetLabelInput) {
  const marketId = normalizeMarket(input.market);
  const rawPick = String(input.pick ?? "").trim();

  if (!rawPick) return "Typ";

  const home = cleanTeam(input.home, "Gospodarze");
  const away = cleanTeam(input.away, "Goście");
  const pickUpper = rawPick.toUpperCase();
  const pickLower = rawPick.toLowerCase();
  const line = lineFromMarket(marketId);

  if (isDoubleChanceMarket(marketId)) {
    const label = formatDoubleChancePick(pickUpper, home, away);
    if (label) return label;
  }

  if (isOutcomeMarket(marketId)) {
    const label = formatOutcomePick(pickUpper, home, away);
    if (label) return label;
  }

  if (isOverUnderMarket(marketId)) {
    const label = formatOverUnderPick(rawPick, line);
    if (label) return label;
  }

  if (marketId === "exact_score") {
    const label = formatScorePick(rawPick);
    if (label) return label;
  }

  if (marketId === "ft_total_exact") {
    return rawPick.toLowerCase() === "other" ? "Inna liczba goli" : rawPick;
  }

  if (marketId === "odd_even") {
    if (pickLower === "even") return "Parzysta";
    if (pickLower === "odd") return "Nieparzysta";
  }

  if (pickLower === "yes") return "Tak";
  if (pickLower === "no") return "Nie";

  const overUnderLabel = formatOverUnderPick(rawPick, line);
  if (overUnderLabel) return overUnderLabel;

  const outcomeLabel = formatOutcomePick(pickUpper, home, away);
  if (outcomeLabel) return outcomeLabel;

  const scoreLabel = formatScorePick(rawPick);
  if (scoreLabel) return scoreLabel;

  return prettifyUnknown(rawPick, "Typ");
}

export function formatBetSelectionLabels(input: BetLabelInput) {
  return {
    marketLabel: formatMarketLabel(input.market),
    selectionLabel: formatSelectionLabel(input),
  };
}
