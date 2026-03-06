// app/api/surprise/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getUserFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token) return { user: null, error: "Unauthorized" };

  const sb = supabaseAdmin();

  const {
    data: { user },
    error,
  } = await sb.auth.getUser(token);

  if (error || !user) return { user: null, error: "Unauthorized" };

  return { user, error: null };
}

export async function GET(req: Request) {
  try {
    const { user, error } = await getUserFromBearer(req);
    if (error || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();

    const { data, error: qErr } = await sb
      .from("user_surprises")
      .select("id, message, is_active, shown_at")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .is("shown_at", null)
      .maybeSingle();

    if (qErr) {
      return NextResponse.json({ ok: false, error: qErr.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ ok: true, show: false });
    }

    return NextResponse.json({
      ok: true,
      show: true,
      surpriseId: data.id,
      message: data.message,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { user, error } = await getUserFromBearer(req);
    if (error || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();

    const { error: uErr } = await sb
      .from("user_surprises")
      .update({
        is_active: false,
        shown_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("is_active", true)
      .is("shown_at", null);

    if (uErr) {
      return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, acknowledged: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}