// app/api/odds/sync/route.ts

import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

export async function POST(req: Request) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  return NextResponse.json({
    ok: true,
    disabled: true,
    provider: "bsd",
    endpoint: "/api/odds/sync",
    message:
      "Old odds engine sync is disabled. Odds are now imported from BSD via /api/admin/bsd/matches/sync.",
  });
}

export async function GET() {
  return jsonError("Use POST. Old odds engine sync is disabled.", 405, {
    disabled: true,
    provider: "bsd",
  });
}