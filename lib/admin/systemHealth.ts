import type { SupabaseClient } from "@supabase/supabase-js";

export type SystemHealthParams = {
  staleHours: number;
  limit: number;
};

export type SystemHealthMetrics = {
  stuckMatches: number;
  finishedMatchesWithUnsettledItems: number;
  pendingButAllItemsSettled: number;
  missingPayoutLedger: number;
};

type HealthMatchRow = {
  id: number | string | null;
  status: string | null;
  utc_date: string | null;
  last_sync_at: string | null;
  competition_id: string | null;
  home_score: number | string | null;
  away_score: number | string | null;
};

type UnfinishedBetItemRow = {
  id: string | number | null;
  bet_id: string | null;
  match_id_bigint: number | string | null;
  result: string | null;
  settled: boolean | null;
  kickoff_at: string | null;
};

type PendingBetRow = {
  id: string;
  status: string | null;
  settled: boolean | null;
  created_at: string | null;
  user_id: string | null;
  stake: number | string | null;
  payout: number | string | null;
};

type PendingBetItemRow = {
  bet_id: string | null;
  settled: boolean | null;
  result: string | null;
};

type SettledBetRow = {
  id: string;
  user_id: string | null;
  status: string | null;
  settled: boolean | null;
  payout: number | string | null;
  settled_at: string | null;
};

type PayoutLedgerRow = {
  ref_id: string | null;
  kind: string | null;
};

export type SystemHealthSamples = {
  stuckMatches: HealthMatchRow[];
  finishedMatchesWithUnsettledItems: Array<{
    match: HealthMatchRow | null;
    items: UnfinishedBetItemRow[];
  }>;
  pendingButAllItemsSettled: PendingBetRow[];
  missingPayoutLedger: SettledBetRow[];
};

export type SystemHealthResult = {
  params: SystemHealthParams;
  metrics: SystemHealthMetrics;
  samples: SystemHealthSamples;
};

const DEFAULT_STALE_HOURS = 3;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampFiniteNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function parseSystemHealthParams(url: URL): SystemHealthParams {
  return {
    staleHours: clampFiniteNumber(
      url.searchParams.get("staleHours"),
      DEFAULT_STALE_HOURS,
      1,
      48
    ),
    limit: Math.trunc(
      clampFiniteNumber(url.searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT)
    ),
  };
}

function rowsOf<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function uniqueFiniteNumbers(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map(toFiniteNumber)
        .filter((value): value is number => value !== null)
    )
  );
}

function isResolvedItem(row: PendingBetItemRow) {
  const result = String(row.result ?? "").toLowerCase();
  return row.settled === true && (result === "won" || result === "lost" || result === "void");
}

export async function getSystemHealth(
  supabase: SupabaseClient,
  params: SystemHealthParams
): Promise<SystemHealthResult> {
  const limit = Math.trunc(clampFiniteNumber(params.limit, DEFAULT_LIMIT, 1, MAX_LIMIT));
  const staleHours = clampFiniteNumber(
    params.staleHours,
    DEFAULT_STALE_HOURS,
    1,
    48
  );

  const { data: stuckCandidatesRaw, error: stuckErr } = await supabase
    .from("matches")
    .select("id,status,utc_date,last_sync_at,competition_id,home_score,away_score")
    .eq("source", "bsd")
    .in("status", ["IN_PLAY", "PAUSED"])
    .order("utc_date", { ascending: true })
    .limit(Math.max(limit * 4, 200));

  if (stuckErr) throw new Error(stuckErr.message);

  const now = Date.now();
  const staleMs = staleHours * 60 * 60 * 1000;
  const stuckMatches = rowsOf<HealthMatchRow>(stuckCandidatesRaw)
    .filter((match) => {
      const kickoff = match.utc_date ? new Date(match.utc_date).getTime() : 0;
      return kickoff > 0 && now - kickoff > staleMs;
    })
    .slice(0, limit);

  const { data: unfinishedItemsRaw, error: unfinishedErr } = await supabase
    .from("bet_items")
    .select("id,bet_id,match_id_bigint,result,settled,kickoff_at")
    .or("result.is.null,settled.eq.false")
    .not("match_id_bigint", "is", null)
    .limit(Math.max(limit * 6, 300));

  if (unfinishedErr) throw new Error(unfinishedErr.message);

  const unfinishedItems = rowsOf<UnfinishedBetItemRow>(unfinishedItemsRaw);
  const matchIdsFromItems = uniqueFiniteNumbers(
    unfinishedItems.map((row) => row.match_id_bigint)
  ).slice(0, 400);

  let finishedMatchesWithUnsettledItems: SystemHealthSamples["finishedMatchesWithUnsettledItems"] =
    [];

  if (matchIdsFromItems.length > 0) {
    const { data: finishedMatchesRaw, error: finishedErr } = await supabase
      .from("matches")
      .select("id,status,utc_date,last_sync_at,competition_id,home_score,away_score")
      .eq("source", "bsd")
      .in("id", matchIdsFromItems)
      .eq("status", "FINISHED");

    if (finishedErr) throw new Error(finishedErr.message);

    const finishedMatches = rowsOf<HealthMatchRow>(finishedMatchesRaw);
    const finishedSet = new Set(
      finishedMatches
        .map((match) => toFiniteNumber(match.id))
        .filter((id): id is number => id !== null)
    );
    const mapByMatch = new Map<
      number,
      { match: HealthMatchRow | null; items: UnfinishedBetItemRow[] }
    >();

    for (const item of unfinishedItems) {
      const matchId = toFiniteNumber(item.match_id_bigint);
      if (matchId === null || !finishedSet.has(matchId)) continue;

      if (!mapByMatch.has(matchId)) {
        const match =
          finishedMatches.find((row) => toFiniteNumber(row.id) === matchId) ?? null;
        mapByMatch.set(matchId, { match, items: [] });
      }

      mapByMatch.get(matchId)?.items.push(item);
    }

    finishedMatchesWithUnsettledItems = Array.from(mapByMatch.values()).slice(
      0,
      limit
    );
  }

  const { data: recentPendingBetsRaw, error: pendingErr } = await supabase
    .from("bets")
    .select("id,status,settled,created_at,user_id,stake,payout")
    .eq("settled", false)
    .in("status", ["pending"])
    .order("created_at", { ascending: false })
    .limit(Math.max(limit * 6, 300));

  if (pendingErr) throw new Error(pendingErr.message);

  const recentPendingBets = rowsOf<PendingBetRow>(recentPendingBetsRaw);
  const pendingBetIds = recentPendingBets.map((bet) => bet.id).filter(Boolean);
  let pendingButAllItemsSettled: PendingBetRow[] = [];

  if (pendingBetIds.length > 0) {
    const { data: itemsForPendingRaw, error: itemsErr } = await supabase
      .from("bet_items")
      .select("bet_id,settled,result")
      .in("bet_id", pendingBetIds)
      .limit(5000);

    if (itemsErr) throw new Error(itemsErr.message);

    const agg = new Map<string, { total: number; unresolved: number }>();

    for (const item of rowsOf<PendingBetItemRow>(itemsForPendingRaw)) {
      if (!item.bet_id) continue;
      if (!agg.has(item.bet_id)) agg.set(item.bet_id, { total: 0, unresolved: 0 });

      const current = agg.get(item.bet_id);
      if (!current) continue;

      current.total += 1;
      if (!isResolvedItem(item)) current.unresolved += 1;
    }

    pendingButAllItemsSettled = recentPendingBets
      .filter((bet) => {
        const current = agg.get(bet.id);
        return Boolean(current && current.total > 0 && current.unresolved === 0);
      })
      .slice(0, limit);
  }

  const { data: settledBetsRaw, error: settledBetsErr } = await supabase
    .from("bets")
    .select("id,user_id,status,settled,payout,settled_at")
    .eq("settled", true)
    .gt("payout", 0)
    .order("settled_at", { ascending: false })
    .limit(Math.max(limit * 6, 300));

  if (settledBetsErr) throw new Error(settledBetsErr.message);

  const settledBets = rowsOf<SettledBetRow>(settledBetsRaw);
  const settledIds = settledBets.map((bet) => bet.id).filter(Boolean);
  let missingPayoutLedger: SettledBetRow[] = [];

  if (settledIds.length > 0) {
    const { data: payoutLedgersRaw, error: ledErr } = await supabase
      .from("vb_ledger")
      .select("ref_id,kind")
      .in("ref_id", settledIds)
      .eq("ref_type", "bet")
      .eq("kind", "BET_PAYOUT")
      .limit(5000);

    if (ledErr) throw new Error(ledErr.message);

    const paid = new Set(
      rowsOf<PayoutLedgerRow>(payoutLedgersRaw)
        .map((row) => row.ref_id)
        .filter((refId): refId is string => Boolean(refId))
    );

    missingPayoutLedger = settledBets
      .filter((bet) => !paid.has(bet.id))
      .slice(0, limit);
  }

  return {
    params: { staleHours, limit },
    metrics: {
      stuckMatches: stuckMatches.length,
      finishedMatchesWithUnsettledItems:
        finishedMatchesWithUnsettledItems.length,
      pendingButAllItemsSettled: pendingButAllItemsSettled.length,
      missingPayoutLedger: missingPayoutLedger.length,
    },
    samples: {
      stuckMatches,
      finishedMatchesWithUnsettledItems,
      pendingButAllItemsSettled,
      missingPayoutLedger,
    },
  };
}
