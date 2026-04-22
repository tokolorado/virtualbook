//app/api/admin/system-check/latest/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const admin = await requireAdmin(req);

  if (!admin.ok) {
    return NextResponse.json(
      { ok: false, error: admin.error },
      { status: admin.status }
    );
  }

  const sb = supabaseAdmin();

  const { data: run, error: runErr } = await sb
    .from("system_check_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runErr) {
    return NextResponse.json(
      { ok: false, error: runErr.message },
      { status: 500 }
    );
  }

  if (!run) {
    return NextResponse.json({
      ok: true,
      run: null,
      results: [],
    });
  }

  const { data: results, error: resultsErr } = await sb
    .from("system_check_results")
    .select("*")
    .eq("run_id", run.id)
    .order("id", { ascending: true });

  if (resultsErr) {
    return NextResponse.json(
      { ok: false, error: resultsErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    run,
    results: results ?? [],
  });
}