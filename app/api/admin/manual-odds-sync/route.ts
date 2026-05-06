// app/api/admin/manual-odds-sync/route.ts
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManualOddsSyncBody = {
  date?: string;
  dryRun?: boolean;
};

type BsdOddsApiSummary = {
  attempted?: number;
  succeeded?: number;
  failed?: number;
  sourceRows?: number;
  inputs?: number;
};

function isYYYYMMDD(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return NextResponse.json(
      { ok: false, error: guard.error },
      { status: guard.status }
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "Missing CRON_SECRET in env" },
      { status: 500 }
    );
  }

  const host = req.headers.get("host");
  if (!host) {
    return NextResponse.json(
      { ok: false, error: "Missing host header" },
      { status: 400 }
    );
  }

  const proto =
    req.headers.get("x-forwarded-proto") ||
    (host.includes("localhost") ? "http" : "https");

  const baseUrl = `${proto}://${host}`;

  let body: ManualOddsSyncBody = {};
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as ManualOddsSyncBody) : {};
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!isYYYYMMDD(body.date)) {
    return NextResponse.json(
      { ok: false, error: "date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  try {
    const url = new URL(`${baseUrl}/api/admin/bsd/matches/sync`);
    url.searchParams.set("date", body.date);
    if (body.dryRun) url.searchParams.set("dryRun", "1");

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "x-cron-secret": cronSecret,
      },
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            data?.error ??
            data?.message ??
            `bsd/matches/sync failed (${res.status})`,
          upstream: data,
        },
        { status: res.status }
      );
    }

    return NextResponse.json({
      ok: true,
      provider: "bsd",
      upstream: data,
      matchesUpserted: Number(data?.upsertedMatchesCount ?? 0) || 0,
      oddsUpserted: Number(data?.upsertedOddsCount ?? 0) || 0,
      bsdOddsApi: (data?.bsdOddsApi ?? null) as BsdOddsApiSummary | null,
      bsdOddsApiWarnings: data?.bsdOddsApiWarnings ?? [],
    });
  } catch (e: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "manual_bsd_sync_failed",
      },
      { status: 500 }
    );
  }
}
