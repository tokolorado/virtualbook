// app/api/admin/run-settle/route.ts
import { NextResponse } from "next/server";

function jsonError(message: string, status = 500, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...(extra ?? {}) }, { status });
}

export async function POST(req: Request) {
  try {
    // ✅ admin guard (żeby ktoś z UI nie odpalił bez klucza)
    const expectedAdminKey = process.env.ADMIN_API_KEY;
    if (!expectedAdminKey) return jsonError("Missing ADMIN_API_KEY in env", 500);

    const gotAdminKey = req.headers.get("x-admin-key") || "";
    if (gotAdminKey !== expectedAdminKey) return jsonError("Unauthorized", 401);

    // ✅ cron secret do wywołania /api/cron/settle
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return jsonError("Missing CRON_SECRET in env", 500);

    const host = req.headers.get("host");
    if (!host) return jsonError("Missing host header", 400);

    const proto =
      req.headers.get("x-forwarded-proto") ||
      (host.includes("localhost") ? "http" : "https");

    const baseUrl = `${proto}://${host}`;

    const url = `${baseUrl}/api/cron/pipeline`;

    const r = await fetch(url, {
      method: "POST", // ✅ musi być POST
      headers: { 
        "x-cron-secret": cronSecret,
        "x-admin-key": expectedAdminKey
    }, // ✅ właściwy header
      cache: "no-store",
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return jsonError("cron/settle failed", r.status, { settleResponse: data });
    }

    return NextResponse.json({ ok: true, settleResponse: data });
  } catch (e: any) {
    return jsonError("Admin run-settle failed", 500, { detail: e?.message ?? String(e) });
  }
}

export async function GET() {
  return jsonError("Method Not Allowed", 405);
}