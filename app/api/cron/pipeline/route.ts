// app/api/cron/pipeline/route.ts
import { NextResponse } from "next/server";
import { cronLogStart, cronLogSuccess, cronLogError } from "@/lib/cronLogger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

async function readJsonSafe(res: Response) {
  return res.json().catch(() => ({}));
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

    const origin = new URL(req.url).origin;

    const headers = {
      "Content-Type": "application/json",
      "x-cron-secret": cronSecret,
    };

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);

    const dateFrom = yesterday.toISOString().slice(0, 10);
    const dateTo = now.toISOString().slice(0, 10);
    const oddsDate = now.toISOString().slice(0, 10);

    // 0) odds sync
    // Nie blokujemy results/settle, jeśli odds padną.
    // To osobny obszar operacyjny, ale status ma być widoczny w logs/details.
    const r0 = await fetch(`${origin}/api/odds/sync`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        date: oddsDate,
        oddsTtlHours: 6,
        batchLimit: 30,
        throttleMs: 800,
        maxRetries: 2,
        engine: "v2",
      }),
      cache: "no-store",
    });
    const odds = await readJsonSafe(r0);

    // 1) results (stale-timed)
    const r1 = await fetch(`${origin}/api/cron/results?mode=stale-timed&limit=50`, {
      method: "POST",
      headers,
      cache: "no-store",
    });
    const results1 = await readJsonSafe(r1);

    // 1b) range: wczoraj -> dzisiaj
    const r1b = await fetch(
      `${origin}/api/cron/results?mode=range&dateFrom=${dateFrom}&dateTo=${dateTo}&limit=200`,
      {
        method: "POST",
        headers,
        cache: "no-store",
      }
    );
    const results1b = await readJsonSafe(r1b);

    // 2) settle
    const r2 = await fetch(`${origin}/api/cron/settle`, {
      method: "POST",
      headers,
      cache: "no-store",
    });
    const settle = await readJsonSafe(r2);

    const responseBody = {
      ok: true,
      steps: {
        odds_sync: { ok: r0.ok, status: r0.status, body: odds },
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