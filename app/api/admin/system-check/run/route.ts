import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SuiteCheck = {
  checkKey: string;
  severity: "info" | "warning" | "critical";
  ok: boolean;
  rowsCount: number;
  sample: unknown[];
  details?: Record<string, unknown>;
};

export async function POST(req: Request) {
  const admin = await requireAdmin(req);

  if (!admin.ok) {
    return NextResponse.json(
      { ok: false, error: admin.error },
      { status: admin.status }
    );
  }

  const sb = supabaseAdmin();
  let runId: number | null = null;

  try {
    const { data: runRow, error: runErr } = await sb
      .from("system_check_runs")
      .insert({
        started_by: admin.userId,
        source: "admin_manual",
        status: "running",
      })
      .select("id")
      .single();

    if (runErr) throw runErr;
    runId = runRow.id;

    const { data: suite, error: suiteErr } = await sb.rpc(
      "run_system_check_suite",
      { p_limit: 20 }
    );

    if (suiteErr) throw suiteErr;

    const checks: SuiteCheck[] = Array.isArray(suite?.checks) ? suite.checks : [];

    if (checks.length > 0) {
      const rows = checks.map((c) => ({
        run_id: runId,
        check_key: c.checkKey,
        severity: c.severity,
        ok: c.ok,
        rows_count: c.rowsCount,
        sample: Array.isArray(c.sample) ? c.sample : [],
        details: c.details ?? {},
      }));

      const { error: insertResultsErr } = await sb
        .from("system_check_results")
        .insert(rows);

      if (insertResultsErr) throw insertResultsErr;
    }

    const checksTotal =
      typeof suite?.checksTotal === "number" ? suite.checksTotal : checks.length;
    const checksPassed =
      typeof suite?.checksPassed === "number"
        ? suite.checksPassed
        : checks.filter((x) => x.ok).length;
    const checksFailed =
      typeof suite?.checksFailed === "number"
        ? suite.checksFailed
        : checksTotal - checksPassed;
    const ok = typeof suite?.ok === "boolean" ? suite.ok : checksFailed === 0;

    const finishedAt = new Date().toISOString();

    const { error: updateRunErr } = await sb
      .from("system_check_runs")
      .update({
        finished_at: finishedAt,
        status: "success",
        ok,
        checks_total: checksTotal,
        checks_passed: checksPassed,
        checks_failed: checksFailed,
        summary: suite ?? {},
        error: null,
      })
      .eq("id", runId);

    if (updateRunErr) throw updateRunErr;

    await sb.from("admin_audit_logs").insert({
      admin_user_id: admin.userId,
      action: "system_check_run",
      target_user_id: null,
      details: {
        runId,
        ok,
        checksTotal,
        checksPassed,
        checksFailed,
        failedChecks: checks.filter((x) => !x.ok).map((x) => x.checkKey),
      },
    });

    return NextResponse.json({
      ok: true,
      run: {
        id: runId,
        started_by: admin.userId,
        source: "admin_manual",
        status: "success",
        ok,
        finished_at: finishedAt,
        checks_total: checksTotal,
        checks_passed: checksPassed,
        checks_failed: checksFailed,
      },
      results: checks,
      summary: suite ?? {},
    });
  } catch (e: any) {
    const errorMessage = e?.message || "System check failed";

    if (runId !== null) {
      await sb
        .from("system_check_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "failed",
          ok: false,
          error: errorMessage,
        })
        .eq("id", runId);
    }

    await sb.from("admin_audit_logs").insert({
      admin_user_id: admin.userId,
      action: "system_check_run_failed",
      target_user_id: null,
      details: {
        runId,
        error: errorMessage,
      },
    });

    return NextResponse.json(
      { ok: false, error: errorMessage, runId },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Method Not Allowed" },
    { status: 405 }
  );
}