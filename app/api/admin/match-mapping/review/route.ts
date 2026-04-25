//app/api/admin/match-mapping/review/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QueueStatus =
  | "pending"
  | "processing"
  | "mapped"
  | "failed"
  | "needs_review";

type ReviewItem = {
  matchId: number;
  status: QueueStatus;
  attempts: number;
  lastError: string | null;
  nextRetryAt: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastAttemptAt: string | null;
  mappedAt: string | null;
  match: {
    utcDate: string | null;
    competitionName: string | null;
    homeTeam: string;
    awayTeam: string;
  } | null;
};

type ReviewResponse = {
  ok: true;
  total: number;
  limit: number;
  items: ReviewItem[];
};

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Brak konfiguracji SUPABASE dla review route.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getAdminSecret() {
  return process.env.ADMIN_SECRET ?? process.env.CRON_SECRET ?? null;
}

function isAuthorized(request: NextRequest) {
  const expected = getAdminSecret();

  if (!expected) {
    return true;
  }

  const headerSecret = request.headers.get("x-admin-secret");
  const cronSecret = request.headers.get("x-cron-secret");
  const querySecret = request.nextUrl.searchParams.get("secret");

  return (
    headerSecret === expected ||
    cronSecret === expected ||
    querySecret === expected
  );
}

function safeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function safeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStatus(value: unknown): QueueStatus {
  const status = safeString(value, "needs_review");

  if (
    status === "pending" ||
    status === "processing" ||
    status === "mapped" ||
    status === "failed" ||
    status === "needs_review"
  ) {
    return status;
  }

  return "needs_review";
}

function normalizeReviewItem(input: unknown): ReviewItem | null {
  if (typeof input !== "object" || input === null) return null;

  const row = input as Record<string, unknown>;
  const matchId = safeNumber(row.match_id);

  if (matchId === null) return null;

  const matchRaw =
    typeof row.matches === "object" && row.matches !== null
      ? (row.matches as Record<string, unknown>)
      : null;

  return {
    matchId,
    status: normalizeStatus(row.status),
    attempts: safeNumber(row.attempts) ?? 0,
    lastError: safeNullableString(row.last_error),
    nextRetryAt: safeNullableString(row.next_retry_at),
    lockedAt: safeNullableString(row.locked_at),
    lockedBy: safeNullableString(row.locked_by),
    createdAt: safeNullableString(row.created_at),
    updatedAt: safeNullableString(row.updated_at),
    lastAttemptAt: safeNullableString(row.last_attempt_at),
    mappedAt: safeNullableString(row.mapped_at),
    match: matchRaw
      ? {
          utcDate: safeNullableString(matchRaw.utc_date),
          competitionName: safeNullableString(matchRaw.competition_name),
          homeTeam: safeString(matchRaw.home_team, "Home"),
          awayTeam: safeString(matchRaw.away_team, "Away"),
        }
      : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { error: "Brak autoryzacji." },
        { status: 401 }
      );
    }

    const supabase = getSupabaseAdmin();

    const limitParam = request.nextUrl.searchParams.get("limit");
    const limitRaw = safeNumber(limitParam);
    const limit =
      limitRaw !== null ? Math.max(1, Math.min(200, limitRaw)) : 50;

    const { data, error, count } = await supabase
      .from("match_mapping_queue")
      .select(
        `
          match_id,
          status,
          attempts,
          last_error,
          next_retry_at,
          locked_at,
          locked_by,
          created_at,
          updated_at,
          last_attempt_at,
          mapped_at,
          matches (
            utc_date,
            competition_name,
            home_team,
            away_team
          )
        `,
        { count: "exact" }
      )
      .eq("status", "needs_review")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { error: `Nie udało się pobrać review queue: ${error.message}` },
        { status: 500 }
      );
    }

    const items = (data ?? [])
      .map(normalizeReviewItem)
      .filter((item): item is ReviewItem => item !== null);

    return NextResponse.json(
      {
        ok: true,
        total: count ?? items.length,
        limit,
        items,
      } satisfies ReviewResponse,
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Nie udało się pobrać review queue.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}