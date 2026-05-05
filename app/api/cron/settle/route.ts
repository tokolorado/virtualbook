//app/api/cron/settle/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { cronLogStart, cronLogSuccess, cronLogError } from "@/lib/cronLogger";
import { getCronSecretAuthResult } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MatchSettleResult = {
  matchId: number;
  ok: boolean;
  skipped?: boolean;
  reason?: string | null;
  error?: string | null;
  betsTouched: number;
  betsSettleCalls: number;
};

type PendingBetBackfillResult = {
  betId: string;
  ok: boolean;
  error: string | null;
};

type MatchResultsBackfillResult = {
  checked: number;
  missing: number;
  inserted: number;
  skipped: number;
  matchIds: number[];
};

type MatchResultIdRow = {
  match_id: number | string | null;
};

type MatchRepairSourceRow = {
  id: number | string | null;
  utc_date: string | null;
  home_score: number | string | null;
  away_score: number | string | null;
};

type MatchResultRepairRow = {
  match_id: number;
  status: "FINISHED";
  home_score: number;
  away_score: number;
  ht_home_score: null;
  ht_away_score: null;
  sh_home_score: null;
  sh_away_score: null;
  home_goals_ht: null;
  away_goals_ht: null;
  started_at: string | null;
  finished_at: string;
  updated_at: string;
};

type CandidateRow = {
  match_id_bigint: number | string | null;
};

type FinishedMatchRow = {
  id: number | string | null;
};

type SettleMatchOnceResponse = {
  ok?: boolean | null;
  skipped?: boolean;
  reason?: string | null;
  error?: string | null;
  openBefore?: number | null;
  openAfter?: number | null;
};

type BetIdRow = {
  bet_id: string | null;
};

type PendingBetRow = {
  id: string | null;
};

type ResolvedBetItemRow = {
  bet_id?: string | null;
  settled?: boolean | null;
  result?: string | null;
};

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isResolvedBetItem(row: ResolvedBetItemRow) {
  const settled = row?.settled === true;
  const result = String(row?.result ?? "").toLowerCase();
  return settled && (result === "won" || result === "lost" || result === "void");
}

async function backfillMissingMatchResults(
  supabase: ReturnType<typeof supabaseAdmin>,
  matchIds: number[],
  nowIso: string
): Promise<MatchResultsBackfillResult> {
  const uniqueIds = Array.from(
    new Set(matchIds.filter((matchId) => Number.isFinite(matchId)))
  );

  if (!uniqueIds.length) {
    return {
      checked: 0,
      missing: 0,
      inserted: 0,
      skipped: 0,
      matchIds: [],
    };
  }

  const { data: existingRows, error: existingErr } = await supabase
    .from("match_results")
    .select("match_id")
    .in("match_id", uniqueIds);

  if (existingErr) throw existingErr;

  const existing = new Set(
    ((existingRows ?? []) as MatchResultIdRow[])
      .map((row) => Number(row.match_id))
      .filter((matchId: number) => Number.isFinite(matchId))
  );

  const missingIds = uniqueIds.filter((matchId) => !existing.has(matchId));

  if (!missingIds.length) {
    return {
      checked: uniqueIds.length,
      missing: 0,
      inserted: 0,
      skipped: 0,
      matchIds: [],
    };
  }

  const { data: matchRows, error: matchErr } = await supabase
    .from("matches")
    .select("id,status,utc_date,home_score,away_score")
    .eq("source", "bsd")
    .in("id", missingIds)
    .eq("status", "FINISHED");

  if (matchErr) throw matchErr;

  const repairRows: MatchResultRepairRow[] = ((matchRows ??
    []) as MatchRepairSourceRow[])
    .flatMap((row) => {
      const matchId = Number(row.id);
      const homeScore = Number(row.home_score);
      const awayScore = Number(row.away_score);

      if (
        !Number.isFinite(matchId) ||
        !Number.isFinite(homeScore) ||
        !Number.isFinite(awayScore)
      ) {
        return [];
      }

      return [{
        match_id: matchId,
        status: "FINISHED",
        home_score: homeScore,
        away_score: awayScore,
        ht_home_score: null,
        ht_away_score: null,
        sh_home_score: null,
        sh_away_score: null,
        home_goals_ht: null,
        away_goals_ht: null,
        started_at: row.utc_date ?? null,
        finished_at: nowIso,
        updated_at: nowIso,
      }];
    });

  if (repairRows.length > 0) {
    const { error: insertErr } = await supabase
      .from("match_results")
      .upsert(repairRows, { onConflict: "match_id" });

    if (insertErr) throw insertErr;
  }

  return {
    checked: uniqueIds.length,
    missing: missingIds.length,
    inserted: repairRows.length,
    skipped: missingIds.length - repairRows.length,
    matchIds: repairRows.map((row) => Number(row.match_id)),
  };
}

export async function POST(req: Request) {
  let logId: number | null = null;

  try {
    logId = await cronLogStart("settle", "github-actions");

    const auth = getCronSecretAuthResult(req);
    if (!auth.ok) {
      await cronLogSuccess(logId, {
        ok: false,
        job: "settle",
        reason: auth.reason,
      });
      return json(auth.status, { ok: false, error: auth.error });
    }

    const supabase = supabaseAdmin();
    const nowIso = new Date().toISOString();

    const MATCH_BATCH_LIMIT = Number(process.env.SETTLE_BATCH_LIMIT ?? "25");
    const BET_BACKFILL_LIMIT = Number(process.env.SETTLE_BET_BACKFILL_LIMIT ?? "100");

    const matchLimit =
      Number.isFinite(MATCH_BATCH_LIMIT) && MATCH_BATCH_LIMIT > 0
        ? MATCH_BATCH_LIMIT
        : 25;

    const betBackfillLimit =
      Number.isFinite(BET_BACKFILL_LIMIT) && BET_BACKFILL_LIMIT > 0
        ? BET_BACKFILL_LIMIT
        : 100;

    // ------------------------------------------------------------
    // ETAP 1: świeże FINISHED mecze, które mają jeszcze nierozliczone bet_items
    // ------------------------------------------------------------
    const { data: candRows, error: candErr } = await supabase
      .from("bet_items")
      .select("match_id_bigint, kickoff_at")
      .or("settled.is.false,settled.is.null")
      .not("match_id_bigint", "is", null)
      .order("kickoff_at", { ascending: true })
      .limit(matchLimit * 5);

    if (candErr) throw candErr;

    const candidateIds = Array.from(
      new Set(
        ((candRows ?? []) as CandidateRow[])
          .map((row) => Number(row.match_id_bigint))
          .filter((x: number) => Number.isFinite(x))
      )
    );

    let matchIdsToSettle: number[] = [];

    if (candidateIds.length) {
      const { data: finishedRows, error: finErr } = await supabase
        .from("matches")
        .select("id,status,utc_date")
        .eq("source", "bsd")
        .in("id", candidateIds)
        .eq("status", "FINISHED")
        .order("utc_date", { ascending: true })
        .limit(matchLimit);

      if (finErr) throw finErr;

      matchIdsToSettle = ((finishedRows ?? []) as FinishedMatchRow[])
        .map((match) => Number(match.id))
        .filter((x: number) => Number.isFinite(x));
    }

    const matchResults: MatchSettleResult[] = [];
    const matchResultsBackfill = await backfillMissingMatchResults(
      supabase,
      matchIdsToSettle,
      nowIso
    );

    let matchesSettledOk = 0;
    let matchesSkipped = 0;

    for (const matchId of matchIdsToSettle) {
      try {
        const { data: smData, error: smErr } = await supabase.rpc("settle_match_once", {
          p_match_id: matchId,
        });

        if (smErr) throw smErr;

        const settleResult = (smData ?? {}) as SettleMatchOnceResponse;
        const rpcReportedFailure = settleResult.ok === false;
        const skipped = settleResult.skipped === true;
        const reason = settleResult.reason ?? null;
        const settleError = settleResult.error ?? null;

        if (rpcReportedFailure) {
          matchResults.push({
            matchId,
            ok: false,
            skipped: false,
            reason,
            error: settleError ?? "settle_match_once returned ok=false",
            betsTouched: 0,
            betsSettleCalls: 0,
          });

          continue;
        }

        if (skipped) {
          matchesSkipped++;

          matchResults.push({
            matchId,
            ok: true,
            skipped: true,
            reason,
            error: null,
            betsTouched: 0,
            betsSettleCalls: 0,
          });

          matchesSettledOk++;
          continue;
        }

        const { data: betRows, error: betErr } = await supabase
          .from("bet_items")
          .select("bet_id")
          .eq("match_id_bigint", matchId);

        if (betErr) throw betErr;

        const betIds = Array.from(
          new Set(
            ((betRows ?? []) as BetIdRow[])
              .map((row) => row.bet_id)
              .filter((betId): betId is string => Boolean(betId))
          )
        );

        let calls = 0;

        for (const betId of betIds) {
          const { error: sbErr } = await supabase.rpc("settle_bet", {
            p_bet_id: betId,
          });

          if (sbErr) throw sbErr;
          calls++;
        }

        matchResults.push({
          matchId,
          ok: true,
          skipped: false,
          reason,
          error: null,
          betsTouched: betIds.length,
          betsSettleCalls: calls,
        });

        matchesSettledOk++;
      } catch (error: unknown) {
        matchResults.push({
          matchId,
          ok: false,
          error: errorMessage(error),
          betsTouched: 0,
          betsSettleCalls: 0,
        });
      }
    }

    // ------------------------------------------------------------
    // ETAP 2: backfill wiszących parent-betów
    // ------------------------------------------------------------
    const { data: pendingResolvedBets, error: pendingResolvedErr } = await supabase
      .from("bets")
      .select("id, created_at")
      .or("settled.is.false,settled.is.null")
      .order("created_at", { ascending: true })
      .limit(betBackfillLimit);

    if (pendingResolvedErr) throw pendingResolvedErr;

    const pendingBetIds = ((pendingResolvedBets ?? []) as PendingBetRow[])
      .map((bet) => bet.id)
      .filter((betId): betId is string => Boolean(betId));

    const backfillResults: PendingBetBackfillResult[] = [];

    if (pendingBetIds.length) {
      const { data: backfillRows, error: backfillErr } = await supabase
        .from("bet_items")
        .select("bet_id, settled, result")
        .in("bet_id", pendingBetIds);

      if (backfillErr) throw backfillErr;

      const byBet = new Map<string, { total: number; resolved: number }>();

      for (const row of (backfillRows ?? []) as ResolvedBetItemRow[]) {
        const betId = String(row.bet_id);
        const current = byBet.get(betId) ?? { total: 0, resolved: 0 };

        current.total += 1;

        if (isResolvedBetItem(row)) {
          current.resolved += 1;
        }

        byBet.set(betId, current);
      }

      const readyBetIds = pendingBetIds.filter((betId) => {
        const agg = byBet.get(String(betId));
        if (!agg) return false;
        return agg.total > 0 && agg.total === agg.resolved;
      });

      for (const betId of readyBetIds) {
        try {
          const { error: sbErr } = await supabase.rpc("settle_bet", {
            p_bet_id: betId,
          });

          if (sbErr) throw sbErr;

          backfillResults.push({
            betId: String(betId),
            ok: true,
            error: null,
          });
        } catch (error: unknown) {
          backfillResults.push({
            betId: String(betId),
            ok: false,
            error: errorMessage(error),
          });
        }
      }
    }

    const pendingBetBackfillSettled = backfillResults.filter((x) => x.ok).length;
    const failedMatchResults = matchResults.filter((x) => !x.ok);
    const failedBackfillResults = backfillResults.filter((x) => !x.ok);
    const hasSettlementFailures =
      failedMatchResults.length > 0 || failedBackfillResults.length > 0;

    const responseBody = {
      ok: !hasSettlementFailures,
      job: "settle",
      requestedMatches: matchIdsToSettle.length,
      matchResultsBackfill,
      matchesSettledOk,
      matchesSkipped,
      pendingBetBackfillChecked: pendingBetIds.length,
      pendingBetBackfillSettled,
      failedMatchResults: failedMatchResults.length,
      failedBackfillResults: failedBackfillResults.length,
      matchResults,
      backfillResults,
    };

    if (hasSettlementFailures) {
      await cronLogError(logId, {
        message: "settle job completed with unresolved settlement failures",
        ...responseBody,
      });

      return json(500, responseBody);
    }

    await cronLogSuccess(logId, responseBody);

    return json(200, responseBody);
  } catch (error: unknown) {
    await cronLogError(logId, error);
    return json(500, { ok: false, error: errorMessage(error) });
  }
}

export async function GET() {
  return json(405, { ok: false, error: "Method Not Allowed" });
}
