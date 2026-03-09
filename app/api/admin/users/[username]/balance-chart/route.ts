//app/api/users/[username]/balance-chart/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export async function GET(
  req: Request,
  { params }: { params: { username: string } }
) {
  const sb = supabaseAdmin();

  const { data: user } = await sb
    .from("profiles")
    .select("id")
    .eq("username", params.username)
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
}