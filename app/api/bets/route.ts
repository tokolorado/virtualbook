// app/api/bets/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
};

function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function nonEmpty(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function normalizeMarket(m: unknown) {
  return String(m ?? "").trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    if (!body?.slip?.length) {
      return NextResponse.json({ error: "Kupon jest pusty." }, { status: 400 });
    }

    const stake = toNumber(body.stake);
    if (!Number.isFinite(stake) || stake <= 0) {
      return NextResponse.json({ error: "Nieprawidłowa stawka." }, { status: 400 });
    }

    // 🔐 Pobierz JWT z nagłówka
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!jwt) {
      return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
    }

    // ✅ Tworzymy klienta z tokenem usera (NIE service_role)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${jwt}`,
          },
        },
      }
    );

    const payloadItems = body.slip.map((it) => ({
      match_id_bigint: Number(it.matchId),
      league: nonEmpty(it.league) || nonEmpty(it.competitionCode),
      home: nonEmpty(it.home),
      away: nonEmpty(it.away),
      market: normalizeMarket(it.market),
      pick: nonEmpty(it.pick),
      kickoff_at: it.kickoffUtc
        ? new Date(String(it.kickoffUtc)).toISOString()
        : null,
    }));

    const { data, error } = await supabase.rpc("place_bet", {
      p_stake: stake,
      p_items: payloadItems,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      betId: data?.betId ?? null,
      stake: data?.stake ?? stake,
      totalOdds: data?.totalOdds ?? 0,
      potentialWin: data?.potentialWin ?? 0,
      balanceAfter: data?.balanceAfter ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}