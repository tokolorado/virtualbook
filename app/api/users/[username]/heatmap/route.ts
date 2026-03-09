import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type RouteContext = {
  params: Promise<{
    username: string;
  }>;
};

function dateKey(d: string) {
  return new Date(d).toISOString().slice(0, 10);
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { username } = await context.params;
    const decodedUsername = decodeURIComponent(username).trim();

    if (!decodedUsername) {
      return NextResponse.json(
        { ok: false, error: "Missing username", cells: [] },
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
        { ok: false, error: "User not found", cells: [] },
        { status: 404 }
      );
    }

    const since = new Date();
    since.setDate(since.getDate() - 180);

    const { data: bets, error } = await supabase
      .from("bets")
      .select("created_at, status")
      .eq("user_id", profile.id)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, cells: [] },
        { status: 500 }
      );
    }

    const map = new Map<
      string,
      { won: number; lost: number; void: number }
    >();

    for (const b of bets ?? []) {
      const key = dateKey((b as any).created_at);
      if (!map.has(key)) {
        map.set(key, { won: 0, lost: 0, void: 0 });
      }

      const entry = map.get(key)!;
      const status = String((b as any).status ?? "");

      if (status === "won") entry.won += 1;
      else if (status === "lost") entry.lost += 1;
      else entry.void += 1;
    }

    const cells: any[] = [];

    for (let i = 0; i < 180; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);

      const key = dateKey(d.toISOString());
      const entry = map.get(key);

      let result: "won" | "lost" | "void" | "none" = "none";
      let count = 0;

      if (entry) {
        count = entry.won + entry.lost + entry.void;

        if (entry.won >= entry.lost && entry.won >= entry.void) {
          result = "won";
        } else if (entry.lost >= entry.won && entry.lost >= entry.void) {
          result = "lost";
        } else {
          result = "void";
        }
      }

      cells.push({
        date: key,
        result,
        count,
      });
    }

    cells.reverse();

    return NextResponse.json({
      ok: true,
      cells,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error", cells: [] },
      { status: 500 }
    );
  }
}