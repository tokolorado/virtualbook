import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireCronSecret } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const { day } = await req.json(); // YYYY-MM-DD

    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return jsonError("Invalid day format (YYYY-MM-DD required)");
    }

    const sb = supabaseAdmin();

    const { data: existing, error: readErr } = await sb
      .from("fetch_queue")
      .select("day,status,attempts,last_run_at,next_run_at,last_error")
      .eq("day", day)
      .maybeSingle();

    if (readErr) return jsonError(readErr.message, 500);

    if (existing) {
      return NextResponse.json({
        ok: true,
        day,
        skipped: true,
        reason: "already_exists",
        existing,
      });
    }

    const { error: insertErr } = await sb.from("fetch_queue").insert({
      day,
      status: "pending",
      attempts: 0,
      last_run_at: null,
      next_run_at: new Date().toISOString(),
      last_error: null,
    });

    if (insertErr) return jsonError(insertErr.message, 500);

    return NextResponse.json({ ok: true, day, inserted: true });
  } catch (e: any) {
    return jsonError(e?.message || "Server error", 500);
  }
}