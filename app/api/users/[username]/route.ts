import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type RouteContext = {
  params: Promise<{
    username: string;
  }>;
};

type PublicLeaderboardRow = {
  id: string;
  username: string | null;
  balance_vb: number | string | null;
  bets_count: number | string | null;
  won_bets: number | string | null;
  lost_bets: number | string | null;
  void_bets: number | string | null;
  profit: number | string | null;
  roi: number | string | null;
  winrate: number | string | null;
};

const PUBLIC_PROFILE_FIELDS = [
  "id",
  "username",
  "balance_vb",
  "bets_count",
  "won_bets",
  "lost_bets",
  "void_bets",
  "profit",
  "roi",
  "winrate",
].join(",");

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error";
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { username } = await context.params;
    const decodedUsername = decodeURIComponent(username).trim();

    if (!decodedUsername || decodedUsername.length > 40) {
      return NextResponse.json(
        { ok: false, error: "Missing username" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { data, error } = await supabase
      .from("leaderboard_global")
      .select(PUBLIC_PROFILE_FIELDS)
      .ilike("username", decodedUsername)
      .limit(1)
      .maybeSingle<PublicLeaderboardRow>();

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
        balance_vb: numberValue(data.balance_vb),
        bets_count: numberValue(data.bets_count),
        won_bets: numberValue(data.won_bets),
        lost_bets: numberValue(data.lost_bets),
        void_bets: numberValue(data.void_bets),
        profit: numberValue(data.profit),
        roi: numberValue(data.roi),
        winrate: numberValue(data.winrate),
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
