import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { recomputeOddsForMatch } from "@/lib/oddsComputeAndStore";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const matchIdStr = url.searchParams.get("matchId");
  if (!matchIdStr) return NextResponse.json({ error: "Missing matchId" }, { status: 400 });

  const matchId = Number(matchIdStr);
  const sb = supabaseAdmin();

  // jeśli brak kursów lub stare -> przelicz
  const { data: existing } = await sb
    .from("odds")
    .select("updated_at")
    .eq("match_id", matchId)
    .limit(1);

  const staleMinutes = 5;
  const need =
    !existing?.length ||
    (Date.now() - new Date(existing[0].updated_at).getTime()) / 60000 > staleMinutes;

  if (need) await recomputeOddsForMatch(matchId, 0.06);

  const { data, error } = await sb
    .from("odds")
    .select("*")
    .eq("match_id", matchId)
    .order("market_id", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ odds: data });
}