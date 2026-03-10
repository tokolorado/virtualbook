//app/api/users/[username]/bets/route.ts
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("username", decodedUsername)
      .limit(1)
      .maybeSingle();

    if (!profile?.id) {
      return NextResponse.json(
        { ok: false, error: "User not found", bets: [] },
        { status: 404 }
      );
    }

    const { data: bets, error } = await supabase
      .from("bets")
      .select("id, created_at, stake, total_odds, payout, status")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, bets: [] },
        { status: 500 }
      );
    }

    const normalized =
      bets?.map((b: any) => ({
        id: String(b.id),
        created_at: String(b.created_at),
        stake: Number(b.stake ?? 0),
        total_odds: Number(b.total_odds ?? 0),
        payout: Number(b.payout ?? 0),
        status: String(b.status ?? "unknown"),
      })) ?? [];

    return NextResponse.json({
      ok: true,
      bets: normalized,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error", bets: [] },
      { status: 500 }
    );
  }
}