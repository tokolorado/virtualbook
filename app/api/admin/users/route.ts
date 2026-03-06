// app/api/admin/users/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return json(guard.status, { ok: false, error: guard.error });
  }

  try {
    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,balance_vb")
      .order("created_at", { ascending: false });

    if (error) {
      return json(500, { ok: false, error: error.message });
    }

    return json(200, {
      ok: true,
      users: (data ?? []).map((u: any) => ({
        id: u.id,
        email: u.email,
        balance_vb: Number(u.balance_vb ?? 0),
      })),
    });
  } catch (e: any) {
    return json(500, {
      ok: false,
      error: e?.message ?? "Server error",
    });
  }
}