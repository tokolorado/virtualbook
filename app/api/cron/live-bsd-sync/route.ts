import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/requireCronSecret";
import { todayWarsawYYYYMMDD } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  dates?: string[];
};

function isYYYYMMDD(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDaysYmd(dateYYYYMMDD: string, days: number) {
  const [year, month, day] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function getWarsawHour() {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Warsaw",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date());

  const n = Number(hour);
  return Number.isFinite(n) ? n : 12;
}

function getDefaultDates() {
  const today = todayWarsawYYYYMMDD();
  const hour = getWarsawHour();

  const dates = new Set<string>();
  dates.add(today);

  // Mecze po północy lokalnie mogą jeszcze należeć do poprzedniego dnia.
  if (hour <= 2) {
    dates.add(addDaysYmd(today, -1));
  }

  // Pod koniec dnia łapiemy też mecze startujące po północy.
  if (hour >= 22) {
    dates.add(addDaysYmd(today, 1));
  }

  return Array.from(dates);
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

  const dates = Array.from(
    new Set(
      (Array.isArray(body.dates) && body.dates.length > 0
        ? body.dates
        : getDefaultDates()
      ).filter(isYYYYMMDD)
    )
  );

  if (!dates.length) {
    return NextResponse.json(
      { ok: false, error: "No valid dates to sync." },
      { status: 400 }
    );
  }

  const results = [];

  for (const date of dates) {
    const qs = new URLSearchParams();
    qs.set("date", date);

    const response = await fetch(
      `${baseUrl}/api/admin/bsd/matches/sync?${qs.toString()}`,
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
      ok: response.ok && payload?.ok !== false,
      status: response.status,
      upsertedMatchesCount: Number(payload?.upsertedMatchesCount ?? 0) || 0,
      upsertedOddsCount: Number(payload?.upsertedOddsCount ?? 0) || 0,
      error: payload?.error ?? payload?.message ?? null,
      payload,
    });
  }

  const failed = results.filter((item) => !item.ok);

  return NextResponse.json(
    {
      ok: failed.length === 0,
      job: "live-bsd-sync",
      dates,
      failedCount: failed.length,
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