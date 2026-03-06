import { supabaseAdmin } from "./supabaseServer";
import { computeLambdasMVP } from "./lambdaMvp";
import { computeMarkets, applyMargin, applyRiskAdjustment, probsToOdds } from "./oddsEngine";

export async function recomputeOddsForMatch(matchId: number, margin = 0.06) {
  const sb = supabaseAdmin();

  // 1) exposure liability per selection dla każdego marketu
  const { data: exposureRows, error: exErr } = await sb
    .from("exposure")
    .select("market_id,selection,total_liability")
    .eq("match_id", matchId);

  if (exErr) throw exErr;

  const exposureByMarket: Record<string, Record<string, number>> = {};
  for (const r of exposureRows ?? []) {
    exposureByMarket[r.market_id] ??= {};
    exposureByMarket[r.market_id][r.selection] = Number(r.total_liability);
  }

  // 2) lambdy (MVP). Później podmienisz na ratingi drużyn/lig.
  const { lambdaHome, lambdaAway } = computeLambdasMVP();

  // 3) fair probs z Poissona
  const markets = computeMarkets({ lambdaHome, lambdaAway });

  // 4) marża + risk + zapis
  const upserts: any[] = [];

  for (const marketId of Object.keys(markets) as Array<keyof typeof markets>) {
    const fair = markets[marketId];
    const withMargin = applyMargin(fair, margin);

    const { bookProb, riskAdjustment } = applyRiskAdjustment(
      withMargin,
      exposureByMarket[marketId] ?? null
    );

    const fairOdds = probsToOdds(fair);
    const bookOdds = probsToOdds(bookProb);

    for (const sel of Object.keys(fair)) {
      upserts.push({
        match_id: matchId,
        market_id: marketId,
        selection: sel,
        fair_prob: fair[sel],
        fair_odds: fairOdds[sel],
        margin,
        risk_adjustment: riskAdjustment[sel] ?? 0,
        book_prob: bookProb[sel],
        book_odds: bookOdds[sel],
        updated_at: new Date().toISOString(),
      });
    }
  }

  const { error } = await sb.from("odds").upsert(upserts, {
    onConflict: "match_id,market_id,selection",
  });
  if (error) throw error;
}