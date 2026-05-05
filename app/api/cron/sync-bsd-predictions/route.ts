import { NextRequest, NextResponse } from "next/server";
import { addDaysLocal, todayLocalYYYYMMDD } from "@/lib/date";
import { requireCronSecret } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  date?: string;
  from?: string;
  days?: number;
  pageLimit?: number;
  dryRun?: boolean;
  refreshStaleHours?: number;
};

function isYYYYMMDD(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function intInRange(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function getBaseUrl(request: NextRequest) {
  const host = request.headers.get("host");
  if (!host) return null;

  const proto =
    request.headers.get("x-forwarded-proto") ||
    (host.includes("localhost") ? "http" : "https");

  return `${proto}://${host}`;
}

async function parseBody(request: NextRequest): Promise<Body> {
  if (request.method !== "POST") return {};

  try {
    const text = await request.text();
    return text ? ((JSON.parse(text) ?? {}) as Body) : {};
  } catch {
    return {};
  }
}

async function run(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "Missing CRON_SECRET in env" },
      { status: 500 }
    );
  }

  const baseUrl = getBaseUrl(request);
  if (!baseUrl) {
    return NextResponse.json(
      { ok: false, error: "Missing host header" },
      { status: 400 }
    );
  }

  const body = await parseBody(request);
  const params = request.nextUrl.searchParams;

  const explicitDate = params.get("date") ?? body.date ?? null;
  const from = params.get("from") ?? body.from ?? todayLocalYYYYMMDD();
  const days = explicitDate
    ? 1
    : intInRange(params.get("days") ?? body.days, 14, 1, 31);
  const pageLimit = intInRange(
    params.get("pageLimit") ?? body.pageLimit,
    10,
    1,
    20
  );
  const refreshStaleHours = intInRange(
    params.get("refreshStaleHours") ?? body.refreshStaleHours,
    24,
    0,
    24 * 14
  );
  const dryRun =
    params.get("dryRun") === "1" ||
    params.get("dryRun") === "true" ||
    body.dryRun === true;

  if (explicitDate && !isYYYYMMDD(explicitDate)) {
    return NextResponse.json(
      { ok: false, error: "date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  if (!explicitDate && !isYYYYMMDD(from)) {
    return NextResponse.json(
      { ok: false, error: "from must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const dates = Array.from({ length: days }, (_, index) =>
    explicitDate ? explicitDate : addDaysLocal(from, index)
  );

  const results = [];

  for (const date of dates) {
    const qs = new URLSearchParams();
    qs.set("date", date);
    qs.set("pageLimit", String(pageLimit));
    qs.set("refreshStaleHours", String(refreshStaleHours));
    if (dryRun) qs.set("dryRun", "1");

    const response = await fetch(
      `${baseUrl}/api/predictions/bsd/sync?${qs.toString()}`,
      {
        method: "GET",
        headers: {
          "x-cron-secret": cronSecret,
        },
        cache: "no-store",
      }
    );

    const payload = await response.json().catch(() => null);

    results.push({
      date,
      ok: response.ok && payload?.error === undefined,
      status: response.status,
      upsertedCount: Number(payload?.summary?.upsertedCount ?? 0) || 0,
      matchedCount: Number(payload?.summary?.matchedCount ?? 0) || 0,
      matchesWithRealBsdOddsCount:
        Number(payload?.db?.matchesWithRealBsdOddsCount ?? 0) || 0,
      skippedFreshCount: Number(payload?.summary?.skippedFreshCount ?? 0) || 0,
      error: payload?.error ?? null,
      payload,
    });
  }

  const failed = results.filter((item) => !item.ok);

  return NextResponse.json(
    {
      ok: failed.length === 0,
      source: "bsd",
      dryRun,
      from: explicitDate ?? from,
      days,
      pageLimit,
      refreshStaleHours,
      summary: {
        datesProcessed: dates.length,
        failedCount: failed.length,
        upsertedCount: results.reduce((sum, item) => sum + item.upsertedCount, 0),
        matchedCount: results.reduce((sum, item) => sum + item.matchedCount, 0),
        matchesWithRealBsdOddsCount: results.reduce(
          (sum, item) => sum + item.matchesWithRealBsdOddsCount,
          0
        ),
        skippedFreshCount: results.reduce(
          (sum, item) => sum + item.skippedFreshCount,
          0
        ),
      },
      results,
    },
    { status: failed.length === 0 ? 200 : 207 }
  );
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
