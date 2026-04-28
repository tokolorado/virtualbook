export type SlipPricingItem = {
  matchId?: string | number | null;
  odd?: number | string | null;
  league?: string | null;
  competitionCode?: string | null;
  home?: string | null;
  away?: string | null;
};

export type SameMatchConflict = {
  matchId: string;
  count: number;
  league: string | null;
  home: string | null;
  away: string | null;
};

export type SlipPricingResult =
  | {
      ok: true;
      totalOdds: number;
      conflicts: [];
      code: null;
      message: null;
    }
  | {
      ok: false;
      totalOdds: null;
      conflicts: SameMatchConflict[];
      code: "same_match_correlation";
      message: string;
    };

const SAME_MATCH_MESSAGE =
  "Nie można łączyć kilku typów z tego samego meczu na jednym standardowym kuponie. To są zdarzenia zależne i wymagają osobnego Bet Buildera.";

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

export function normalizeSlipMatchId(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  return text;
}

export function findSameMatchConflicts(
  items: readonly SlipPricingItem[]
): SameMatchConflict[] {
  const byMatch = new Map<string, SameMatchConflict>();

  for (const item of items) {
    const matchId = normalizeSlipMatchId(item.matchId);
    if (!matchId) continue;

    const existing = byMatch.get(matchId);
    if (existing) {
      existing.count += 1;
      continue;
    }

    byMatch.set(matchId, {
      matchId,
      count: 1,
      league: normalizeText(item.competitionCode) ?? normalizeText(item.league),
      home: normalizeText(item.home),
      away: normalizeText(item.away),
    });
  }

  return [...byMatch.values()].filter((entry) => entry.count > 1);
}

export function buildSameMatchConflictMessage(
  conflicts: readonly SameMatchConflict[]
): string {
  if (!conflicts.length) return SAME_MATCH_MESSAGE;

  const names = conflicts
    .map((conflict) => {
      if (conflict.home && conflict.away) {
        return `${conflict.home} vs ${conflict.away}`;
      }
      return `match_id ${conflict.matchId}`;
    })
    .join(", ");

  return `${SAME_MATCH_MESSAGE} Konflikt: ${names}.`;
}

export function priceAccumulatorSlip(
  items: readonly SlipPricingItem[]
): SlipPricingResult {
  const conflicts = findSameMatchConflicts(items);

  if (conflicts.length) {
    return {
      ok: false,
      totalOdds: null,
      conflicts,
      code: "same_match_correlation",
      message: buildSameMatchConflictMessage(conflicts),
    };
  }

  let totalOdds = items.length ? 1 : 0;

  for (const item of items) {
    const odd = Number(item.odd);
    if (!Number.isFinite(odd) || odd <= 1e-9) continue;
    totalOdds *= odd;
  }

  return {
    ok: true,
    totalOdds,
    conflicts: [],
    code: null,
    message: null,
  };
}
