// app/api/bets/route.ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";

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
};

const MAX_ITEMS = 20;
const MAX_STAKE = 10000;

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    if (!body?.slip?.length) {
      return NextResponse.json({ error: "Kupon jest pusty." }, { status: 400 });
    }

    if (body.slip.length > MAX_ITEMS) {
      return NextResponse.json(
        { error: "Za dużo zdarzeń w kuponie." },
        { status: 400 }
      );
    }

    const stake = toNumber(body.stake);

    if (!Number.isFinite(stake) || stake <= 0) {
      return NextResponse.json(
        { error: "Nieprawidłowa stawka." },
        { status: 400 }
      );
    }

    if (stake > MAX_STAKE) {
      return NextResponse.json(
        { error: "Przekroczono maksymalną stawkę." },
        { status: 400 }
      );
    }

    const headerIdempotencyKey = nonEmpty(req.headers.get("x-idempotency-key"));
    const bodyIdempotencyKey = nonEmpty(body.idempotencyKey);

    if (
      bodyIdempotencyKey &&
      headerIdempotencyKey &&
      bodyIdempotencyKey !== headerIdempotencyKey
    ) {
      return NextResponse.json(
        { error: "Różne idempotency key w body i nagłówku." },
        { status: 400 }
      );
    }

    const idempotencyKey = bodyIdempotencyKey ?? headerIdempotencyKey;

    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "Brak idempotency key." },
        { status: 400 }
      );
    }

    if (
      (bodyIdempotencyKey && !isUuid(bodyIdempotencyKey)) ||
      (headerIdempotencyKey && !isUuid(headerIdempotencyKey))
    ) {
      return NextResponse.json(
        { error: "Nieprawidłowy idempotency key." },
        { status: 400 }
      );
    }

    const user = await requireUser(req);
    if (!user.ok) {
      return NextResponse.json({ error: user.error }, { status: user.status });
    }

    const payloadItems = body.slip.map((item) => {
      const matchId = toNumber(item.matchId);

      if (!Number.isFinite(matchId)) {
        throw new Error("Nieprawidłowy matchId.");
      }

      let kickoff = null;
      if (item.kickoffUtc) {
        const date = new Date(String(item.kickoffUtc));
        if (Number.isNaN(date.getTime())) {
          throw new Error("Nieprawidłowy kickoffUtc.");
        }
        kickoff = date.toISOString();
      }

      return {
        match_id_bigint: matchId,
        league: nonEmpty(item.league) || nonEmpty(item.competitionCode),
        home: nonEmpty(item.home),
        away: nonEmpty(item.away),
        market: normalizeMarket(item.market),
        pick: nonEmpty(item.pick),
        kickoff_at: kickoff,
      };
    });

    const { data, error } = await user.supabase.rpc("place_bet", {
      p_stake: stake,
      p_items: payloadItems,
      p_request_id: idempotencyKey,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      idempotencyKey,
      betId: data?.betId ?? null,
      stake: data?.stake ?? stake,
      totalOdds: data?.totalOdds ?? 0,
      potentialWin: data?.potentialWin ?? 0,
      balanceAfter: data?.balanceAfter ?? null,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500 }
    );
  }
}
