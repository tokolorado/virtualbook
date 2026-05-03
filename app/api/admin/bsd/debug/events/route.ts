// app/api/admin/bsd/debug/events/route.ts

import { NextResponse } from "next/server";
import { bsdFetchPaginated } from "@/lib/bsd/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthResult =
  | { ok: true }
  | { ok: false; response: Response };

function jsonError(
  message: string,
  status = 500,
  extra?: Record<string, unknown>
): Response {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

function requireCronSecret(req: Request): AuthResult {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return {
      ok: false,
      response: jsonError("Missing CRON_SECRET in env", 500),
    };
  }

  const provided = req.headers.get("x-cron-secret");

  if (provided !== expected) {
    return {
      ok: false,
      response: jsonError("Unauthorized", 401),
    };
  }

  return { ok: true };
}

export async function GET(req: Request): Promise<Response> {
  const auth = requireCronSecret(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);

  const date = searchParams.get("date") || "2026-05-05";
  const leagueId = searchParams.get("leagueId");
  const pageSizeRaw = Number(searchParams.get("pageSize") || 3);

  const pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? pageSizeRaw : 3;

  const params: Record<string, string | number> = {
    date_from: date,
    date_to: date,
    tz: "Europe/Warsaw",
    page_size: pageSize,
  };

  if (leagueId) {
    params.league_id = leagueId;
  }

  try {
    const { results, pages } = await bsdFetchPaginated<Record<string, unknown>>(
      "/events/",
      params,
      { maxPages: 1 }
    );

    return NextResponse.json({
      ok: true,
      date,
      leagueId: leagueId ?? null,
      count: results.length,
      firstEvent: results[0] ?? null,
      results,
      pages,
    });
  } catch (e: unknown) {
    const err = e as {
      message?: string;
      status?: number;
      payload?: unknown;
    };

    return jsonError(err?.message || "BSD debug events failed", 500, {
      status: err?.status ?? null,
      details: err?.payload ?? null,
    });
  }
}