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
        {
          ok: false,
          error: "Missing username",
          currentWinStreak: 0,
          currentLoseStreak: 0,
          bestWinStreak: 0,
          worstLoseStreak: 0,
        },
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
        {
          ok: false,
          error: "User not found",
          currentWinStreak: 0,
          currentLoseStreak: 0,
          bestWinStreak: 0,
          worstLoseStreak: 0,
        },
        { status: 404 }
      );
    }

    const { data: bets, error } = await supabase
      .from("bets")
      .select("created_at, status")
      .eq("user_id", profile.id)
      .in("status", ["won", "lost"])
      .order("created_at", { ascending: true })
      .limit(1000);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          currentWinStreak: 0,
          currentLoseStreak: 0,
          bestWinStreak: 0,
          worstLoseStreak: 0,
        },
        { status: 500 }
      );
    }

    const statuses = (bets ?? []).map((b: any) => String(b.status));

    let bestWinStreak = 0;
    let worstLoseStreak = 0;
    let tempWin = 0;
    let tempLose = 0;

    for (const status of statuses) {
      if (status === "won") {
        tempWin += 1;
        tempLose = 0;
        if (tempWin > bestWinStreak) bestWinStreak = tempWin;
      } else if (status === "lost") {
        tempLose += 1;
        tempWin = 0;
        if (tempLose > worstLoseStreak) worstLoseStreak = tempLose;
      }
    }

    let currentWinStreak = 0;
    let currentLoseStreak = 0;

    for (let i = statuses.length - 1; i >= 0; i--) {
      if (statuses[i] === "won") {
        if (currentLoseStreak > 0) break;
        currentWinStreak += 1;
      } else if (statuses[i] === "lost") {
        if (currentWinStreak > 0) break;
        currentLoseStreak += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      currentWinStreak,
      currentLoseStreak,
      bestWinStreak,
      worstLoseStreak,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? "Server error",
        currentWinStreak: 0,
        currentLoseStreak: 0,
        bestWinStreak: 0,
        worstLoseStreak: 0,
      },
      { status: 500 }
    );
  }
}