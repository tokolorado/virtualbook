import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type RouteContext = {
  params: Promise<{
    username: string;
  }>;
};

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { username } = await context.params;
    const decodedUsername = decodeURIComponent(username).trim();

    if (!decodedUsername) {
      return NextResponse.json(
        { ok: false, error: "Missing username" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from("leaderboard_global")
      .select("*")
      .ilike("username", decodedUsername)
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "User not found", profile: null },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      profile: {
        id: String(data.id),
        username: String(data.username ?? decodedUsername),
        balance_vb: Number(data.balance_vb ?? 0),
        bets_count: Number(data.bets_count ?? 0),
        won_bets: Number(data.won_bets ?? 0),
        lost_bets: Number(data.lost_bets ?? 0),
        void_bets: Number(data.void_bets ?? 0),
        profit: Number(data.profit ?? 0),
        roi: Number(data.roi ?? 0),
        winrate: Number(data.winrate ?? 0),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}