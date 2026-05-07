// app/api/admin/sync-runner/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireAdmin } from "@/lib/requireAdmin";
import { todayWarsawYYYYMMDD } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOLDOWN_SECONDS = 65;

// PRE-MATCH ONLY: zamykamy zakłady 60s przed kickoff
const BETTING_CLOSE_BUFFER_MS = 60_000;

// statusy meczów, które traktujemy jako jeszcze nie zakończone
const OPEN_STATUSES = ["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED"] as const;
const REAL_BSD_ODDS_SOURCE = "bsd";
const REAL_BSD_ODDS_PRICING_METHOD = "bsd_market_normalized";
const ODDS_WATCH_DEFAULT_HORIZON_DAYS = 7;
const ODDS_WATCH_MAX_HORIZON_DAYS = 14;
const ODDS_WATCH_DEFAULT_MAX_DATES = 8;
const ODDS_WATCH_HARD_MAX_DATES = 10;
const ODDS_WATCH_FRESHNESS_MINUTES = 10;
const WARSAW_TIME_ZONE = "Europe/Warsaw";

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

  // High-frequency real BSD odds watch. Keeps newly published provider odds fresh.
  oddsWatchHorizonDays?: number;
  oddsWatchMaxDates?: number;
};

type OddsWatchPlan = {
  horizonDays: number;
  maxDates: number;
  freshnessMinutes: number;
  candidateMatches: number;
  missingMatches: number;
  staleMatches: number;
  dates: string[];
  skippedDates: number;
  error: string | null;
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

function clampPositiveInt(value: unknown, fallback: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

function dateInTimeZoneYYYYMMDD(
  value: string | Date,
  timeZone = WARSAW_TIME_ZONE
) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return year && month && day ? `${year}-${month}-${day}` : null;
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

async function buildOddsWatchPlan(
  sb: ReturnType<typeof supabaseAdmin>,
  args: {
    nowIso: string;
    maxAheadDays: number;
    horizonDays: number;
    maxDates: number;
  }
): Promise<OddsWatchPlan> {
  const nowMs = Date.parse(args.nowIso);
  const horizonDays = Math.min(args.maxAheadDays, args.horizonDays);
  const horizonEndIso = new Date(
    nowMs + horizonDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const staleBeforeMs =
    nowMs - ODDS_WATCH_FRESHNESS_MINUTES * 60 * 1000;

  const { data: upcomingMatches, error: matchesError } = await sb
    .from("matches")
    .select("id, utc_date")
    .eq("source", "bsd")
    .in("status", OPEN_STATUSES as unknown as string[])
    .gte("utc_date", args.nowIso)
    .lte("utc_date", horizonEndIso)
    .order("utc_date", { ascending: true })
    .limit(800);

  if (matchesError) {
    return {
      horizonDays,
      maxDates: args.maxDates,
      freshnessMinutes: ODDS_WATCH_FRESHNESS_MINUTES,
      candidateMatches: 0,
      missingMatches: 0,
      staleMatches: 0,
      dates: [],
      skippedDates: 0,
      error: matchesError.message,
    };
  }

  const matches = (upcomingMatches ?? []) as Array<{
    id: number | string | null;
    utc_date: string | null;
  }>;

  const matchIds = matches
    .map((match) => Number(match.id))
    .filter((id) => Number.isFinite(id));

  if (!matchIds.length) {
    return {
      horizonDays,
      maxDates: args.maxDates,
      freshnessMinutes: ODDS_WATCH_FRESHNESS_MINUTES,
      candidateMatches: 0,
      missingMatches: 0,
      staleMatches: 0,
      dates: [],
      skippedDates: 0,
      error: null,
    };
  }

  const { data: oddsRows, error: oddsError } = await sb
    .from("odds")
    .select("match_id, updated_at")
    .eq("source", REAL_BSD_ODDS_SOURCE)
    .eq("pricing_method", REAL_BSD_ODDS_PRICING_METHOD)
    .in("match_id", matchIds)
    .limit(5000);

  if (oddsError) {
    return {
      horizonDays,
      maxDates: args.maxDates,
      freshnessMinutes: ODDS_WATCH_FRESHNESS_MINUTES,
      candidateMatches: matches.length,
      missingMatches: 0,
      staleMatches: 0,
      dates: [],
      skippedDates: 0,
      error: oddsError.message,
    };
  }

  const latestOddsByMatch = new Map<number, number>();

  for (const row of (oddsRows ?? []) as Array<{
    match_id: number | string | null;
    updated_at: string | null;
  }>) {
    const matchId = Number(row.match_id);
    const updatedAtMs = Date.parse(String(row.updated_at ?? ""));
    if (!Number.isFinite(matchId) || !Number.isFinite(updatedAtMs)) continue;
    latestOddsByMatch.set(
      matchId,
      Math.max(latestOddsByMatch.get(matchId) ?? 0, updatedAtMs)
    );
  }

  const dates = new Set<string>();
  let missingMatches = 0;
  let staleMatches = 0;

  for (const match of matches) {
    const matchId = Number(match.id);
    if (!Number.isFinite(matchId) || !match.utc_date) continue;

    const latestOddsAtMs = latestOddsByMatch.get(matchId);
    const missing = latestOddsAtMs === undefined;
    const stale =
      latestOddsAtMs !== undefined && latestOddsAtMs < staleBeforeMs;

    if (!missing && !stale) continue;

    if (missing) missingMatches += 1;
    if (stale) staleMatches += 1;

    const localDate = dateInTimeZoneYYYYMMDD(match.utc_date);
    if (localDate) dates.add(localDate);
  }

  const allDates = Array.from(dates);

  return {
    horizonDays,
    maxDates: args.maxDates,
    freshnessMinutes: ODDS_WATCH_FRESHNESS_MINUTES,
    candidateMatches: matches.length,
    missingMatches,
    staleMatches,
    dates: allDates.slice(0, args.maxDates),
    skippedDates: Math.max(0, allDates.length - args.maxDates),
    error: null,
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

    const today = todayWarsawYYYYMMDD();
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
    let oddsWatchPlanSummary: OddsWatchPlan | null = null;
    const oddsWatchRefreshedDates: string[] = [];
    let bsdOddsApiAttempted = 0;
    let bsdOddsApiSucceeded = 0;
    let bsdOddsApiFailed = 0;
    let bsdOddsApiSourceRows = 0;
    let bsdOddsApiInputs = 0;
    let message: string | null = null;
    let extra: Record<string, unknown> | null = null;
    const warnings: string[] = [];

    try {
      type BsdMatchesSyncResult = Awaited<ReturnType<typeof callBsdMatchesSync>>;

      const bsdRefreshes: Array<{
        date: string;
        reason: "today_hot_refresh" | "odds_watch" | "cursor";
        result: BsdMatchesSyncResult;
      }> = [];

      const refreshBsdDate = async (
        date: string,
        reason: "today_hot_refresh" | "odds_watch" | "cursor"
      ) => {
        const existing = bsdRefreshes.find((item) => item.date === date);
        if (existing) return existing.result;

        const result = await callBsdMatchesSync({ date });
        bsdRefreshes.push({ date, reason, result });
        return result;
      };

      let todayBsdRefreshRes: BsdMatchesSyncResult | null = null;
      let todayFallbackOddsRes:
        | Awaited<ReturnType<typeof callInternalFallbackOddsSync>>
        | null = null;

      if (cursorDate !== today) {
        try {
          todayBsdRefreshRes = await refreshBsdDate(today, "today_hot_refresh");
        } catch (e: unknown) {
          warnings.push(`today_bsd_refresh: ${errorMessage(e, "failed")}`);
        }

        try {
          todayFallbackOddsRes = await callInternalFallbackOddsSync(today);
        } catch (e: unknown) {
          warnings.push(`today_fallback_odds: ${errorMessage(e, "failed")}`);
        }
      }

      const oddsWatchHorizonDays = clampPositiveInt(
        body.oddsWatchHorizonDays,
        ODDS_WATCH_DEFAULT_HORIZON_DAYS,
        ODDS_WATCH_MAX_HORIZON_DAYS
      );
      const oddsWatchMaxDates = clampPositiveInt(
        body.oddsWatchMaxDates,
        ODDS_WATCH_DEFAULT_MAX_DATES,
        ODDS_WATCH_HARD_MAX_DATES
      );

      try {
        oddsWatchPlanSummary = await buildOddsWatchPlan(sb, {
          nowIso,
          maxAheadDays: maxAhead,
          horizonDays: oddsWatchHorizonDays,
          maxDates: oddsWatchMaxDates,
        });

        if (oddsWatchPlanSummary.error) {
          warnings.push(`odds_watch_plan: ${oddsWatchPlanSummary.error}`);
        }

        for (const date of oddsWatchPlanSummary.dates) {
          try {
            await refreshBsdDate(date, "odds_watch");
            oddsWatchRefreshedDates.push(date);
          } catch (e: unknown) {
            warnings.push(`odds_watch:${date}: ${errorMessage(e, "failed")}`);
          }
        }
      } catch (e: unknown) {
        warnings.push(`odds_watch_plan: ${errorMessage(e, "failed")}`);
      }

      const bsdRes = await refreshBsdDate(cursorDate, "cursor");
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

      const sumBsdNumber = (selector: (result: BsdMatchesSyncResult) => unknown) =>
        bsdRefreshes.reduce(
          (sum, item) => sum + (Number(selector(item.result)) || 0),
          0
        );

      matchesUpserted = sumBsdNumber((result) => result?.upsertedMatchesCount);
      oddsUpserted = sumBsdNumber((result) => result?.upsertedOddsCount);
      bsdOddsApiAttempted = sumBsdNumber(
        (result) => result?.bsdOddsApi?.attempted
      );
      bsdOddsApiSucceeded = sumBsdNumber(
        (result) => result?.bsdOddsApi?.succeeded
      );
      bsdOddsApiFailed = sumBsdNumber((result) => result?.bsdOddsApi?.failed);
      bsdOddsApiSourceRows = sumBsdNumber(
        (result) => result?.bsdOddsApi?.sourceRows
      );
      bsdOddsApiInputs = sumBsdNumber((result) => result?.bsdOddsApi?.inputs);

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
        (Number(todayFallbackOddsRes?.summary?.pricedMatches ?? 0) || 0) +
        (Number(fallbackOddsRes?.summary?.pricedMatches ?? 0) || 0);
      fallbackOddsRows =
        (Number(todayFallbackOddsRes?.summary?.upsertedOddsRows ?? 0) || 0) +
        (Number(fallbackOddsRes?.summary?.upsertedOddsRows ?? 0) || 0);
      fallbackSkipped =
        (Number(todayFallbackOddsRes?.summary?.skipped ?? 0) || 0) +
        (Number(fallbackOddsRes?.summary?.skipped ?? 0) || 0);

      extra = {
        oddsWatch: {
          plan: oddsWatchPlanSummary,
          refreshedDates: oddsWatchRefreshedDates,
        },
        bsdRefreshes: bsdRefreshes.map((item) => ({
          date: item.date,
          reason: item.reason,
          upsertedMatchesCount:
            Number(item.result?.upsertedMatchesCount ?? 0) || 0,
          upsertedOddsCount: Number(item.result?.upsertedOddsCount ?? 0) || 0,
          bsdOddsApi: item.result?.bsdOddsApi ?? null,
        })),
        todayRefresh:
          cursorDate !== today
            ? {
                date: today,
                bsd: todayBsdRefreshRes,
                internalFallbackOdds: todayFallbackOddsRes,
              }
            : null,
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
      oddsWatch: {
        ...(oddsWatchPlanSummary ?? {
          horizonDays: ODDS_WATCH_DEFAULT_HORIZON_DAYS,
          maxDates: ODDS_WATCH_DEFAULT_MAX_DATES,
          freshnessMinutes: ODDS_WATCH_FRESHNESS_MINUTES,
          candidateMatches: 0,
          missingMatches: 0,
          staleMatches: 0,
          dates: [],
          skippedDates: 0,
          error: null,
        }),
        refreshedDates: oddsWatchRefreshedDates,
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
