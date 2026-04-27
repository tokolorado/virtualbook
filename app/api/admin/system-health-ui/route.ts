// app/api/admin/system-health-ui/route.ts
import { NextResponse } from "next/server";
import { getSystemHealth, parseSystemHealthParams } from "@/lib/admin/systemHealth";
import { requireAdmin } from "@/lib/requireAdmin";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return json(guard.status, { ok: false, error: guard.error });
  }

  try {
    const health = await getSystemHealth(
      supabaseAdmin(),
      parseSystemHealthParams(new URL(req.url))
    );

    return json(200, {
      ok: true,
      ...health,
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: errorMessage(error),
    });
  }
}
