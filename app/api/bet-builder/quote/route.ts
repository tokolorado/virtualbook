import { NextResponse } from "next/server";
import { priceBetBuilderSlip } from "@/lib/bets/betBuilderPricing";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISPLAYABLE_BSD_SOURCE = "bsd";
const DISPLAYABLE_BSD_PRICING_METHOD = "bsd_market_normalized";
const INTERNAL_FALLBACK_SOURCE = "internal_model";
const INTERNAL_FALLBACK_PRICING_METHOD = "internal_model_fallback";

type SlipItem = {
  matchId?: string | number | null;
  market?: string | null;
  pick?: string | null;
  odd?: number | string | null;
  home?: string | null;
  away?: string | null;
};

type Body = {
  slip?: SlipItem[];
  stake?: number | string | null;
};

function toNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function jsonError(message: string, status = 500, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { ok: false, error: message, ...(extra ?? {}) },
    { status }
  );
}

function matchIdFromSlip(slip: SlipItem[]) {
  const first = slip[0]?.matchId;
  const parsed = toNumber(first);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function isBettableOddsRow(row: {
  source?: string | null;
  pricing_method?: string | null;
  is_model?: boolean | null;
}) {
  const isRealBsd =
    row.source === DISPLAYABLE_BSD_SOURCE &&
    row.pricing_method === DISPLAYABLE_BSD_PRICING_METHOD &&
    row.is_model !== true;
  const isInternalFallback =
    row.source === INTERNAL_FALLBACK_SOURCE &&
    row.pricing_method === INTERNAL_FALLBACK_PRICING_METHOD &&
    row.is_model === true;

  return isRealBsd || isInternalFallback;
}

export async function POST(req: Request) {
  let body: Body;

  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const slip = Array.isArray(body.slip) ? body.slip : [];
  const matchId = matchIdFromSlip(slip);

  if (!matchId) {
    return jsonError("Nieprawidłowy matchId dla Bet Buildera.", 400);
  }

  const supabase = supabaseAdmin();

  const { data: oddsRows, error: oddsError } = await supabase
    .from("odds")
    .select("market_id,selection,fair_prob,book_odds,source,pricing_method,is_model")
    .eq("match_id", matchId)
    .or(`source.eq.${DISPLAYABLE_BSD_SOURCE},source.eq.${INTERNAL_FALLBACK_SOURCE}`);

  if (oddsError) {
    return jsonError("Nie udało się pobrać kursów do Bet Buildera.", 500, {
      detail: oddsError.message,
    });
  }

  const quote = priceBetBuilderSlip({
    items: slip,
    oddsRows: ((oddsRows ?? []) as Array<{
      market_id: string;
      selection: string;
      fair_prob?: number | string | null;
      book_odds?: number | string | null;
      source?: string | null;
      pricing_method?: string | null;
      is_model?: boolean | null;
    }>).filter(isBettableOddsRow),
    stake: toNumber(body.stake),
  });

  if (!quote.ok) {
    return jsonError(quote.message, 400, {
      code: quote.code,
      details: quote.details,
    });
  }

  return NextResponse.json(quote);
}
