// app/api/admin/run-settle/route.ts
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

type JsonObject = Record<string, unknown>;

function jsonError(message: string, status = 500, extra?: JsonObject) {
  return NextResponse.json(
    { ok: false, error: message, ...(extra ?? {}) },
    { status }
  );
}

export async function POST(req: Request) {
  try {
    const guard = await requireAdmin(req);
    if (!guard.ok) {
      return jsonError(guard.error, guard.status);
    }

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
      method: "POST",
      headers: {
        "x-cron-secret": cronSecret,
      },
      cache: "no-store",
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return jsonError("cron/pipeline failed", r.status, { pipelineResponse: data });
    }

    return NextResponse.json({ ok: true, pipelineResponse: data });
   } catch (e: unknown) {
  return jsonError("Admin run-settle failed", 500, {
    detail: e instanceof Error ? e.message : String(e),
      });
    }
}

export async function GET() {
  return jsonError("Method Not Allowed", 405);
}