// app/api/admin/system-health-ui/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

async function assertAdmin(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token) return { ok: false as const, res: json(401, { ok: false, error: "Missing token" }) };

  const admin = supabaseAdmin();

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return { ok: false as const, res: json(401, { ok: false, error: "Invalid token" }) };
  }

  const uid = userData.user.id;

  const { data: adminRow, error: aErr } = await admin
    .from("admins")
    .select("user_id")
    .eq("user_id", uid)
    .maybeSingle();

  if (aErr) return { ok: false as const, res: json(500, { ok: false, error: aErr.message }) };
  if (!adminRow) return { ok: false as const, res: json(403, { ok: false, error: "Forbidden" }) };

  return { ok: true as const, uid, admin };
}

export async function GET(req: Request) {
  const gate = await assertAdmin(req);
  if (!gate.ok) return gate.res;

  const url = new URL(req.url);
  const staleHours = Number(url.searchParams.get("staleHours") || "3");
  const limit = Number(url.searchParams.get("limit") || "50");

  const admin = gate.admin;

  // --- 1) Matches stuck IN_PLAY/PAUSED longer than staleHours (based on utc_date)
  const { data: stuckCandidates, error: stuckErr } = await admin
    .from("matches")
    .select("id,status,utc_date,last_sync_at,competition_id,home_score,away_score")
    .in("status", ["IN_PLAY", "PAUSED"])
    .order("utc_date", { ascending: true })
    .limit(Math.max(limit * 4, 200));

  if (stuckErr) return json(500, { ok: false, error: stuckErr.message });

  const now = Date.now();
  const staleMs = staleHours * 60 * 60 * 1000;

  const stuckMatches = (stuckCandidates || [])
    .filter((m: any) => {
      const kickoff = m.utc_date ? new Date(m.utc_date).getTime() : 0;
      return kickoff > 0 && now - kickoff > staleMs;
    })
    .slice(0, limit);

  // --- 2) FINISHED matches that still have unresolved bet_items (result null or settled=false)
  const { data: unfinishedItems, error: unfinishedErr } = await admin
    .from("bet_items")
    .select("id,bet_id,match_id_bigint,result,settled,kickoff_at")
    .or("result.is.null,settled.eq.false")
    .not("match_id_bigint", "is", null)
    .limit(Math.max(limit * 6, 300));

  if (unfinishedErr) return json(500, { ok: false, error: unfinishedErr.message });

  const matchIdsFromItems = Array.from(
    new Set((unfinishedItems || []).map((x: any) => x.match_id_bigint).filter(Boolean))
  ).slice(0, 400);

  let finishedMatchesWithUnsettledItems: any[] = [];
  if (matchIdsFromItems.length > 0) {
    const { data: finishedMatches, error: finishedErr } = await admin
      .from("matches")
      .select("id,status,utc_date,last_sync_at,competition_id,home_score,away_score")
      .in("id", matchIdsFromItems)
      .eq("status", "FINISHED");

    if (finishedErr) return json(500, { ok: false, error: finishedErr.message });

    const finishedSet = new Set((finishedMatches || []).map((m: any) => m.id));
    const mapByMatch = new Map<number, any>();

    // group items per finished match
    for (const it of unfinishedItems || []) {
      if (!it.match_id_bigint) continue;
      if (!finishedSet.has(it.match_id_bigint)) continue;

      if (!mapByMatch.has(it.match_id_bigint)) {
        const m = (finishedMatches || []).find((mm: any) => mm.id === it.match_id_bigint);
        mapByMatch.set(it.match_id_bigint, { match: m, items: [] as any[] });
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

  if (pendingErr) return json(500, { ok: false, error: pendingErr.message });

  const pendingBetIds = (recentPendingBets || []).map((b: any) => b.id);
  let pendingButAllItemsSettled: any[] = [];

  if (pendingBetIds.length > 0) {
    const { data: itemsForPending, error: itemsErr } = await admin
      .from("bet_items")
      .select("bet_id,settled,result")
      .in("bet_id", pendingBetIds)
      .limit(5000);

    if (itemsErr) return json(500, { ok: false, error: itemsErr.message });

    const agg = new Map<string, { total: number; unresolved: number }>();

    for (const it of itemsForPending || []) {
      const betId = it.bet_id as string;
      if (!agg.has(betId)) agg.set(betId, { total: 0, unresolved: 0 });
      const a = agg.get(betId)!;
      a.total += 1;

      const isSettledOk = it.settled === true && it.result != null;
      if (!isSettledOk) a.unresolved += 1;
    }

    pendingButAllItemsSettled = (recentPendingBets || [])
      .filter((b: any) => {
        const a = agg.get(b.id);
        return a && a.total > 0 && a.unresolved === 0;
      })
      .slice(0, limit);
  }

  // --- 4) Settled winning bets missing payout ledger entry (kind = BET_PAYOUT)
  const { data: settledBets, error: settledBetsErr } = await admin
    .from("bets")
    .select("id,user_id,status,settled,payout,settled_at")
    .eq("settled", true)
    .gt("payout", 0)
    .order("settled_at", { ascending: false })
    .limit(Math.max(limit * 6, 300));

  if (settledBetsErr) return json(500, { ok: false, error: settledBetsErr.message });

  const settledIds = (settledBets || []).map((b: any) => b.id);
  let missingPayoutLedger: any[] = [];

  if (settledIds.length > 0) {
    const { data: payoutLedgers, error: ledErr } = await admin
      .from("vb_ledger")
      .select("ref_id,kind")
      .in("ref_id", settledIds)
      .eq("ref_type", "bet")
      .eq("kind", "BET_PAYOUT")
      .limit(5000);

    if (ledErr) return json(500, { ok: false, error: ledErr.message });

    const paid = new Set((payoutLedgers || []).map((x: any) => x.ref_id));
    missingPayoutLedger = (settledBets || []).filter((b: any) => !paid.has(b.id)).slice(0, limit);
  }

  return json(200, {
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