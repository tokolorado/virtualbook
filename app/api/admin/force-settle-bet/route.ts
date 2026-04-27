import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;
type ManualSettleStatus = "won" | "lost" | "void";

const MANUAL_SETTLE_STATUSES = new Set<ManualSettleStatus>([
  "won",
  "lost",
  "void",
]);

function jsonError(message: string, status = 500, extra?: JsonObject) {
  return NextResponse.json(
    { ok: false, error: message, ...(extra ?? {}) },
    { status }
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseStatus(value: unknown): ManualSettleStatus | null {
  if (typeof value !== "string") return null;

  const status = value.trim().toLowerCase();

  return MANUAL_SETTLE_STATUSES.has(status as ManualSettleStatus)
    ? (status as ManualSettleStatus)
    : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req);

  if (!admin.ok) {
    return jsonError(admin.error, admin.status);
  }

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (!isJsonObject(body)) {
    return jsonError("Invalid JSON body", 400);
  }

  const betId = typeof body.betId === "string" ? body.betId.trim() : "";
  const status = parseStatus(body.status);

  if (!betId || !isUuid(betId)) {
    return jsonError("Invalid betId", 400);
  }

  if (!status) {
    return jsonError("Invalid status", 400, {
      allowedStatuses: [...MANUAL_SETTLE_STATUSES],
    });
  }

  const supabase = supabaseAdmin();

  const { data, error } = await supabase.rpc("admin_force_settle_bet", {
    p_bet_id: betId,
    p_status: status,
    p_admin_user_id: admin.userId,
  });

  if (error) {
    return jsonError("Manual settlement failed", 500, {
      detail: error.message,
    });
  }

  return NextResponse.json({
    ok: true,
    result: data,
  });
}

export async function GET() {
  return jsonError("Method Not Allowed", 405);
}
