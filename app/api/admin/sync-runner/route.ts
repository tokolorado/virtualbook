// app/api/admin/sync-runner/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOLDOWN_SECONDS = 65;

// PRE-MATCH ONLY: zamykamy zakłady 60s przed kickoff
const BETTING_CLOSE_BUFFER_MS = 60_000;

// statusy meczów, które traktujemy jako jeszcze nie zakończone
const OPEN_STATUSES = ["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED"] as const;

type RunnerBody = {
  // start cursor jeśli chcesz wymusić (YYYY-MM-DD)
  startDate?: string;

  // opcjonalnie ogranicz liczbę dni wprzód (np. +30)
  maxAheadDays?: number;

  // parametry zostawione dla kompatybilności UI; BSD sync aktualnie ignoruje model params
  leagues?: string[];
  throttleMs?: number;
  maxRetries?: number;

  maxGoals?: number;
  homeAdv?: number;
  drawBoost?: number;
  margin?: number;
};

function isYYYYMMDD(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function plusSecondsIso(nowIso: string, seconds: number) {
  return new Date(new Date(nowIso).getTime() + seconds * 1000).toISOString();
}

function plusDaysISODate(dateYYYYMMDD: string, days: number) {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function utcTodayYYYYMMDD() {
  return new Date().toISOString().slice(0, 10);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function isCronAuthorized(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const headerSecret = req.headers.get("x-cron-secret");
  const bearerSecret = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();

  return headerSecret === expected || bearerSecret === expected;
}

async function closeBettingForStartedMatches(
  sb: ReturnType<typeof supabaseAdmin>
) {
  // Zamykamy obstawianie gdy: now >= kickoff - 60s  <=> kickoff <= now + 60s
  const cutoffIso = new Date(Date.now() + BETTING_CLOSE_BUFFER_MS).toISOString();

  const { data, error } = await sb
    .from("matches")
    .update({ betting_closed: true })
    .eq("betting_closed", false)
    .in("status", OPEN_STATUSES as unknown as string[])
    .lte("utc_date", cutoffIso)
    .select("id");

  if (error) {
    return { ok: false, cutoffIso, closed: 0, error: error.message };
  }

  const closed = Array.isArray(data) ? data.length : 0;

  return {
    ok: true,
    cutoffIso,
    closed,
    error: null as string | null,
  };
}

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "Missing CRON_SECRET in env" },
      { status: 500 }
    );
  }

  const cronAuthorized = isCronAuthorized(req);

  if (!cronAuthorized) {
    const guard = await requireAdmin(req);
    if (!guard.ok) {
      return NextResponse.json(
        { ok: false, error: guard.error },
        { status: guard.status }
      );
    }
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

  const getInternal = async (path: string) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: {
        "x-cron-secret": cronSecret,
      },
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(
        `${path} failed: ${data?.error ?? data?.message ?? res.statusText}`
      );
    }

    return data;
  };

    const postInternal = async (path: string, body: unknown = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "x-cron-secret": cronSecret,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(
        `${path} failed: ${data?.error ?? data?.message ?? res.statusText}`
      );
    }

    return data;
  };

  const callBsdMatchesSync = async (args: {
    date: string;
    dryRun?: boolean;
  }) => {
    const qs = new URLSearchParams();
    qs.set("date", args.date);
    if (args.dryRun) qs.set("dryRun", "1");

    return await getInternal(`/api/admin/bsd/matches/sync?${qs.toString()}`);
  };

  const callBsdPredictionsSync = async (date: string) => {
    const qs = new URLSearchParams();
    qs.set("date", date);
    qs.set("pageLimit", "10");
    qs.set("refreshStaleHours", "24");

    return await getInternal(`/api/predictions/bsd/sync?${qs.toString()}`);
  };

  const callTeamStatsBackfill = async (args: {
    snapshotDate: string;
    throughDate: string;
  }) => {
    const qs = new URLSearchParams();
    qs.set("snapshotDate", args.snapshotDate);
    qs.set("throughDate", args.throughDate);
    qs.set("lookbackDays", "365");

    return await getInternal(`/api/admin/team-stats/backfill?${qs.toString()}`);
  };

  const callInternalFallbackOddsSync = async (date: string) => {
    const qs = new URLSearchParams();
    qs.set("date", date);

    return await getInternal(
      `/api/admin/internal-odds/fallback/sync?${qs.toString()}`
    );
  };

    const sb = supabaseAdmin();
    const nowIso = new Date().toISOString();

    let body: RunnerBody = {};
    try {
      const t = await req.text();
      body = t ? (JSON.parse(t) as RunnerBody) : {};
    } catch {
      body = {};
    }

  // 0) opcjonalny reset kursora (tylko jeśli podasz startDate)
  if (body.startDate && !isYYYYMMDD(body.startDate)) {
    return NextResponse.json(
      { ok: false, error: "startDate must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  if (body.startDate) {
    await sb.from("sync_state").upsert({
      id: 1,
      cursor_date: body.startDate,
      phase: "FETCH_1",
      next_run_at: nowIso,
      is_running: false,
      updated_at: nowIso,
    });
  }


    const callEnqueueMatchMapping = async (date: string) => {
    const qs = new URLSearchParams();
    qs.set("date", date);
    qs.set("limit", "500");

    return await postInternal(
      `/api/cron/enqueue-match-mapping?${qs.toString()}`,
      {}
    );
  };

  const callProcessMatchMapping = async () => {
    const qs = new URLSearchParams();
    qs.set("batchSize", "50");
    qs.set("maxAttempts", "1");

    return await postInternal(
      `/api/cron/process-match-mapping?${qs.toString()}`,
      {}
    );
  };

  // 1) lock (atomowy)
  const { data: locked, error: lockErr } = await sb.rpc("acquire_sync_lock", {
    p_now: nowIso,
  });

  if (lockErr) {
    return NextResponse.json(
      { ok: false, error: lockErr.message },
      { status: 500 }
    );
  }

  // jeśli null => cooldown albo ktoś inny biega
  if (!locked) {
    const { data: st } = await sb
      .from("sync_state")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      status: "cooldown_or_locked",
      state: st ?? null,
      now: nowIso,
    });
  }

  const cursorDate: string = String(locked.cursor_date);
  const phase: "FETCH_1" | "FETCH_2" =
    String(locked.phase) === "FETCH_2" ? "FETCH_2" : "FETCH_1";

  let released = false;

  try {
    // A) zamknij obstawianie dla meczów, które właśnie weszły w okno startu
    const closeRes = await closeBettingForStartedMatches(sb);
    await sb.rpc("prune_future_matches");

    // 2) horyzont (opcjonalny)
    const maxAhead = Number.isFinite(Number(body.maxAheadDays))
      ? Math.max(1, Math.floor(Number(body.maxAheadDays)))
      : 30;

    const today = utcTodayYYYYMMDD();
    const lastAllowed = plusDaysISODate(today, maxAhead);

    if (cursorDate > lastAllowed) {
      await sb
        .from("sync_state")
        .update({
          cursor_date: today,
          phase: "FETCH_1",
          next_run_at: plusSecondsIso(nowIso, COOLDOWN_SECONDS),
          updated_at: nowIso,
          is_running: false,
        })
        .eq("id", 1);

      await sb.rpc("release_sync_lock", { p_now: nowIso });
      released = true;

      return NextResponse.json({
        ok: true,
        status: "reset_cursor_too_far",
        today,
        maxAheadDays: maxAhead,
        bettingClosedUpdated: closeRes.closed,
        bettingCloseCutoffIso: closeRes.cutoffIso,
        bettingCloseError: closeRes.ok ? null : closeRes.error,
      });
    }

    // 3) wykonaj jeden krok
    let stepOk = false;
    let matchesUpserted = 0;
    let oddsUpserted = 0;
    let mappingEnqueued = 0;
    let mappingClaimed = 0;
    let mappingMapped = 0;
    let mappingFailed = 0;
    let mappingNeedsReview = 0;
    let predictionsUpserted = 0;
    let predictionsMatched = 0;
    let predictionsRealOddsMatches = 0;
    let teamStatSourceRows = 0;
    let teamStatAppearances = 0;
    let teamStatSnapshotsBuilt = 0;
    let teamStatSnapshotsUpserted = 0;
    let teamStatTeams = 0;
    let fallbackPricedMatches = 0;
    let fallbackOddsRows = 0;
    let fallbackSkipped = 0;
    let bsdOddsApiAttempted = 0;
    let bsdOddsApiSucceeded = 0;
    let bsdOddsApiFailed = 0;
    let bsdOddsApiSourceRows = 0;
    let bsdOddsApiInputs = 0;
    let message: string | null = null;
    let extra: Record<string, unknown> | null = null;
    const warnings: string[] = [];

    try {
      const bsdRes = await callBsdMatchesSync({ date: cursorDate });
      const teamStatsRes = await callTeamStatsBackfill({
        snapshotDate: today,
        throughDate: lastAllowed,
      });
      const fallbackOddsRes = await callInternalFallbackOddsSync(cursorDate);
      let predictionsRes: Awaited<ReturnType<typeof callBsdPredictionsSync>> | null =
        null;
      let enqueueRes: Awaited<ReturnType<typeof callEnqueueMatchMapping>> | null =
        null;
      let processRes: Awaited<ReturnType<typeof callProcessMatchMapping>> | null =
        null;

      try {
        predictionsRes = await callBsdPredictionsSync(cursorDate);
      } catch (e: unknown) {
        warnings.push(`bsd_predictions: ${errorMessage(e, "failed")}`);
      }

      try {
        enqueueRes = await callEnqueueMatchMapping(cursorDate);
      } catch (e: unknown) {
        warnings.push(`match_mapping_enqueue: ${errorMessage(e, "failed")}`);
      }

      try {
        processRes = await callProcessMatchMapping();
      } catch (e: unknown) {
        warnings.push(`match_mapping_process: ${errorMessage(e, "failed")}`);
      }

      stepOk = true;
      message = warnings.length ? warnings.join(" | ") : null;

      matchesUpserted = Number(bsdRes?.upsertedMatchesCount ?? 0) || 0;
      oddsUpserted = Number(bsdRes?.upsertedOddsCount ?? 0) || 0;
      bsdOddsApiAttempted = Number(bsdRes?.bsdOddsApi?.attempted ?? 0) || 0;
      bsdOddsApiSucceeded = Number(bsdRes?.bsdOddsApi?.succeeded ?? 0) || 0;
      bsdOddsApiFailed = Number(bsdRes?.bsdOddsApi?.failed ?? 0) || 0;
      bsdOddsApiSourceRows = Number(bsdRes?.bsdOddsApi?.sourceRows ?? 0) || 0;
      bsdOddsApiInputs = Number(bsdRes?.bsdOddsApi?.inputs ?? 0) || 0;

      mappingEnqueued = Number(enqueueRes?.enqueued ?? 0) || 0;
      mappingClaimed = Number(processRes?.claimed ?? 0) || 0;
      mappingMapped = Number(processRes?.mapped ?? 0) || 0;
      mappingFailed = Number(processRes?.failed ?? 0) || 0;
      mappingNeedsReview = Number(processRes?.needsReview ?? 0) || 0;
      predictionsUpserted =
        Number(predictionsRes?.summary?.upsertedCount ?? 0) || 0;
      predictionsMatched =
        Number(predictionsRes?.summary?.matchedCount ?? 0) || 0;
      predictionsRealOddsMatches =
        Number(predictionsRes?.db?.matchesWithRealBsdOddsCount ?? 0) || 0;
      teamStatSourceRows =
        Number(teamStatsRes?.summary?.sourceRows ?? 0) || 0;
      teamStatAppearances =
        Number(teamStatsRes?.summary?.appearances ?? 0) || 0;
      teamStatSnapshotsBuilt =
        Number(teamStatsRes?.summary?.snapshotsBuilt ?? 0) || 0;
      teamStatSnapshotsUpserted =
        Number(teamStatsRes?.summary?.upsertedSnapshots ?? 0) || 0;
      teamStatTeams = Number(teamStatsRes?.summary?.teams ?? 0) || 0;
      fallbackPricedMatches =
        Number(fallbackOddsRes?.summary?.pricedMatches ?? 0) || 0;
      fallbackOddsRows =
        Number(fallbackOddsRes?.summary?.upsertedOddsRows ?? 0) || 0;
      fallbackSkipped = Number(fallbackOddsRes?.summary?.skipped ?? 0) || 0;

      extra = {
        bsd: bsdRes,
        bsdPredictions: predictionsRes,
        teamStats: teamStatsRes,
        internalFallbackOdds: fallbackOddsRes,
        warnings,
        matchMapping: {
          enqueue: enqueueRes,
          process: processRes,
        },
      };
    } catch (e: unknown) {
      stepOk = false;
      message = errorMessage(e, "runner_call_error");
    }

    // 4) zapisz log
    await sb.from("sync_logs").insert({
      ran_at: nowIso,
      cursor_date: cursorDate,
      phase,
      ok: stepOk,
      matches_upserted: matchesUpserted,
      odds_upserted: oddsUpserted,
      leagues: body.leagues ?? null,
      message,
      extra: {
        ...(extra ?? {}),
        bettingClosedUpdated: closeRes.closed,
        bettingCloseCutoffIso: closeRes.cutoffIso,
        bettingCloseError: closeRes.ok ? null : closeRes.error,
      },
    });

    // 5) update state
    const nextRunAt = plusSecondsIso(nowIso, COOLDOWN_SECONDS);

      if (stepOk) {
        await sb
          .from("sync_state")
          .update({
            cursor_date: plusDaysISODate(cursorDate, 1),
            phase: "FETCH_1",
            next_run_at: nextRunAt,
            updated_at: nowIso,
            is_running: false,
          })
          .eq("id", 1);
      } else {
      await sb
        .from("sync_state")
        .update({
          phase,
          next_run_at: nextRunAt,
          updated_at: nowIso,
          is_running: false,
        })
        .eq("id", 1);
    }

    await sb.rpc("release_sync_lock", { p_now: nowIso });
    released = true;

    return NextResponse.json({
      ok: stepOk,
      ran: { date: cursorDate, phase },
      matchesUpserted,
      oddsUpserted,
      nextRunAt,
      message,
      matchMapping: {
        enqueued: mappingEnqueued,
        claimed: mappingClaimed,
        mapped: mappingMapped,
        failed: mappingFailed,
        needsReview: mappingNeedsReview,
      },
      bsdPredictions: {
        upserted: predictionsUpserted,
        matched: predictionsMatched,
        matchesWithRealOdds: predictionsRealOddsMatches,
      },
      teamStats: {
        sourceRows: teamStatSourceRows,
        appearances: teamStatAppearances,
        snapshotsBuilt: teamStatSnapshotsBuilt,
        upsertedSnapshots: teamStatSnapshotsUpserted,
        teams: teamStatTeams,
      },
      warnings,
      internalFallbackOdds: {
        pricedMatches: fallbackPricedMatches,
        oddsRows: fallbackOddsRows,
        skipped: fallbackSkipped,
      },
      bsdOddsApi: {
        attempted: bsdOddsApiAttempted,
        succeeded: bsdOddsApiSucceeded,
        failed: bsdOddsApiFailed,
        sourceRows: bsdOddsApiSourceRows,
        inputs: bsdOddsApiInputs,
      },
      bettingClosedUpdated: closeRes.closed,
      bettingCloseCutoffIso: closeRes.cutoffIso,
      bettingCloseError: closeRes.ok ? null : closeRes.error,
    });
  } catch (e: unknown) {
    if (!released) {
      await sb.rpc("release_sync_lock", { p_now: nowIso });
    }

    return NextResponse.json(
      {
        ok: false,
        error: errorMessage(e, "sync_runner_failed"),
      },
      { status: 500 }
    );
  }
}
