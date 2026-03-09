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

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .ilike("username", decodedUsername)
      .limit(1)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json(
        { ok: false, error: profileError.message },
        { status: 500 }
      );
    }

    if (!profile?.id) {
      return NextResponse.json(
        { ok: false, error: "User not found", points: [] },
        { status: 404 }
      );
    }

    const { data: ledgerRows, error: ledgerError } = await supabase
      .from("vb_ledger")
      .select("id, created_at, balance_after")
      .eq("user_id", profile.id)
      .not("balance_after", "is", null)
      .order("created_at", { ascending: true })
      .limit(1000);

    if (ledgerError) {
      return NextResponse.json(
        { ok: false, error: ledgerError.message },
        { status: 500 }
      );
    }

    const normalized = (ledgerRows ?? [])
      .map((row) => ({
        id: String((row as any).id),
        created_at: String((row as any).created_at),
        balance_after: Number((row as any).balance_after ?? 0),
      }))
      .sort((a, b) => {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        if (ta !== tb) return ta - tb;
        if (a.balance_after !== b.balance_after) {
          return a.balance_after - b.balance_after;
        }
        return a.id.localeCompare(b.id);
      });

    const points = normalized.map((row, index) => ({
      x: index,
      label: fmtLabel(row.created_at),
      balance: row.balance_after,
    }));

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