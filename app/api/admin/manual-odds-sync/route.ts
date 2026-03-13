// app/api/admin/manual-odds-sync/route.ts
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManualOddsSyncBody = {
  date?: string;
  leagues?: string[];
  oddsTtlHours?: number;
  batchLimit?: number;
  throttleMs?: number;
  maxRetries?: number;
  maxGoals?: number;
  homeAdv?: number;
  drawBoost?: number;
  margin?: number;
  phase?: "FETCH_1" | "FETCH_2";
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
    const res = await fetch(`${baseUrl}/api/odds/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": cronSecret,
      },
      body: JSON.stringify({
        date: body.date,
        leagues: body.leagues,
        oddsTtlHours: body.oddsTtlHours ?? 6,
        batchLimit: body.batchLimit ?? 30,
        throttleMs: body.throttleMs ?? 800,
        maxRetries: body.maxRetries ?? 2,
        maxGoals: body.maxGoals,
        homeAdv: body.homeAdv,
        drawBoost: body.drawBoost,
        margin: body.margin,
        phase: body.phase,
      }),
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: data?.error ?? data?.message ?? `odds/sync failed (${res.status})`,
          upstream: data,
        },
        { status: res.status }
      );
    }

    return NextResponse.json({
      ok: true,
      upstream: data,
    });
    } catch (e: unknown) {
    return NextResponse.json(
        {
        ok: false,
        error: e instanceof Error ? e.message : "manual_odds_sync_failed",
        },
            { status: 500 }
        );
    }
}