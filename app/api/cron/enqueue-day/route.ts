import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireCronSecret } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FUTURE_REFRESH_HOURS = 12;
const LEGACY_FROZEN_THRESHOLD_HOURS = 24;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function utcTodayYYYYMMDD() {
  return new Date().toISOString().slice(0, 10);
}

function parseMs(v: unknown): number | null {
  if (!v) return null;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
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
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const today = utcTodayYYYYMMDD();

    const { data: existing, error: readErr } = await sb
      .from("fetch_queue")
      .select("day,status,attempts,last_run_at,next_run_at,last_error")
      .eq("day", day)
      .maybeSingle();

    if (readErr) return jsonError(readErr.message, 500);

    if (!existing) {
      const { error: insertErr } = await sb.from("fetch_queue").insert({
        day,
        status: "pending",
        attempts: 0,
        last_run_at: null,
        next_run_at: nowIso,
        last_error: null,
      });

      if (insertErr) return jsonError(insertErr.message, 500);

      return NextResponse.json({
        ok: true,
        day,
        inserted: true,
      });
    }

    const nextRunMs = parseMs(existing.next_run_at);
    const isFutureOrToday = day >= today;

    const dueForRefresh =
      nextRunMs == null || nextRunMs <= nowMs;

    const legacyFrozen =
      nextRunMs != null &&
      nextRunMs - nowMs > LEGACY_FROZEN_THRESHOLD_HOURS * 60 * 60 * 1000;

    const shouldRearm =
      isFutureOrToday &&
      existing.status !== "pending" &&
      (dueForRefresh || legacyFrozen);

    if (shouldRearm) {
      const { error: updateErr } = await sb
        .from("fetch_queue")
        .update({
          status: "pending",
          next_run_at: nowIso,
          last_error: null,
        })
        .eq("day", day);

      if (updateErr) return jsonError(updateErr.message, 500);

      return NextResponse.json({
        ok: true,
        day,
        rearmed: true,
        reason: legacyFrozen ? "legacy_frozen_queue_day" : "refresh_due",
        refreshHours: FUTURE_REFRESH_HOURS,
      });
    }

    return NextResponse.json({
      ok: true,
      day,
      skipped: true,
      reason:
        existing.status === "pending"
          ? "already_pending"
          : "already_exists_and_not_due",
      existing,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Server error", 500);
  }
}