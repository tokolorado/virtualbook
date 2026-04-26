import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function readNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  const guard = await requireAdmin(req);

  if (!guard.ok) {
    return json(guard.status, { ok: false, error: guard.error });
  }

  try {
    const body = await req.json().catch(() => null);
    const matchId = readNumber(body?.matchId);

    if (!matchId || matchId <= 0) {
      return json(400, { ok: false, error: "Nieprawidłowy matchId." });
    }

    const supabase = supabaseAdmin();
    const nowIso = new Date().toISOString();

    const { error } = await supabase
      .from("match_mapping_queue")
      .update({
        status: "pending",
        locked_at: null,
        locked_by: null,
        updated_at: nowIso,
      })
      .eq("match_id", matchId);

    if (error) {
      return json(500, {
        ok: false,
        error: `Nie udało się przywrócić do pending: ${error.message}`,
      });
    }

    await supabase.from("admin_audit_logs").insert({
      admin_user_id: guard.userId,
      action: "ADMIN_MATCH_MAPPING_BACK_TO_PENDING",
      target_user_id: null,
      details: { matchId },
    });

    return json(200, {
      ok: true,
      matchId,
    });
  } catch (e: unknown) {
    return json(500, {
      ok: false,
      error: e instanceof Error ? e.message : "Nie udało się przywrócić do pending.",
    });
  }
}