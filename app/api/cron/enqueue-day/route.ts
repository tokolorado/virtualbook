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
    const { day } = await req.json(); // format: YYYY-MM-DD

    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return jsonError("Invalid day format (YYYY-MM-DD required)");
    }

    const sb = supabaseAdmin();

    const { error } = await sb
      .from("fetch_queue")
      .upsert(
        {
          day,
          status: "pending",
          next_run_at: new Date().toISOString(),
        },
        { onConflict: "day" }
      );

    if (error) return jsonError(error.message, 500);

    return NextResponse.json({ ok: true, day });
  } catch (e: any) {
    return jsonError(e?.message || "Server error", 500);
  }
}