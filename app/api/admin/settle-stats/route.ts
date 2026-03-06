// app/api/admin/settle-stats/route.ts
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { createClient } from "@supabase/supabase-js";

function jsonError(message: string, status = 500, extra?: any) {
  return NextResponse.json({ error: message, ...extra }, { status });
}


export async function GET(req: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) return jsonError("Missing SUPABASE_URL in env", 500);
  if (!serviceKey) return jsonError("Missing SUPABASE_SERVICE_ROLE_KEY in env", 500);

    const guard = await requireAdmin(req);
    if (!guard.ok) {
    return NextResponse.json(
        { ok: false, error: guard.error },
        { status: guard.status }
    );
    }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { searchParams } = new URL(req.url);
  const bufferMinutes = Math.max(Number(searchParams.get("bufferMinutes") ?? 10), 0);

  const cutoffIso = new Date(Date.now() - bufferMinutes * 60_000).toISOString();

  // 1) policz nierozliczone bet_items "po kickoffie"
  const { data: rows, error } = await supabase
    .from("bet_items")
    .select("match_id,kickoff_at,settled")
    .or("settled.is.false,settled.is.null")
    .not("match_id", "is", null)
    .lte("kickoff_at", cutoffIso)
    .limit(5000);

  if (error) return jsonError("DB query failed (bet_items)", 500, { detail: error });

  const uniq = new Set<string>();
  for (const r of rows ?? []) {
    const id = String((r as any).match_id ?? "");
    if (id) uniq.add(id);
  }

  return NextResponse.json({
    ok: true,
    bufferMinutes,
    cutoffIso,
    readyItems: (rows ?? []).length,
    readyMatches: uniq.size,
  });
}