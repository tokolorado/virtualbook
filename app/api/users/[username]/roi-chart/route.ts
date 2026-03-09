import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type RouteContext = {
  params: Promise<{
    username: string;
  }>;
};

function fmtLabel(iso: string) {
  return new Date(iso).toLocaleDateString("pl-PL");
}

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
        { ok: false, error: "User not found", points: [] },
        { status: 404 }
      );
    }

    const { data: bets, error } = await supabase
      .from("bets")
      .select("created_at, stake, payout, status")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: true })
      .limit(1000);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, points: [] },
        { status: 500 }
      );
    }

    let cumulativeStake = 0;
    let cumulativeProfit = 0;

    const points =
      bets?.map((b: any, index: number) => {
        const stake = Number(b.stake ?? 0);
        const payout = Number(b.payout ?? 0);

        cumulativeStake += stake;
        cumulativeProfit += payout - stake;

        const roi =
          cumulativeStake > 0
            ? (cumulativeProfit / cumulativeStake) * 100
            : 0;

        return {
          x: index,
          label: fmtLabel(b.created_at),
          roi: Number(roi.toFixed(2)),
        };
      }) ?? [];

    return NextResponse.json({
      ok: true,
      points,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error", points: [] },
      { status: 500 }
    );
  }
}