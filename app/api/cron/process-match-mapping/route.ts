import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCronSecret } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QueueRow = {
  match_id: number;
  status: string;
  attempts: number;
  next_retry_at: string | null;
};

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Brak konfiguracji SUPABASE dla process-match-mapping.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function safeNumber(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeQueueRow(input: unknown): QueueRow {
  const row =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  return {
    match_id: safeNumber(row.match_id, 0),
    status: typeof row.status === "string" ? row.status : "pending",
    attempts: safeNumber(row.attempts, 0),
    next_retry_at: typeof row.next_retry_at === "string" ? row.next_retry_at : null,
  };
}

function addMinutes(minutes: number) {
  const dt = new Date();
  dt.setMinutes(dt.getMinutes() + minutes);
  return dt.toISOString();
}

function backoffMinutes(attempt: number) {
  return Math.min(240, 5 * Math.pow(2, Math.max(0, attempt - 1)));
}

function shouldMoveToManualReview(args: {
  responseStatus: number;
  errorMessage: string;
  payload: Record<string, unknown> | null;
}) {
  const message = String(args.errorMessage || "").toLowerCase();

  if (args.payload?.needsReview === true) return true;
  if (args.payload?.blockedBySofaScore === true) return true;

  if (args.responseStatus === 403) return true;
  if (args.responseStatus === 404) return true;

  if (
    message.includes("sofascore") &&
    (message.includes("403") ||
      message.includes("block") ||
      message.includes("blocked") ||
      message.includes("not found") ||
      message.includes("no mapping") ||
      message.includes("candidate") ||
      message.includes("brak kandydat") ||
      message.includes("nie znaleziono"))
  ) {
    return true;
  }

  return false;
}

export async function POST(request: NextRequest) {
  try {
    const unauthorized = requireCronSecret(request);
    if (unauthorized) return unauthorized;

    const batchSize = safeNumber(request.nextUrl.searchParams.get("batchSize"), 10);
    const maxAttempts = safeNumber(request.nextUrl.searchParams.get("maxAttempts"), 5);
    const staleLockMinutes = safeNumber(
      request.nextUrl.searchParams.get("staleLockMinutes"),
      10
    );

    const supabase = getSupabaseAdmin();
    const workerId = `cron-${Date.now()}`;
    const nowIso = new Date().toISOString();
    const staleIso = new Date(
      Date.now() - staleLockMinutes * 60 * 1000
    ).toISOString();

    await supabase
      .from("match_mapping_queue")
      .update({
        status: "pending",
        locked_at: null,
        locked_by: null,
        updated_at: nowIso,
        last_error: "stale processing lock recovered",
      })
      .eq("status", "processing")
      .not("locked_at", "is", null)
      .lt("locked_at", staleIso);

    const { data: candidatesRaw, error: candidatesError } = await supabase
      .from("match_mapping_queue")
      .select("match_id, status, attempts, next_retry_at")
      .in("status", ["pending", "failed"])
      .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
      .order("next_retry_at", { ascending: true, nullsFirst: true })
      .limit(batchSize);

    if (candidatesError) {
      return NextResponse.json(
        { error: `Nie udało się pobrać kolejki: ${candidatesError.message}` },
        { status: 500 }
      );
    }

    const candidates = ((candidatesRaw ?? []) as unknown[])
      .map(normalizeQueueRow)
      .filter((row) => row.match_id > 0);

    if (candidates.length === 0) {
      return NextResponse.json(
        {
          ok: true,
          claimed: 0,
          mapped: 0,
          failed: 0,
          needsReview: 0,
          message: "Brak rekordów do przetworzenia.",
        },
        { status: 200 }
      );
    }

    let claimed = 0;
    let mapped = 0;
    let failed = 0;
    let needsReview = 0;

    for (const candidate of candidates) {
      const nextAttempt = candidate.attempts + 1;

      const { data: claimedRow, error: claimError } = await supabase
        .from("match_mapping_queue")
        .update({
          status: "processing",
          attempts: nextAttempt,
          locked_at: nowIso,
          locked_by: workerId,
          last_attempt_at: nowIso,
          updated_at: nowIso,
        })
        .eq("match_id", candidate.match_id)
        .in("status", ["pending", "failed"])
        .select("match_id")
        .maybeSingle();

      if (claimError || !claimedRow) {
        continue;
      }

      claimed += 1;

      const { data: existingMapRaw } = await supabase
        .from("match_sofascore_map")
        .select("match_id, sofascore_event_id")
        .eq("match_id", candidate.match_id)
        .maybeSingle();

      if (existingMapRaw?.match_id) {
        await supabase
          .from("match_mapping_queue")
          .update({
            status: "mapped",
            mapped_at: nowIso,
            locked_at: null,
            locked_by: null,
            last_error: null,
            updated_at: nowIso,
          })
          .eq("match_id", candidate.match_id);

        mapped += 1;
        continue;
      }

      try {
        const url = new URL("/api/sofascore/mapping", request.nextUrl.origin);
        url.searchParams.set("matchId", String(candidate.match_id));
        url.searchParams.set("force", "1");

        const response = await fetch(url.toString(), {
          method: "GET",
          cache: "no-store",
          headers: {
            "x-cron-secret": request.headers.get("x-cron-secret") ?? "",
          },
        });

        let payload: Record<string, unknown> | null = null;

        try {
          payload = (await response.json()) as Record<string, unknown>;
        } catch {
          payload = null;
        }

        const errorMessage =
          typeof payload?.error === "string"
            ? payload.error
            : `mapping_http_${response.status}`;

        const mappedFlag = payload?.mapped === true;
        const sofascoreEventId = safeNumber(payload?.sofascoreEventId, 0);

        if (response.ok && mappedFlag && sofascoreEventId > 0) {
          await supabase
            .from("match_mapping_queue")
            .update({
              status: "mapped",
              mapped_at: new Date().toISOString(),
              locked_at: null,
              locked_by: null,
              last_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("match_id", candidate.match_id);

          mapped += 1;
          continue;
        }

        const shouldNeedsReview =
          shouldMoveToManualReview({
            responseStatus: response.status,
            errorMessage,
            payload,
          }) || nextAttempt >= maxAttempts;

        await supabase
          .from("match_mapping_queue")
          .update({
            status: shouldNeedsReview ? "needs_review" : "failed",
            locked_at: null,
            locked_by: null,
            next_retry_at: shouldNeedsReview
              ? null
              : addMinutes(backoffMinutes(nextAttempt)),
            last_error: shouldNeedsReview
              ? `Manual review required: ${errorMessage}`
              : errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq("match_id", candidate.match_id);

        if (shouldNeedsReview) {
          needsReview += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "worker_processing_error";

        const shouldNeedsReview =
          shouldMoveToManualReview({
            responseStatus: 0,
            errorMessage: message,
            payload: null,
          }) || nextAttempt >= maxAttempts;

        await supabase
          .from("match_mapping_queue")
          .update({
            status: shouldNeedsReview ? "needs_review" : "failed",
            locked_at: null,
            locked_by: null,
            next_retry_at: shouldNeedsReview
              ? null
              : addMinutes(backoffMinutes(nextAttempt)),
            last_error: shouldNeedsReview
              ? `Manual review required: ${message}`
              : message,
            updated_at: new Date().toISOString(),
          })
          .eq("match_id", candidate.match_id);

        if (shouldNeedsReview) {
          needsReview += 1;
        } else {
          failed += 1;
        }
      }
    }

    return NextResponse.json(
      {
        ok: true,
        claimed,
        mapped,
        failed,
        needsReview,
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Nie udało się uruchomić process-match-mapping.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
