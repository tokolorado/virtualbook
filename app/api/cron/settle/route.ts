import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { cronLogStart, cronLogSuccess, cronLogError } from "@/lib/cronLogger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MatchSettleResult = {
  matchId: number;
  ok: boolean;
  skipped?: boolean;
  reason?: string | null;
  error: string | null;
  betsTouched: number;
  betsSettleCalls: number;
};

type PendingBetBackfillResult = {
  betId: string;
  ok: boolean;
  error: string | null;
};

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  let logId: number | null = null;

  try {
    logId = await cronLogStart("settle", "github-actions");

    const cronSecret = process.env.CRON_SECRET;
    const gotSecret = req.headers.get("x-cron-secret") || "";

    if (!cronSecret) {
      await cronLogSuccess(logId, {
        ok: false,
        job: "settle",
        reason: "missing_cron_secret_env",
      });
      return json(500, { ok: false, error: "Missing CRON_SECRET in env" });
    }

    if (gotSecret !== cronSecret) {
      await cronLogSuccess(logId, {
        ok: false,
        job: "settle",
        reason: "unauthorized",
      });
      return json(401, { ok: false, error: "Unauthorized" });
    }

    const supabase = supabaseAdmin();

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
        (candRows ?? [])
          .map((r: any) => Number(r.match_id_bigint))
          .filter((x: number) => Number.isFinite(x))
      )
    );

    let matchIdsToSettle: number[] = [];

    if (candidateIds.length) {
      const { data: finishedRows, error: finErr } = await supabase
        .from("matches")
        .select("id,status,utc_date")
        .in("id", candidateIds)
        .eq("status", "FINISHED")
        .order("utc_date", { ascending: true })
        .limit(matchLimit);

      if (finErr) throw finErr;

      matchIdsToSettle = (finishedRows ?? [])
        .map((m: any) => Number(m.id))
        .filter((x: number) => Number.isFinite(x));
    }

    const matchResults: MatchSettleResult[] = [];
    let matchesSettledOk = 0;
    let matchesSkipped = 0;

    for (const matchId of matchIdsToSettle) {
      try {
        const { data: smData, error: smErr } = await supabase.rpc("settle_match_once", {
          p_match_id: matchId,
        });

        if (smErr) throw smErr;

        const skipped = Boolean((smData as any)?.skipped);
        const reason = (smData as any)?.reason ?? null;

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

        // Po settle_match_once bierzemy WSZYSTKIE bety dotknięte tym meczem,
        // nie tylko te z unsettled bet_items.
        const { data: betRows, error: betErr } = await supabase
          .from("bet_items")
          .select("bet_id")
          .eq("match_id_bigint", matchId);

        if (betErr) throw betErr;

        const betIds = Array.from(
          new Set((betRows ?? []).map((x: any) => x.bet_id).filter(Boolean))
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
      } catch (e: any) {
        matchResults.push({
          matchId,
          ok: false,
          error: e?.message ?? String(e),
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
      .eq("settled", false)
      .order("created_at", { ascending: true })
      .limit(betBackfillLimit);

    if (pendingResolvedErr) throw pendingResolvedErr;

    const pendingBetIds = (pendingResolvedBets ?? []).map((b: any) => b.id).filter(Boolean);

    const backfillResults: PendingBetBackfillResult[] = [];

    if (pendingBetIds.length) {
      const { data: backfillRows, error: backfillErr } = await supabase
        .from("bet_items")
        .select("bet_id, settled, result")
        .in("bet_id", pendingBetIds);

      if (backfillErr) throw backfillErr;

      const byBet = new Map<
        string,
        { total: number; resolved: number }
      >();

      for (const row of backfillRows ?? []) {
        const betId = String((row as any).bet_id);
        const current = byBet.get(betId) ?? { total: 0, resolved: 0 };

        current.total += 1;

        const isResolved =
          (row as any).settled === true && (row as any).result != null;

        if (isResolved) {
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
        } catch (e: any) {
          backfillResults.push({
            betId: String(betId),
            ok: false,
            error: e?.message ?? String(e),
          });
        }
      }
    }

    await cronLogSuccess(logId, {
      ok: true,
      job: "settle",
      requestedMatches: matchIdsToSettle.length,
      matchesSettledOk,
      matchesSkipped,
      pendingBetBackfillChecked: pendingBetIds.length,
      pendingBetBackfillSettled: backfillResults.filter((x) => x.ok).length,
      matchResults,
      backfillResults,
    });

    return json(200, {
      ok: true,
      requestedMatches: matchIdsToSettle.length,
      matchesSettledOk,
      matchesSkipped,
      pendingBetBackfillChecked: pendingBetIds.length,
      pendingBetBackfillSettled: backfillResults.filter((x) => x.ok).length,
      matchResults,
      backfillResults,
    });
  } catch (e: any) {
    await cronLogError(logId, e);
    return json(500, { ok: false, error: e?.message ?? String(e) });
  }
}

export async function GET() {
  return json(405, { ok: false, error: "Method Not Allowed" });
}