// app/api/admin/system-health/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertCronSecret(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) throw new Error("Missing CRON_SECRET env");
  const got = req.headers.get("x-cron-secret");
  if (!got || got !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: Request) {
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const staleHours = Number(url.searchParams.get("staleHours") || "3");
  const limit = Number(url.searchParams.get("limit") || "50");

  const admin = supabaseAdmin();

  // --- 1) Matches stuck IN_PLAY/PAUSED longer than staleHours
  const { data: stuckCandidates, error: stuckErr } = await admin
    .from("matches")
    .select("id,status,utc_date,last_sync_at,competition_id,home_score,away_score")
    .in("status", ["IN_PLAY", "PAUSED"])
    .order("utc_date", { ascending: true })
    .limit(Math.max(limit * 4, 200));

  if (stuckErr) {
    return NextResponse.json({ ok: false, error: stuckErr.message }, { status: 500 });
  }

  const now = Date.now();
  const staleMs = staleHours * 60 * 60 * 1000;

  const stuckMatches = (stuckCandidates || [])
    .filter((m) => {
      const kickoff = m.utc_date ? new Date(m.utc_date).getTime() : 0;
      return kickoff > 0 && now - kickoff > staleMs;
    })
    .slice(0, limit);

  // --- 2) FINISHED matches that still have unresolved bet_items (result null or settled=false)
  const { data: unfinishedItems, error: unfinishedErr } = await admin
    .from("bet_items")
    .select("id,bet_id,match_id_bigint,result,settled,kickoff_at")
    .eq("settled", false)
    .not("match_id_bigint", "is", null)
    .limit(Math.max(limit * 6, 300));

  if (unfinishedErr) {
    return NextResponse.json({ ok: false, error: unfinishedErr.message }, { status: 500 });
  }

  const matchIdsFromItems = Array.from(
    new Set((unfinishedItems || []).map((x) => x.match_id_bigint).filter(Boolean))
  ).slice(0, 400);

  let finishedMatchesWithUnsettledItems: any[] = [];
  if (matchIdsFromItems.length > 0) {
    const { data: finishedMatches, error: finishedErr } = await admin
      .from("matches")
      .select("id,status,utc_date,last_sync_at,competition_id,home_score,away_score")
      .in("id", matchIdsFromItems)
      .eq("status", "FINISHED");

    if (finishedErr) {
      return NextResponse.json({ ok: false, error: finishedErr.message }, { status: 500 });
    }

    const finishedSet = new Set((finishedMatches || []).map((m) => m.id));
    const mapByMatch = new Map<number, any>();

    for (const it of unfinishedItems || []) {
      if (!it.match_id_bigint) continue;
      if (!finishedSet.has(it.match_id_bigint)) continue;

      if (!mapByMatch.has(it.match_id_bigint)) {
        const m = (finishedMatches || []).find((mm) => mm.id === it.match_id_bigint);
        mapByMatch.set(it.match_id_bigint, {
          match: m,
          items: [],
        });
      }
      mapByMatch.get(it.match_id_bigint).items.push(it);
    }

    finishedMatchesWithUnsettledItems = Array.from(mapByMatch.values()).slice(0, limit);
  }

  // --- 3) Bets pending but all their items are settled (settle_bet not called / skipped)
  const { data: recentPendingBets, error: pendingErr } = await admin
    .from("bets")
    .select("id,status,settled,created_at,user_id,stake,payout")
    .eq("settled", false)
    .in("status", ["pending"])
    .order("created_at", { ascending: false })
    .limit(Math.max(limit * 6, 300));

  if (pendingErr) {
    return NextResponse.json({ ok: false, error: pendingErr.message }, { status: 500 });
  }

  const pendingBetIds = (recentPendingBets || []).map((b) => b.id);
  let pendingButAllItemsSettled: any[] = [];

  if (pendingBetIds.length > 0) {
    const { data: itemsForPending, error: itemsErr } = await admin
      .from("bet_items")
      .select("bet_id,settled,result")
      .in("bet_id", pendingBetIds)
      .limit(5000);

    if (itemsErr) {
      return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });
    }

    const agg = new Map<string, { total: number; settledOk: number; unresolved: number }>();
    for (const it of itemsForPending || []) {
      const betId = it.bet_id as string;
      if (!agg.has(betId)) agg.set(betId, { total: 0, settledOk: 0, unresolved: 0 });
      const a = agg.get(betId)!;
      a.total += 1;
      const isSettledOk = it.settled === true && it.result != null;
      if (isSettledOk) a.settledOk += 1;
      else a.unresolved += 1;
    }

    pendingButAllItemsSettled = (recentPendingBets || [])
      .filter((b) => {
        const a = agg.get(b.id);
        return a && a.total > 0 && a.unresolved === 0;
      })
      .slice(0, limit);
  }

  // --- 4) Settled winning bets missing payout ledger entry
  const { data: settledBets, error: settledBetsErr } = await admin
    .from("bets")
    .select("id,user_id,status,settled,payout,settled_at")
    .eq("settled", true)
    .gt("payout", 0)
    .order("settled_at", { ascending: false })
    .limit(Math.max(limit * 6, 300));

  if (settledBetsErr) {
    return NextResponse.json({ ok: false, error: settledBetsErr.message }, { status: 500 });
  }

  const settledIds = (settledBets || []).map((b) => b.id);
  let missingPayoutLedger: any[] = [];

  if (settledIds.length > 0) {
    const { data: payoutLedgers, error: ledErr } = await admin
      .from("vb_ledger")
      .select("ref_id,kind")
      .in("ref_id", settledIds)
      .eq("ref_type", "bet")
      .eq("kind", "BET_PAYOUT")
      .limit(5000);

    if (ledErr) {
      return NextResponse.json({ ok: false, error: ledErr.message }, { status: 500 });
    }

    const paid = new Set((payoutLedgers || []).map((x) => x.ref_id));
    missingPayoutLedger = (settledBets || []).filter((b) => !paid.has(b.id)).slice(0, limit);
  }

  return NextResponse.json({
    ok: true,
    params: { staleHours, limit },
    metrics: {
      stuckMatches: stuckMatches.length,
      finishedMatchesWithUnsettledItems: finishedMatchesWithUnsettledItems.length,
      pendingButAllItemsSettled: pendingButAllItemsSettled.length,
      missingPayoutLedger: missingPayoutLedger.length,
    },
    samples: {
      stuckMatches,
      finishedMatchesWithUnsettledItems,
      pendingButAllItemsSettled,
      missingPayoutLedger,
    },
  });
}