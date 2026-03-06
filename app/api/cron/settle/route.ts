// app/api/cron/settle/route.ts
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

    const BATCH_LIMIT = Number(process.env.SETTLE_BATCH_LIMIT ?? "25");
    const LIMIT = Number.isFinite(BATCH_LIMIT) && BATCH_LIMIT > 0 ? BATCH_LIMIT : 25;

    // 1) Candidate matches: takie, które mają bet_items.settled = false/null
    const { data: candRows, error: candErr } = await supabase
      .from("bet_items")
      .select("match_id_bigint, kickoff_at")
      .or("settled.is.false,settled.is.null")
      .not("match_id_bigint", "is", null)
      .order("kickoff_at", { ascending: true })
      .limit(LIMIT * 5);

    if (candErr) throw candErr;

    const candidateIds = Array.from(
      new Set(
        (candRows ?? [])
          .map((r: any) => Number(r.match_id_bigint))
          .filter((x: number) => Number.isFinite(x))
      )
    );

    if (!candidateIds.length) {
      await cronLogSuccess(logId, {
        ok: true,
        job: "settle",
        requested: 0,
        settledOk: 0,
        skipped: 0,
        note: "No unsettled bet_items found",
      });

      return json(200, {
        ok: true,
        requested: 0,
        settledOk: 0,
        skipped: 0,
        results: [],
        note: "No unsettled bet_items found",
      });
    }

    // 2) Bierzemy tylko mecze FINISHED
    const { data: finishedRows, error: finErr } = await supabase
      .from("matches")
      .select("id,status,utc_date")
      .in("id", candidateIds)
      .eq("status", "FINISHED")
      .order("utc_date", { ascending: true })
      .limit(LIMIT);

    if (finErr) throw finErr;

    const matchIdsToSettle = (finishedRows ?? [])
      .map((m: any) => Number(m.id))
      .filter((x: number) => Number.isFinite(x));

    if (!matchIdsToSettle.length) {
      await cronLogSuccess(logId, {
        ok: true,
        job: "settle",
        requested: 0,
        settledOk: 0,
        skipped: 0,
        note: "No FINISHED matches among candidates",
      });

      return json(200, {
        ok: true,
        requested: 0,
        settledOk: 0,
        skipped: 0,
        results: [],
        note: "No FINISHED matches among candidates",
      });
    }

    // 3) Settle match -> settle affected bets
    const results: MatchSettleResult[] = [];
    let settledOk = 0;
    let skippedCount = 0;

    for (const matchId of matchIdsToSettle) {
      try {
        // 3a) Idempotent: tylko raz na mecz
        const { data: smData, error: smErr } = await supabase.rpc("settle_match_once", {
          p_match_id: matchId,
        });
        if (smErr) throw smErr;

        const skipped = Boolean((smData as any)?.skipped);
        const reason = (smData as any)?.reason ?? null;

        if (skipped) {
          skippedCount++;

          results.push({
            matchId,
            ok: true,
            skipped: true,
            reason,
            error: null,
            betsTouched: 0,
            betsSettleCalls: 0,
          });

          settledOk++;
          continue;
        }

        // 3b) Bet IDs dotknięte tym meczem (opcjonalnie tylko nierozliczone)
        const { data: betRows, error: betErr } = await supabase
          .from("bet_items")
          .select("bet_id")
          .eq("match_id_bigint", matchId)
          .or("settled.is.false,settled.is.null");

        if (betErr) throw betErr;

        const betIds = Array.from(new Set((betRows ?? []).map((x: any) => x.bet_id).filter(Boolean)));

        // 3c) Rozlicz kupony (idempotentne)
        let calls = 0;
        for (const betId of betIds) {
          const { error: sbErr } = await supabase.rpc("settle_bet", { p_bet_id: betId });
          if (sbErr) throw sbErr;
          calls++;
        }

        results.push({
          matchId,
          ok: true,
          skipped: false,
          reason,
          error: null,
          betsTouched: betIds.length,
          betsSettleCalls: calls,
        });

        settledOk++;
      } catch (e: any) {
        results.push({
          matchId,
          ok: false,
          error: e?.message ?? String(e),
          betsTouched: 0,
          betsSettleCalls: 0,
        });
      }
    }

    await cronLogSuccess(logId, {
      ok: true,
      job: "settle",
      requested: matchIdsToSettle.length,
      settledOk,
      skipped: skippedCount,
      results,
    });

    return json(200, {
      ok: true,
      requested: matchIdsToSettle.length,
      settledOk,
      skipped: skippedCount,
      results,
    });
  } catch (e: any) {
    await cronLogError(logId, e);
    return json(500, { ok: false, error: e?.message ?? String(e) });
  }
}

export async function GET() {
  return json(405, { ok: false, error: "Method Not Allowed" });
}