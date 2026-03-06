import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://api.football-data.org/v4";
const DEFAULT_LEAGUES = ["CL", "PL", "BL1", "FL1", "SA", "PD", "WC"] as const;

const RESULTS_LOCK_KEY = "lock:results_sync";
const RESULTS_LOCK_TTL_MS = 60 * 1000;

const LOOKBACK_HOURS_DEFAULT = 48;
const BATCH_LIMIT_DEFAULT = 30;

function jsonError(message: string, status = 500, extra?: any) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
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
  supabase: any,
  nowIso: string
): Promise<{ ok: true } | { ok: false; ageMs: number }> {
  const { data } = (await supabase
    .from("api_cache")
    .select("updated_at")
    .eq("key", RESULTS_LOCK_KEY)
    .maybeSingle()) as { data: any };

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

function mapFdStatusToLocal(fdStatus: string | null | undefined): string {
  const s = (fdStatus ?? "").toUpperCase();

  if (s === "FINISHED") return "FINISHED";
  if (s === "CANCELED") return "CANCELED";
  if (s === "CANCELLED") return "CANCELLED";
  if (s === "POSTPONED") return "POSTPONED";
  if (s === "SUSPENDED") return "SUSPENDED";
  if (s === "AWARDED") return "AWARDED";
  if (s === "IN_PLAY") return "IN_PLAY";
  if (s === "PAUSED") return "PAUSED";
  if (s === "TIMED") return "TIMED";
  return "SCHEDULED";
}

function toIntOrNull(x: any): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  return null;
}

function isoDateOnlyUTC(date: Date) {
  return date.toISOString().slice(0, 10);
}

type SyncBody = {
  leagues?: string[];
  batchLimit?: number;
  lookbackHours?: number;
  throttleMs?: number;
  maxRetries?: number;
};

export async function POST(req: Request) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!apiKey) return jsonError("Missing FOOTBALL_DATA_API_KEY in env", 500);

  const supabase = supabaseAdmin() as any;

  try {
    const raw = await req.text();
    let body: SyncBody = {};

    try {
      body = raw ? (JSON.parse(raw) as SyncBody) : {};
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

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
    const lookbackIso = lookbackStart.toISOString();

    const { data: candidates, error: candidatesErr } = await supabase
      .from("matches")
      .select(
        "id, competition_id, utc_date, status, home_score, away_score, home_team_id, away_team_id"
      )
      .in("competition_id", leagues)
      .gte("utc_date", lookbackIso)
      .in("status", ["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED"])
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

    const results: Array<Record<string, any>> = [];

    for (const [leagueCode, leagueMatches] of byLeague.entries()) {
      const minUtcMs = Math.min(
        ...leagueMatches.map((m) => new Date(m.utc_date).getTime())
      );
      const maxUtcMs = Math.max(
        ...leagueMatches.map((m) => new Date(m.utc_date).getTime())
      );

      const dateFrom = isoDateOnlyUTC(new Date(minUtcMs - 24 * 60 * 60 * 1000));
      const dateTo = isoDateOnlyUTC(new Date(maxUtcMs + 24 * 60 * 60 * 1000));

      const url = new URL(`${BASE}/competitions/${encodeURIComponent(leagueCode)}/matches`);
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

      const upstreamMatches = Array.isArray((upstream.data as any)?.matches)
        ? ((upstream.data as any).matches as any[])
        : [];

      const upstreamById = new Map<number, any>();
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
          const nextHomeScore = toIntOrNull(upstreamMatch?.score?.fullTime?.home);
          const nextAwayScore = toIntOrNull(upstreamMatch?.score?.fullTime?.away);

          const statusChanged = nextStatus !== localMatch.status;
          const scoreChanged =
            nextHomeScore !== localMatch.home_score ||
            nextAwayScore !== localMatch.away_score;

          if (statusChanged || scoreChanged) {
            const { error: updateErr } = await supabase
              .from("matches")
              .update({
                status: nextStatus,
                home_score: nextHomeScore,
                away_score: nextAwayScore,
                last_sync_at: new Date().toISOString(),
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
            await supabase
              .from("matches")
              .update({ last_sync_at: new Date().toISOString() })
              .eq("id", localMatch.id);
          }

          let settleOk = false;
          let eloOk = false;

          if (nextStatus === "FINISHED") {
            const { error: settleErr } = await supabase.rpc("settle_match", {
              p_match_id: String(localMatch.id),
            });

            if (!settleErr) {
              settled += 1;
              settleOk = true;
            }

            const { error: eloErr } = await supabase.rpc("apply_elo_for_match", {
              p_match_id: localMatch.id,
            });

            if (!eloErr) {
              eloApplied += 1;
              eloOk = true;
            }

            results.push({
              matchId: localMatch.id,
              ok: true,
              stage: "finished_processed",
              status: nextStatus,
              updatedMatch: statusChanged || scoreChanged,
              settled: settleOk,
              eloApplied: eloOk,
            });
          } else {
            results.push({
              matchId: localMatch.id,
              ok: true,
              stage: "match_updated",
              status: nextStatus,
              updatedMatch: statusChanged || scoreChanged,
            });
          }
        } catch (e: any) {
          results.push({
            matchId: localMatch.id,
            ok: false,
            stage: "catch_per_match",
            error: e?.message || "Unknown error",
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
      updatedAt: nowIso,
      results,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || "Server error",
        extra: { stage: "catch" },
      },
      { status: 500 }
    );
  }
}