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

function utcDateYYYYMMDD(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(base: Date, days: number) {
  const d = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate())
  );
  d.setUTCDate(d.getUTCDate() + days);
  return d;
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

    // 0) enqueue rolling 14-day horizon
    const horizonDays = 14;
    const enqueueResults: any[] = [];

    for (let i = 0; i < horizonDays; i++) {
      const day = utcDateYYYYMMDD(addUtcDays(now, i));

      const r = await fetch(`${origin}/api/cron/enqueue-day`, {
        method: "POST",
        headers,
        body: JSON.stringify({ day }),
        cache: "no-store",
      });

      const body = await readJsonSafe(r);

      enqueueResults.push({
        day,
        ok: r.ok,
        status: r.status,
        body,
      });
    }

    // 1) drain fetch_queue
    // fetch-queue przetwarza tylko 1 dzień na wywołanie,
    // więc wołamy go wielokrotnie w ramach jednego pipeline run.
    const fetchQueueRuns: any[] = [];
    const maxFetchQueueRuns = 16;

    for (let i = 0; i < maxFetchQueueRuns; i++) {
      const r = await fetch(`${origin}/api/cron/fetch-queue`, {
        method: "POST",
        headers,
        cache: "no-store",
      });

      const body = await readJsonSafe(r);

      fetchQueueRuns.push({
        ok: r.ok,
        status: r.status,
        body,
      });

      if (!r.ok) break;

      if (body?.skipped && body?.reason === "no_pending_jobs") {
        break;
      }
    }

    // 2) odds sync — HORYZONT, nie tylko dziś
    const r0 = await fetch(`${origin}/api/odds/sync`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        oddsTtlHours: 6,
        batchLimit: 80,
        throttleMs: 800,
        maxRetries: 2,
        engine: "v2",
      }),
      cache: "no-store",
    });
    const odds = await readJsonSafe(r0);

    // 3) results (stale-timed)
    const r1 = await fetch(
      `${origin}/api/cron/results?mode=stale-timed&limit=50`,
      {
        method: "POST",
        headers,
        cache: "no-store",
      }
    );
    const results1 = await readJsonSafe(r1);

    // 3b) range: wczoraj -> dzisiaj
    const r1b = await fetch(
      `${origin}/api/cron/results?mode=range&dateFrom=${dateFrom}&dateTo=${dateTo}&limit=200`,
      {
        method: "POST",
        headers,
        cache: "no-store",
      }
    );
    const results1b = await readJsonSafe(r1b);

    // 4) settle
    const r2 = await fetch(`${origin}/api/cron/settle`, {
      method: "POST",
      headers,
      cache: "no-store",
    });
    const settle = await readJsonSafe(r2);

    const responseBody = {
      ok: true,
      steps: {
        enqueue_horizon: {
          total: enqueueResults.length,
          inserted: enqueueResults.filter((x) => x.body?.inserted).length,
          skipped_existing: enqueueResults.filter(
            (x) => x.body?.reason === "already_exists"
          ).length,
          items: enqueueResults,
        },
        fetch_queue_drain: {
          total_runs: fetchQueueRuns.length,
          processed_days: fetchQueueRuns.filter((x) => x.body?.day).length,
          stopped_on_empty_queue: fetchQueueRuns.some(
            (x) => x.body?.skipped && x.body?.reason === "no_pending_jobs"
          ),
          items: fetchQueueRuns,
        },
        odds_sync_horizon: { ok: r0.ok, status: r0.status, body: odds },
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