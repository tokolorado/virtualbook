//app/api/cron/pipeline/route.ts
import { NextResponse } from "next/server";
import { cronLogStart, cronLogSuccess, cronLogError } from "@/lib/cronLogger";
import { getCronSecretAuthResult } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

type PipelineStepResult = {
  ok: boolean;
  status: number;
  body: JsonRecord;
};

type EnqueueStepResult = PipelineStepResult & {
  day: string;
};

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonSafe(res: Response): Promise<JsonRecord> {
  const data: unknown = await res.json().catch(() => ({}));
  return isRecord(data) ? data : {};
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

    const auth = getCronSecretAuthResult(req);
    if (!auth.ok) {
      await cronLogSuccess(logId, {
        ok: false,
        job: "pipeline",
        reason: auth.reason,
      });
      return json(auth.status, { ok: false, error: auth.error });
    }

    const cronSecret = auth.secret;
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
    const enqueueResults: EnqueueStepResult[] = [];

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
    const fetchQueueRuns: PipelineStepResult[] = [];
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

    // 2) BSD odds horizon sync — rolling 14 days via delegated BSD endpoint
    const bsdOddsSyncDays = 14;

    const rBsd = await fetch(`${origin}/api/odds/sync`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        dateFrom: utcDateYYYYMMDD(now),
        days: bsdOddsSyncDays,
        dryRun: false,
        tz: "Europe/Warsaw",
      }),
      cache: "no-store",
    });

    const bsdOddsSync = await readJsonSafe(rBsd);

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
        bsd_odds_sync: {
          ok: rBsd.ok,
          status: rBsd.status,
          days: bsdOddsSyncDays,
          body: bsdOddsSync,
        },
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
  } catch (error: unknown) {
    await cronLogError(logId, error);
    return json(500, { ok: false, error: errorMessage(error) });
  }
}

export async function GET() {
  return json(405, { ok: false, error: "Method Not Allowed" });
}
