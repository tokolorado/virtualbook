// app/api/admin/cron-logs/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_JOBS = new Set(["results", "settle", "pipeline"]);
const ALLOWED_STATUS = new Set(["started", "success", "error"]);

export async function GET(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();

    const {
      data: { user },
      error: userErr,
    } = await sb.auth.getUser(token);

    if (userErr || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data: adminRow, error: adminErr } = await sb
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminErr || !adminRow) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);

    const limitRaw = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 50;

    const jobRaw = (url.searchParams.get("job") ?? "all").toLowerCase().trim();
    const statusRaw = (url.searchParams.get("status") ?? "all").toLowerCase().trim();
    const errorsOnly = (url.searchParams.get("errorsOnly") ?? "false").toLowerCase() === "true";

    let query = sb
      .from("cron_logs")
      .select("id,job_name,status,source,started_at,finished_at,created_at,details")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (jobRaw !== "all" && ALLOWED_JOBS.has(jobRaw)) {
      query = query.eq("job_name", jobRaw);
    }

    if (errorsOnly) {
      query = query.eq("status", "error");
    } else if (statusRaw !== "all" && ALLOWED_STATUS.has(statusRaw)) {
      query = query.eq("status", statusRaw);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      filters: {
        limit,
        job: jobRaw,
        status: errorsOnly ? "error" : statusRaw,
        errorsOnly,
      },
      count: data?.length ?? 0,
      logs: data ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}