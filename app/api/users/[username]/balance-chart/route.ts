import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

type RouteContext = {
  params: Promise<{
    username: string;
  }>;
};

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { username } = await context.params;
    const sb = supabaseAdmin();

    const { data: user } = await sb
      .from("profiles")
      .select("id")
      .eq("username", username)
      .single();

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { data } = await sb
      .from("vb_ledger")
      .select("created_at,balance_after")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    return NextResponse.json(data ?? []);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}