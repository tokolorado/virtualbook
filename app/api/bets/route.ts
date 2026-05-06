// app/api/bets/route.ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { priceBetBuilderSlip } from "@/lib/bets/betBuilderPricing";
import { priceAccumulatorSlip } from "@/lib/bets/slipPricing";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SlipItem = {
  matchId: string | number;
  competitionCode?: string;
  league?: string;
  home?: string;
  away?: string;
  kickoffUtc?: string;
  market: string;
  pick: string;
};

type Body = {
  slip: SlipItem[];
  stake: number;
  idempotencyKey?: string;
  mode?: "standard" | "bet_builder";
};

const MAX_ITEMS = 20;
const MAX_STAKE = 10000;
const DISPLAYABLE_BSD_SOURCE = "bsd";
const DISPLAYABLE_BSD_PRICING_METHOD = "bsd_market_normalized";
const INTERNAL_FALLBACK_SOURCE = "internal_model";
const INTERNAL_FALLBACK_PRICING_METHOD = "internal_model_fallback";

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function nonEmpty(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function normalizeMarket(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function payloadItemKey(item: {
  match_id_bigint: number;
  market: string;
  pick: string | null;
}) {
  return `${item.match_id_bigint}|${item.market}|${item.pick ?? ""}`;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error";
}

function jsonError(
  message: string,
  status = 500,
  extra?: Record<string, unknown>
) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
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
  try {
    const body = (await req.json()) as Body;
    const mode = body.mode === "bet_builder" ? "bet_builder" : "standard";

    if (!body?.slip?.length) {
      return jsonError("Kupon jest pusty.", 400);
    }

    if (body.slip.length > MAX_ITEMS) {
      return jsonError("Za duzo zdarzen w kuponie.", 400);
    }

    const stake = toNumber(body.stake);

    if (!Number.isFinite(stake) || stake <= 0) {
      return jsonError("Nieprawidlowa stawka.", 400);
    }

    if (stake > MAX_STAKE) {
      return jsonError("Przekroczono maksymalna stawke.", 400);
    }

    const standardPricing =
      mode === "standard" ? priceAccumulatorSlip(body.slip) : null;

    if (standardPricing && !standardPricing.ok) {
      return jsonError(standardPricing.message, 400, {
        code: standardPricing.code,
        conflicts: standardPricing.conflicts,
      });
    }

    const headerIdempotencyKey = nonEmpty(req.headers.get("x-idempotency-key"));
    const bodyIdempotencyKey = nonEmpty(body.idempotencyKey);

    if (
      bodyIdempotencyKey &&
      headerIdempotencyKey &&
      bodyIdempotencyKey !== headerIdempotencyKey
    ) {
      return jsonError("Rozne idempotency key w body i naglowku.", 400);
    }

    const idempotencyKey = bodyIdempotencyKey ?? headerIdempotencyKey;

    if (!idempotencyKey) {
      return jsonError("Brak idempotency key.", 400);
    }

    if (
      (bodyIdempotencyKey && !isUuid(bodyIdempotencyKey)) ||
      (headerIdempotencyKey && !isUuid(headerIdempotencyKey))
    ) {
      return jsonError("Nieprawidlowy idempotency key.", 400);
    }

    const user = await requireUser(req);
    if (!user.ok) {
      return jsonError(user.error, user.status);
    }

    const payloadItems = body.slip.map((item) => {
      const matchId = toNumber(item.matchId);

      if (!Number.isFinite(matchId)) {
        throw new Error("Nieprawidlowy matchId.");
      }

      let kickoff = null;

      if (item.kickoffUtc) {
        const date = new Date(String(item.kickoffUtc));

        if (Number.isNaN(date.getTime())) {
          throw new Error("Nieprawidlowy kickoffUtc.");
        }

        kickoff = date.toISOString();
      }

      return {
        match_id_bigint: Math.trunc(matchId),
        league: nonEmpty(item.league) || nonEmpty(item.competitionCode),
        home: nonEmpty(item.home),
        away: nonEmpty(item.away),
        market: normalizeMarket(item.market),
        pick: nonEmpty(item.pick),
        kickoff_at: kickoff,
      };
    });

    if (mode === "standard") {
      const matchIds = Array.from(
        new Set(payloadItems.map((item) => item.match_id_bigint))
      );

      const admin = supabaseAdmin();
      const { data: oddsRows, error: oddsError } = await admin
        .from("odds")
        .select("match_id,market_id,selection,book_odds,source,pricing_method,is_model")
        .in("match_id", matchIds)
        .or(`source.eq.${DISPLAYABLE_BSD_SOURCE},source.eq.${INTERNAL_FALLBACK_SOURCE}`);

      if (oddsError) {
        return jsonError("Nie udalo sie pobrac kursow do kuponu.", 500, {
          detail: oddsError.message,
        });
      }

      const activeOdds = new Set(
        ((oddsRows ?? []) as Array<{
          match_id: number | string;
          market_id: string;
          selection: string;
          book_odds: number | string | null;
          source: string | null;
          pricing_method: string | null;
          is_model: boolean | null;
        }>)
          .filter((row) => {
            const odd = toNumber(row.book_odds);
            return Number.isFinite(odd) && odd > 1 && isBettableOddsRow(row);
          })
          .map(
            (row) =>
              `${Math.trunc(toNumber(row.match_id))}|${normalizeMarket(
                row.market_id
              )}|${nonEmpty(row.selection) ?? ""}`
          )
      );

      const allItemsHaveBettableOdds = payloadItems.every((item) =>
        activeOdds.has(payloadItemKey(item))
      );

      if (!allItemsHaveBettableOdds) {
        return jsonError("Jeszcze nie ma kursów dla tego meczu.", 400, {
          code: "missing_odds",
        });
      }

      const { data, error } = await user.supabase.rpc("place_bet", {
        p_stake: stake,
        p_items: payloadItems,
        p_request_id: idempotencyKey,
      });

      if (error) {
        return jsonError(error.message, 400);
      }

      return NextResponse.json({
        ok: true,
        mode,
        idempotencyKey,
        betId: data?.betId ?? null,
        stake: data?.stake ?? stake,
        totalOdds: data?.totalOdds ?? 0,
        potentialWin: data?.potentialWin ?? 0,
        balanceAfter: data?.balanceAfter ?? null,
      });
    }

    const matchIds = Array.from(
      new Set(payloadItems.map((item) => item.match_id_bigint))
    );

    if (matchIds.length !== 1) {
      return jsonError("Bet Builder dziala tylko dla jednego meczu naraz.", 400, {
        code: "multi_match",
      });
    }

    const admin = supabaseAdmin();

    const { data: oddsRows, error: oddsError } = await admin
      .from("odds")
      .select("market_id,selection,fair_prob,book_odds,source,pricing_method,is_model")
      .eq("match_id", matchIds[0])
      .or(`source.eq.${DISPLAYABLE_BSD_SOURCE},source.eq.${INTERNAL_FALLBACK_SOURCE}`);

    if (oddsError) {
      return jsonError("Nie udalo sie pobrac kursow do Bet Buildera.", 500, {
        detail: oddsError.message,
      });
    }

    const builderPricing = priceBetBuilderSlip({
      items: body.slip,
      oddsRows: ((oddsRows ?? []) as Array<{
        market_id: string;
        selection: string;
        fair_prob?: number | string | null;
        book_odds?: number | string | null;
        source?: string | null;
        pricing_method?: string | null;
        is_model?: boolean | null;
      }>).filter(isBettableOddsRow),
      stake,
    });

    if (!builderPricing.ok) {
      return jsonError(builderPricing.message, 400, {
        code: builderPricing.code,
        details: builderPricing.details,
      });
    }

    const { data, error } = await user.supabase.rpc("place_bet_builder", {
      p_user_id: user.userId,
      p_stake: stake,
      p_items: payloadItems,
      p_request_id: idempotencyKey,
      p_total_odds: builderPricing.totalOdds,
      p_pricing_meta: builderPricing.meta,
    });

    if (error) {
      return jsonError(error.message, 400);
    }

    return NextResponse.json({
      ok: true,
      mode,
      idempotencyKey,
      betId: data?.betId ?? null,
      stake: data?.stake ?? stake,
      totalOdds: data?.totalOdds ?? builderPricing.totalOdds,
      potentialWin: data?.potentialWin ?? builderPricing.potentialWin ?? 0,
      balanceAfter: data?.balanceAfter ?? null,
      pricing: {
        jointProbability: builderPricing.jointProbability,
        productOdds: builderPricing.productOdds,
        correlationFactor: builderPricing.correlationFactor,
      },
    });
  } catch (error: unknown) {
    return jsonError(errorMessage(error), 500);
  }
}
