import { supabaseAdmin } from "./supabaseServer";

function settleSelection_1x2(home: number, away: number) {
  if (home > away) return "HOME";
  if (home === away) return "DRAW";
  return "AWAY";
}
function settleSelection_ou25(home: number, away: number) {
  return (home + away) >= 3 ? "OVER" : "UNDER";
}
function settleSelection_btts(home: number, away: number) {
  return (home >= 1 && away >= 1) ? "YES" : "NO";
}

export async function settleFinishedMatches(dateISO: string) {
  const sb = supabaseAdmin();

  const start = new Date(dateISO + "T00:00:00.000Z").toISOString();
  const end = new Date(dateISO + "T23:59:59.999Z").toISOString();

  const { data: matches, error: mErr } = await sb
    .from("matches")
    .select("id,status,home_score,away_score")
    .gte("utc_date", start)
    .lte("utc_date", end)
    .eq("status", "FINISHED");

  if (mErr) throw mErr;
  if (!matches?.length) return;

  for (const match of matches) {
    const hs = match.home_score;
    const as = match.away_score;
    if (hs == null || as == null) continue;

    const winnersByMarket: Record<string, string> = {
      "1x2": settleSelection_1x2(hs, as),
      "ou_2_5": settleSelection_ou25(hs, as),
      "btts": settleSelection_btts(hs, as),
    };

    const { data: openBets, error: bErr } = await sb
      .from("bets")
      .select("id,slip_id,market_id,selection,status")
      .eq("match_id", match.id)
      .eq("status", "OPEN");

    if (bErr) throw bErr;

    for (const bet of openBets ?? []) {
      const winner = winnersByMarket[bet.market_id];
      const newStatus = bet.selection === winner ? "WON" : "LOST";

      const { error } = await sb.from("bets").update({ status: newStatus }).eq("id", bet.id);
      if (error) throw error;
    }

    // Uproszczone: kupony AKO wymagają policzenia wszystkich pozycji.
    // MVP: ustaw slip SETTLED jeśli wszystkie jego bety są już WON/LOST.
    const slipIds = Array.from(new Set((openBets ?? []).map((b) => b.slip_id)));
    for (const sid of slipIds) {
      const { data: stillOpen } = await sb
        .from("bets")
        .select("id")
        .eq("slip_id", sid)
        .eq("status", "OPEN")
        .limit(1);

      if (!stillOpen?.length) {
        const { error } = await sb.from("slips").update({ status: "SETTLED" }).eq("id", sid);
        if (error) throw error;
      }
    }
  }
}