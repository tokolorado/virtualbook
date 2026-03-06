// app/api/cron/pipeline/route.ts
import { NextResponse } from "next/server";
import { cronLogStart, cronLogSuccess, cronLogError } from "@/lib/cronLogger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  let logId: number | null = null;

  try {
    logId = await cronLogStart("pipeline", "github-actions");

    const cronSecret = process.env.CRON_SECRET;
    const gotSecret = req.headers.get("x-cron-secret") || "";

    if (!cronSecret) {
      await cronLogSuccess(logId, {
        ok: false,
        job: "pipeline",
        reason: "missing_cron_secret_env",
      });
      return json(500, { ok: false, error: "Missing CRON_SECRET in env" });
    }

    if (gotSecret !== cronSecret) {
      await cronLogSuccess(logId, {
        ok: false,
        job: "pipeline",
        reason: "unauthorized",
      });
      return json(401, { ok: false, error: "Unauthorized" });
    }

    // bazujemy na aktualnym origin (działa i lokalnie i na prod)
    const origin = new URL(req.url).origin;

    const headers = {
      "x-cron-secret": cronSecret,
    };

    // 1) results (stale-timed)
    const r1 = await fetch(`${origin}/api/cron/results?mode=stale-timed&limit=50`, {
      method: "POST",
      headers,
      cache: "no-store",
    });
    const results1 = await r1.json().catch(() => ({}));

    // 1b) (opcjonalnie, ale bardzo pomocne) range: wczoraj -> dzisiaj
    // jeśli chcesz, pipeline będzie “dociągał brakujące” mecze nawet jak nie były w matches
    const now = new Date();
    const y = new Date(now.getTime() - 24 * 3600 * 1000);
    const dateFrom = y.toISOString().slice(0, 10);
    const dateTo = now.toISOString().slice(0, 10);

    const r1b = await fetch(
      `${origin}/api/cron/results?mode=range&dateFrom=${dateFrom}&dateTo=${dateTo}&limit=200`,
      {
        method: "POST",
        headers,
        cache: "no-store",
      }
    );
    const results1b = await r1b.json().catch(() => ({}));

    // 2) settle
    const r2 = await fetch(`${origin}/api/cron/settle`, {
      method: "POST",
      headers,
      cache: "no-store",
    });
    const settle = await r2.json().catch(() => ({}));

    const responseBody = {
      ok: true,
      steps: {
        results_stale_timed: { ok: r1.ok, status: r1.status, body: results1 },
        results_range: { ok: r1b.ok, status: r1b.status, body: results1b },
        settle: { ok: r2.ok, status: r2.status, body: settle },
      },
    };

    await cronLogSuccess(logId, {
      job: "pipeline",
      ...responseBody,
    });

    return json(200, responseBody);
  } catch (e: any) {
    await cronLogError(logId, e);
    return json(500, { ok: false, error: e?.message ?? String(e) });
  }
}

export async function GET() {
  return json(405, { ok: false, error: "Method Not Allowed" });
}