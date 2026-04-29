// app/api/results/sync/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireCronSecret } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://api.football-data.org/v4";
const DEFAULT_LEAGUES = ["CL", "PL", "BL1", "FL1", "SA", "PD", "WC"] as const;

const RESULTS_LOCK_KEY = "lock:results_sync";
const RESULTS_LOCK_TTL_MS = 60 * 1000;

const LOOKBACK_HOURS_DEFAULT = 12;
const LOOKAHEAD_HOURS_DEFAULT = 6;
const BATCH_LIMIT_DEFAULT = 80;

type JsonObject = Record<string, unknown>;
type SupabaseAdminClient = ReturnType<typeof supabaseAdmin>;

type FootballDataScoreSide = {
  home?: unknown;
  away?: unknown;
};

type FootballDataScore = {
  fullTime?: FootballDataScoreSide | null;
  regularTime?: FootballDataScoreSide | null;
  halfTime?: FootballDataScoreSide | null;
};

type FootballDataStatusObject = {
  minute?: unknown;
  injuryTime?: unknown;
};

type FootballDataMatch = {
  id?: unknown;
  status?: unknown;
  score?: FootballDataScore | null;
  minute?: unknown;
  injuryTime?: unknown;
};

type FootballDataMatchesResponse = JsonObject & {
  matches?: FootballDataMatch[];
};

type ApiCacheLockRow = {
  updated_at: string | null;
};

function jsonError(message: string, status = 500, extra?: JsonObject) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJson(text: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : { raw: parsed };
  } catch {
    return { raw: text };
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(h: string | null): number | null {
  if (!h) return null;

  const secs = Number(h);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);

  const dt = Date.parse(h);
  if (Number.isFinite(dt)) {
    const ms = dt - Date.now();
    return ms > 0 ? ms : 0;
  }

  return null;
}

function extractWaitSecondsFromMessage(msg: string): number | null {
  const m = msg.match(/wait\s+(\d+)\s*seconds?/i);
  if (!m) return null;

  const s = Number(m[1]);
  if (!Number.isFinite(s) || s < 0) return null;

  return s;
}

function isRateLimitMessage(msg: unknown): msg is string {
  if (typeof msg !== "string") return false;

  const s = msg.toLowerCase();

  return (
    s.includes("request limit") ||
    s.includes("rate limit") ||
    s.includes("too many requests") ||
    s.includes("wait ")
  );
}

function errorMessage(error: unknown, fallback = "Server error") {
  return error instanceof Error ? error.message : fallback;
}

let lastFdCallAt = 0;

async function globalThrottle(throttleMs: number) {
  if (throttleMs <= 0) return;

  const now = Date.now();
  const delta = now - lastFdCallAt;

  if (delta < throttleMs) {
    await sleep(throttleMs - delta);
  }

  lastFdCallAt = Date.now();
}

async function fetchFD(
  url: string,
  apiKey: string,
  opts: { throttleMs: number; maxRetries: number }
) {
  let attempt = 0;

  while (true) {
    attempt += 1;

    await globalThrottle(opts.throttleMs);

    const r = await fetch(url, {
      headers: { "X-Auth-Token": apiKey },
      cache: "no-store",
    });

    const text = await r.text();
    const data = safeJson(text);

    if (r.ok) {
      return { ok: true as const, status: r.status, data };
    }

    const msg =
      data?.message ||
      data?.error ||
      (typeof data?.raw === "string" ? data.raw : "") ||
      `football-data error (HTTP ${r.status})`;

    const canRetry = attempt <= Math.max(0, opts.maxRetries);

    if (r.status === 429 && canRetry) {
      const retryAfterMs = parseRetryAfterMs(r.headers.get("retry-after"));
      const backoff = 1000 * attempt;
      const waitMs = Math.max(retryAfterMs ?? 0, backoff, opts.throttleMs);

      await sleep(waitMs);
      continue;
    }

    if (isRateLimitMessage(msg) && canRetry) {
      const waitSecs = extractWaitSecondsFromMessage(msg);
      const waitMs = Math.max(
        waitSecs != null ? waitSecs * 1000 + 250 : 0,
        1000 * attempt,
        opts.throttleMs
      );

      await sleep(waitMs);
      continue;
    }

    return {
      ok: false as const,
      status: r.status,
      data,
      message: msg,
    };
  }
}

async function tryAcquireLock(
  supabase: SupabaseAdminClient,
  nowIso: string
): Promise<{ ok: true } | { ok: false; ageMs: number }> {
  const { data } = (await supabase
    .from("api_cache")
    .select("updated_at")
    .eq("key", RESULTS_LOCK_KEY)
    .maybeSingle()) as { data: ApiCacheLockRow | null };

  if (data?.updated_at) {
    const ageMs = Date.now() - new Date(data.updated_at).getTime();

    if (ageMs >= 0 && ageMs < RESULTS_LOCK_TTL_MS) {
      return { ok: false, ageMs };
    }
  }

  await supabase.from("api_cache").upsert({
    key: RESULTS_LOCK_KEY,
    payload: { locked: true },
    updated_at: nowIso,
  });

  return { ok: true };
}

function mapFdStatusToLocal(fdStatus: unknown): string {
  const s = String(fdStatus ?? "").toUpperCase();

  if (s === "FINISHED") return "FINISHED";
  if (s === "CANCELED") return "CANCELED";
  if (s === "CANCELLED") return "CANCELLED";
  if (s === "POSTPONED") return "POSTPONED";
  if (s === "SUSPENDED") return "SUSPENDED";
  if (s === "AWARDED") return "AWARDED";
  if (s === "LIVE") return "IN_PLAY";
  if (s === "IN_PLAY") return "IN_PLAY";
  if (s === "PAUSED") return "PAUSED";
  if (s === "TIMED") return "TIMED";
  if (s === "SCHEDULED") return "SCHEDULED";

  return "SCHEDULED";
}

function toIntOrNull(x: unknown): number | null {
  if (x === null || x === undefined || x === "") return null;

  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return null;

  return Math.trunc(n);
}

function pickMatchScore(match: FootballDataMatch, side: "home" | "away"): number | null {
  const fullTime = toIntOrNull(match?.score?.fullTime?.[side]);
  if (fullTime !== null) return fullTime;

  const regularTime = toIntOrNull(match?.score?.regularTime?.[side]);
  if (regularTime !== null) return regularTime;

  const halfTime = toIntOrNull(match?.score?.halfTime?.[side]);
  if (halfTime !== null) return halfTime;

  return null;
}

function asStatusObject(status: unknown): FootballDataStatusObject | null {
  return isRecord(status) ? status : null;
}

function pickMatchMinute(match: FootballDataMatch): number | null {
  const direct = toIntOrNull(match?.minute);
  if (direct !== null && direct >= 0) return direct;

  const statusMinute = toIntOrNull(asStatusObject(match?.status)?.minute);
  if (statusMinute !== null && statusMinute >= 0) return statusMinute;

  return null;
}

function pickInjuryTime(match: FootballDataMatch): number | null {
  const direct = toIntOrNull(match?.injuryTime);
  if (direct !== null && direct >= 0) return direct;

  const statusInjuryTime = toIntOrNull(asStatusObject(match?.status)?.injuryTime);
  if (statusInjuryTime !== null && statusInjuryTime >= 0) {
    return statusInjuryTime;
  }

  return null;
}

function isLiveLocalStatus(status: string) {
  const s = status.toUpperCase();
  return s === "LIVE" || s === "IN_PLAY" || s === "PAUSED";
}

function canPersistScore(status: string) {
  return status.toUpperCase() === "FINISHED";
}

function isoDateOnlyUTC(date: Date) {
  return date.toISOString().slice(0, 10);
}

function secondHalfOrNull(full: number | null, half: number | null) {
  if (full == null || half == null) return null;
  const value = full - half;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

type SyncBody = {
  leagues?: string[];
  batchLimit?: number;
  lookbackHours?: number;
  lookaheadHours?: number;
  throttleMs?: number;
  maxRetries?: number;
};

type MatchResultPatch = {
  match_id: number;
  status: string;
  home_score: number | null;
  away_score: number | null;
  ht_home_score: number | null;
  ht_away_score: number | null;
  sh_home_score: number | null;
  sh_away_score: number | null;
  home_goals_ht: number | null;
  away_goals_ht: number | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

function buildMatchResultPatch(params: {
  matchId: number;
  status: string;
  utcDate: string | null;
  finishedAt: string;
  homeScore: number | null;
  awayScore: number | null;
  halfHomeScore: number | null;
  halfAwayScore: number | null;
}): MatchResultPatch {
  const shHomeScore = secondHalfOrNull(params.homeScore, params.halfHomeScore);
  const shAwayScore = secondHalfOrNull(params.awayScore, params.halfAwayScore);

  return {
    match_id: params.matchId,
    status: params.status,
    home_score: params.homeScore,
    away_score: params.awayScore,
    ht_home_score: params.halfHomeScore,
    ht_away_score: params.halfAwayScore,
    sh_home_score: shHomeScore,
    sh_away_score: shAwayScore,
    home_goals_ht: params.halfHomeScore,
    away_goals_ht: params.halfAwayScore,
    started_at: params.utcDate,
    finished_at: params.finishedAt,
    updated_at: params.finishedAt,
  };
}

async function readSyncBody(req: Request): Promise<SyncBody | NextResponse> {
  if (req.method === "GET") {
    return {};
  }

  const raw = await req.text();

  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw) as SyncBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
}

async function runResultsSync(req: Request) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!apiKey) {
    return jsonError("Missing FOOTBALL_DATA_API_KEY in env", 500);
  }

  const supabase = supabaseAdmin();

  try {
    const parsedBody = await readSyncBody(req);

    if (parsedBody instanceof NextResponse) {
      return parsedBody;
    }

    const body = parsedBody;

    const leagues =
      Array.isArray(body.leagues) && body.leagues.length
        ? body.leagues.map(String)
        : [...DEFAULT_LEAGUES];

    const batchLimit = Number.isFinite(Number(body.batchLimit))
      ? clamp(Math.floor(Number(body.batchLimit)), 1, 200)
      : BATCH_LIMIT_DEFAULT;

    const lookbackHours = Number.isFinite(Number(body.lookbackHours))
      ? clamp(Math.floor(Number(body.lookbackHours)), 1, 168)
      : LOOKBACK_HOURS_DEFAULT;

    const lookaheadHours = Number.isFinite(Number(body.lookaheadHours))
      ? clamp(Math.floor(Number(body.lookaheadHours)), 1, 48)
      : LOOKAHEAD_HOURS_DEFAULT;

    const throttleMs = Number.isFinite(Number(body.throttleMs))
      ? Math.max(0, Number(body.throttleMs))
      : 1200;

    const maxRetries = Number.isFinite(Number(body.maxRetries))
      ? Math.max(0, Math.floor(Number(body.maxRetries)))
      : 2;

    const now = new Date();
    const nowIso = now.toISOString();

    const lock = await tryAcquireLock(supabase, nowIso);

    if (!lock.ok) {
      return NextResponse.json({
        ok: true,
        skipped: "locked",
        lockAgeMs: lock.ageMs,
        updatedAt: nowIso,
      });
    }

    const lookbackStart = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
    const lookaheadEnd = new Date(Date.now() + lookaheadHours * 60 * 60 * 1000);

    const lookbackIso = lookbackStart.toISOString();
    const lookaheadIso = lookaheadEnd.toISOString();

    const { data: candidates, error: candidatesErr } = await supabase
      .from("matches")
      .select(
        "id, competition_id, utc_date, status, home_score, away_score, minute, injury_time, home_team_id, away_team_id"
      )
      .in("competition_id", leagues)
      .gte("utc_date", lookbackIso)
      .lte("utc_date", lookaheadIso)
      .in("status", [
        "SCHEDULED",
        "TIMED",
        "IN_PLAY",
        "PAUSED",
        "LIVE",
        "FINISHED",
      ])
      .order("utc_date", { ascending: true })
      .limit(batchLimit);

    if (candidatesErr) {
      return jsonError("matches read failed", 500, { detail: candidatesErr });
    }

    const pendingMatches = (candidates ?? []) as Array<{
      id: number;
      competition_id: string;
      utc_date: string;
      status: string;
      home_score: number | null;
      away_score: number | null;
      minute: number | null;
      injury_time: number | null;
      home_team_id: number | null;
      away_team_id: number | null;
    }>;

    if (!pendingMatches.length) {
      return NextResponse.json({
        ok: true,
        leagues,
        processed: 0,
        updated: 0,
        settled: 0,
        eloApplied: 0,
        batchLimit,
        lookbackHours,
        lookaheadHours,
        window: {
          from: lookbackIso,
          to: lookaheadIso,
        },
        updatedAt: nowIso,
        reason: "no_pending_matches",
      });
    }

    const byLeague = new Map<string, typeof pendingMatches>();

    for (const m of pendingMatches) {
      const arr = byLeague.get(m.competition_id) ?? [];
      arr.push(m);
      byLeague.set(m.competition_id, arr);
    }

    const fetchOpts = { throttleMs, maxRetries };

    let processed = 0;
    let updated = 0;
    let settled = 0;
    let eloApplied = 0;

    const results: JsonObject[] = [];

    for (const [leagueCode, leagueMatches] of byLeague.entries()) {
      const minUtcMs = Math.min(
        ...leagueMatches.map((m) => new Date(m.utc_date).getTime())
      );

      const maxUtcMs = Math.max(
        ...leagueMatches.map((m) => new Date(m.utc_date).getTime())
      );

      const dateFrom = isoDateOnlyUTC(new Date(minUtcMs - 24 * 60 * 60 * 1000));
      const dateTo = isoDateOnlyUTC(new Date(maxUtcMs + 24 * 60 * 60 * 1000));

      const url = new URL(
        `${BASE}/competitions/${encodeURIComponent(leagueCode)}/matches`
      );

      url.searchParams.set("dateFrom", dateFrom);
      url.searchParams.set("dateTo", dateTo);

      const upstream = await fetchFD(url.toString(), apiKey, fetchOpts);

      if (!upstream.ok) {
        for (const m of leagueMatches) {
          processed += 1;

          results.push({
            matchId: m.id,
            ok: false,
            stage: "league_fetch_failed",
            league: leagueCode,
            error: upstream.message,
          });
        }

        continue;
      }

      const upstreamMatches = Array.isArray(
        (upstream.data as FootballDataMatchesResponse).matches
      )
        ? (upstream.data as FootballDataMatchesResponse).matches ?? []
        : [];

      const upstreamById = new Map<number, FootballDataMatch>();

      for (const um of upstreamMatches) {
        const id = Number(um?.id);

        if (Number.isFinite(id)) {
          upstreamById.set(id, um);
        }
      }

      for (const localMatch of leagueMatches) {
        processed += 1;

        try {
          const upstreamMatch = upstreamById.get(localMatch.id);

          if (!upstreamMatch) {
            results.push({
              matchId: localMatch.id,
              ok: false,
              stage: "upstream_missing_match",
              league: leagueCode,
            });

            continue;
          }

          const nextStatus = mapFdStatusToLocal(upstreamMatch?.status);

          const upstreamHomeScore = pickMatchScore(upstreamMatch, "home");
          const upstreamAwayScore = pickMatchScore(upstreamMatch, "away");
          const upstreamHtHomeScore = toIntOrNull(
            upstreamMatch?.score?.halfTime?.home
          );
          const upstreamHtAwayScore = toIntOrNull(
            upstreamMatch?.score?.halfTime?.away
          );

          const scoreCanBePersisted = canPersistScore(nextStatus);

          const nextHomeScore = scoreCanBePersisted
            ? upstreamHomeScore ?? localMatch.home_score
            : null;

          const nextAwayScore = scoreCanBePersisted
            ? upstreamAwayScore ?? localMatch.away_score
            : null;

          const nextIsLive = isLiveLocalStatus(nextStatus);
          const nextMinute = nextIsLive ? pickMatchMinute(upstreamMatch) : null;
          const nextInjuryTime = nextIsLive
            ? pickInjuryTime(upstreamMatch)
            : null;

          const statusChanged = nextStatus !== localMatch.status;

          const scoreChanged =
            nextHomeScore !== localMatch.home_score ||
            nextAwayScore !== localMatch.away_score;

          const minuteChanged =
            nextMinute !== localMatch.minute ||
            nextInjuryTime !== localMatch.injury_time;

          const syncAt = new Date().toISOString();

          if (statusChanged || scoreChanged || minuteChanged) {
            const { error: updateErr } = await supabase
              .from("matches")
              .update({
                status: nextStatus,
                home_score: nextHomeScore,
                away_score: nextAwayScore,
                minute: nextMinute,
                injury_time: nextInjuryTime,
                last_sync_at: syncAt,
              })
              .eq("id", localMatch.id);

            if (updateErr) {
              results.push({
                matchId: localMatch.id,
                ok: false,
                stage: "db_match_update_failed",
                error: updateErr.message,
              });

              continue;
            }

            updated += 1;
          } else {
            const { error: touchErr } = await supabase
              .from("matches")
              .update({
                minute: nextMinute,
                injury_time: nextInjuryTime,
                last_sync_at: syncAt,
              })
              .eq("id", localMatch.id);

            if (touchErr) {
              results.push({
                matchId: localMatch.id,
                ok: false,
                stage: "db_match_touch_failed",
                error: touchErr.message,
              });

              continue;
            }
          }

          if (nextStatus === "FINISHED") {
            let settleOk = false;
            let settleError: string | null = null;
            let settleResult: unknown = null;

            if (nextHomeScore == null || nextAwayScore == null) {
              results.push({
                matchId: localMatch.id,
                ok: false,
                stage: "finished_missing_score",
                status: nextStatus,
                previousStatus: localMatch.status,
                homeScore: nextHomeScore,
                awayScore: nextAwayScore,
                minute: nextMinute,
                injuryTime: nextInjuryTime,
                updatedMatch: statusChanged || scoreChanged || minuteChanged,
                settled: false,
                settleError:
                  "Finished match has no full-time score from football-data.",
              });

              continue;
            }

            const matchResultRow = buildMatchResultPatch({
              matchId: localMatch.id,
              status: nextStatus,
              utcDate: localMatch.utc_date,
              finishedAt: syncAt,
              homeScore: nextHomeScore,
              awayScore: nextAwayScore,
              halfHomeScore: upstreamHtHomeScore,
              halfAwayScore: upstreamHtAwayScore,
            });

            const { error: resultUpsertErr } = await supabase
              .from("match_results")
              .upsert(matchResultRow, { onConflict: "match_id" });

            if (resultUpsertErr) {
              results.push({
                matchId: localMatch.id,
                ok: false,
                stage: "match_results_upsert_failed",
                status: nextStatus,
                previousStatus: localMatch.status,
                homeScore: nextHomeScore,
                awayScore: nextAwayScore,
                minute: nextMinute,
                injuryTime: nextInjuryTime,
                updatedMatch: statusChanged || scoreChanged || minuteChanged,
                settled: false,
                settleError: resultUpsertErr.message,
              });

              continue;
            }

            const { data: settleData, error: settleErr } = await supabase.rpc(
              "settle_match_once",
              {
                p_match_id: localMatch.id,
              }
            );

            if (!settleErr) {
              settled += 1;
              settleOk = true;
              settleResult = settleData ?? null;
            } else {
              settleError = settleErr.message;
            }

            let eloOk = false;
            let eloAppliedNow = false;
            let eloAlreadyApplied = false;
            let eloError: string | null = null;

            const { data: eloData, error: eloErr } = await supabase.rpc(
              "apply_elo_for_match",
              {
                p_match_id: localMatch.id,
              }
            );

            if (!eloErr) {
              eloOk = true;
              eloAppliedNow = eloData === true;
              eloAlreadyApplied = eloData === false;

              if (eloAppliedNow) {
                eloApplied += 1;
              }
            } else {
              eloError = eloErr.message;
            }

            results.push({
              matchId: localMatch.id,
              ok: settleOk && eloOk,
              stage: "finished_processed",
              status: nextStatus,
              previousStatus: localMatch.status,
              homeScore: nextHomeScore,
              awayScore: nextAwayScore,
              minute: nextMinute,
              injuryTime: nextInjuryTime,
              updatedMatch: statusChanged || scoreChanged || minuteChanged,
              upsertedMatchResult: true,
              settled: settleOk,
              settleResult,
              settleError,
              eloOk,
              eloApplied: eloAppliedNow,
              eloAlreadyApplied,
              eloError,
            });
          } else {
            results.push({
              matchId: localMatch.id,
              ok: true,
              stage: "match_updated",
              status: nextStatus,
              previousStatus: localMatch.status,
              homeScore: nextHomeScore,
              awayScore: nextAwayScore,
              minute: nextMinute,
              injuryTime: nextInjuryTime,
              updatedMatch: statusChanged || scoreChanged || minuteChanged,
            });
          }
        } catch (e: unknown) {
          results.push({
            matchId: localMatch.id,
            ok: false,
            stage: "catch_per_match",
            error: errorMessage(e, "Unknown error"),
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      leagues,
      processed,
      updated,
      settled,
      eloApplied,
      batchLimit,
      lookbackHours,
      lookaheadHours,
      window: {
        from: lookbackIso,
        to: lookaheadIso,
      },
      updatedAt: nowIso,
      results,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      {
        error: errorMessage(e),
        extra: { stage: "catch" },
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return runResultsSync(req);
}

export async function GET(req: Request) {
  return runResultsSync(req);
}
