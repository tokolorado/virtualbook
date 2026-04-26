//app/api/admin/match-mapping/assign/route.ts
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

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export async function POST(req: Request) {
  const guard = await requireAdmin(req);

  if (!guard.ok) {
    return json(guard.status, { ok: false, error: guard.error });
  }

  try {
    const body = await req.json().catch(() => null);

    const matchId = readNumber(body?.matchId);
    const sofascoreEventId = readNumber(body?.sofascoreEventId);
    const confidence = readNumber(body?.confidence) ?? 1;
    const notes = readString(body?.notes, "manual review assign");
    const mappingMethod = readString(body?.mappingMethod, "manual");

    if (!matchId || matchId <= 0) {
      return json(400, { ok: false, error: "Nieprawidłowy matchId." });
    }

    if (!sofascoreEventId || sofascoreEventId <= 0) {
      return json(400, { ok: false, error: "Nieprawidłowy SofaScore event ID." });
    }

    const supabase = supabaseAdmin();
    const nowIso = new Date().toISOString();

    const { error: upsertMapError } = await supabase
      .from("match_sofascore_map")
      .upsert(
        {
          match_id: matchId,
          sofascore_event_id: sofascoreEventId,
          mapping_method: mappingMethod,
          confidence,
          notes,
          widget_src: "admin-assign",
          updated_at: nowIso,
        },
        { onConflict: "match_id" }
      );

    if (upsertMapError) {
      return json(500, {
        ok: false,
        error: `Nie udało się zapisać mapowania: ${upsertMapError.message}`,
      });
    }

    const { error: updateQueueError } = await supabase
      .from("match_mapping_queue")
      .update({
        status: "mapped",
        attempts: 0,
        last_error: null,
        locked_at: null,
        locked_by: null,
        mapped_at: nowIso,
        updated_at: nowIso,
      })
      .eq("match_id", matchId);

    if (updateQueueError) {
      return json(500, {
        ok: false,
        error: `Nie udało się zaktualizować kolejki: ${updateQueueError.message}`,
      });
    }

    await supabase.from("admin_audit_logs").insert({
      admin_user_id: guard.userId,
      action: "ADMIN_MATCH_MAPPING_ASSIGN",
      target_user_id: null,
      details: {
        matchId,
        sofascoreEventId,
        confidence,
        mappingMethod,
        notes,
      },
    });

    return json(200, {
      ok: true,
      matchId,
      sofascoreEventId,
    });
  } catch (e: unknown) {
    return json(500, {
      ok: false,
      error: e instanceof Error ? e.message : "Nie udało się przypisać mapowania.",
    });
  }
}