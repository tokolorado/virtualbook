//app/api/cron/sync-runner/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function runSyncRunner(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "Missing CRON_SECRET in env" },
      { status: 500 }
    );
  }

  const host = request.headers.get("host");

  if (!host) {
    return NextResponse.json(
      { ok: false, error: "Missing host header" },
      { status: 400 }
    );
  }

  const proto =
    request.headers.get("x-forwarded-proto") ||
    (host.includes("localhost") ? "http" : "https");

  const baseUrl = `${proto}://${host}`;

  const res = await fetch(`${baseUrl}/api/admin/sync-runner`, {
    method: "POST",
    headers: {
      "x-cron-secret": cronSecret,
      "content-type": "application/json",
    },
    body: "{}",
    cache: "no-store",
  });

  const payload = await res.json().catch(() => null);

  return NextResponse.json(
    {
      ok: res.ok && payload?.ok !== false,
      delegatedStatus: res.status,
      delegatedEndpoint: "/api/admin/sync-runner",
      result: payload,
    },
    { status: res.ok ? 200 : res.status }
  );
}

export async function GET(request: NextRequest) {
  return runSyncRunner(request);
}

export async function POST(request: NextRequest) {
  return runSyncRunner(request);
}