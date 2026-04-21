import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireCronSecret } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";
const SUPPORTED_COMP_CODES = new Set(["CL", "PL", "BL1", "FL1", "SA", "PD", "WC"]);

// przyszłe dni odświeżamy periodycznie, żeby łapać później publikowane fixture'y
const FUTURE_REFRESH_HOURS = 12;

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ error: message, extra }, { status });
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function extractWaitSeconds(msg: string): number | null {
  const m = msg.match(/wait\s+(\d+)\s*seconds?/i);
  if (!m) return null;
  const s = Number(m[1]);
  if (!Number.isFinite(s) || s < 0) return null;
  return s;
}

function utcTodayYYYYMMDD() {
  return new Date().toISOString().slice(0, 10);
}

async function fdFetch(path: string, opts?: { maxRetries?: number }) {
  const token = process.env.FOOTBALL_DATA_TOKEN || process.env.FOOTBALL_DATA_API_KEY;
  if (!token) throw new Error("Missing FOOTBALL_DATA_TOKEN");

  const url = `${FOOTBALL_DATA_BASE}${path}`;
  const maxRetries = Math.max(0, opts?.maxRetries ?? 2);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const r = await fetch(url, {
      headers: { "X-Auth-Token": token },
      cache: "no-store",
    });

    const text = await r.text();
    let j: any = null;
    try {
      j = JSON.parse(text);
    } catch {
      j = { raw: text?.slice(0, 500) };
    }

    if (r.ok) return j;

    const msg =
      j?.message ||
      j?.error ||
      (typeof j?.raw === "string" ? j.raw : "") ||
      `football-data error (HTTP ${r.status})`;

    const waitSecs = extractWaitSeconds(String(msg));
    const canRetry = attempt < maxRetries;

    if (waitSecs != null && canRetry) {
      await sleep(waitSecs * 1000 + 500);
      continue;
    }

    if (r.status === 429 && canRetry) {
      await sleep((attempt + 1) * 1000 + 250);
      continue;
    }

    throw new Error(msg);
  }

  throw new Error("football-data error: retries exhausted");
}

function toIsoOrNull(v: any): string | null {
  if (!v) return null;
  const dt = new Date(String(v));
  const ms = dt.getTime();
  if (!Number.isFinite(ms)) return null;
  return dt.toISOString();
}

function toIntOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeStatus(raw: string): string {
  const s = (raw || "").toUpperCase().trim();
  if (s === "CANCELLED") return "CANCELED";

  const allowed = new Set([
    "SCHEDULED",
    "TIMED",
    "IN_PLAY",
    "PAUSED",
    "FINISHED",
    "POSTPONED",
    "SUSPENDED",
    "AWARDED",
    "CANCELED",
  ]);

  if (allowed.has(s)) return s;
  if (s === "DELAYED") return "POSTPONED";
  if (s === "ABANDONED") return "SUSPENDED";
  if (s === "LIVE") return "IN_PLAY";

  return "TIMED";
}

function isSupportedCompetition(match: any) {
  const code = String(match?.competition?.code ?? "").toUpperCase().trim();
  return SUPPORTED_COMP_CODES.has(code);
}

function computeBettingClosed(status: string, utcDateIso: string | null) {
  const s = (status || "").toUpperCase();
  if (s !== "SCHEDULED" && s !== "TIMED") return true;

  if (!utcDateIso) return false;

  const kickoffMs = Date.parse(utcDateIso);
  if (!Number.isFinite(kickoffMs)) return false;

  return kickoffMs <= Date.now();
}

export async function POST(req: Request) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const sb = supabaseAdmin();
    const now = new Date();
    const nowIso = now.toISOString();
    const today = utcTodayYYYYMMDD();

    const { data: job, error: qErr } = await sb
      .from("fetch_queue")
      .select("day,status,attempts,next_run_at")
      .eq("status", "pending")
      .lte("next_run_at", nowIso)
      .order("next_run_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (qErr) return jsonError(qErr.message, 500, { stage: "queue_select" });

    if (!job?.day) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "no_pending_jobs",
      });
    }

    const day = String(job.day);

    const { error: u0Err } = await sb
      .from("fetch_queue")
      .update({
        attempts: (job.attempts ?? 0) + 1,
        last_run_at: nowIso,
        last_error: null,
      })
      .eq("day", day);

    if (u0Err) {
      return jsonError(u0Err.message, 500, {
        stage: "queue_attempt_update",
        day,
      });
    }

    const data = await fdFetch(
      `/matches?dateFrom=${encodeURIComponent(day)}&dateTo=${encodeURIComponent(day)}`,
      { maxRetries: 2 }
    );

    const list = Array.isArray(data?.matches) ? data.matches : [];

    const rows: any[] = [];
    for (const m of list) {
      if (!isSupportedCompetition(m)) continue;

      const matchId = Number(m?.id);
      if (!Number.isFinite(matchId)) continue;

      const status = normalizeStatus(String(m?.status ?? ""));
      const utcDateIso = toIsoOrNull(m?.utcDate);
      if (!utcDateIso) continue;

      const compCode = String(m?.competition?.code ?? "").toUpperCase().trim();
      const compName =
        typeof m?.competition?.name === "string" ? m.competition.name : null;

      const homeTeam =
        typeof m?.homeTeam?.name === "string" ? m.homeTeam.name : null;
      const awayTeam =
        typeof m?.awayTeam?.name === "string" ? m.awayTeam.name : null;

      const homeTeamId = Number.isFinite(Number(m?.homeTeam?.id))
        ? Number(m.homeTeam.id)
        : null;

      const awayTeamId = Number.isFinite(Number(m?.awayTeam?.id))
        ? Number(m.awayTeam.id)
        : null;

      const bettingClosed = computeBettingClosed(status, utcDateIso);

      const ftHome = toIntOrNull(m?.score?.fullTime?.home);
      const ftAway = toIntOrNull(m?.score?.fullTime?.away);

      rows.push({
        id: matchId,
        utc_date: utcDateIso,
        status,
        competition_id: compCode || null,
        competition_name: compName,
        home_team: homeTeam,
        away_team: awayTeam,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        betting_closed: bettingClosed,
        home_score: status === "FINISHED" ? ftHome : null,
        away_score: status === "FINISHED" ? ftAway : null,
        created_at: nowIso,
        last_sync_at: nowIso,
      });
    }

    if (rows.length > 0) {
      const { error: insErr } = await sb
        .from("matches")
        .upsert(rows, { onConflict: "id", ignoreDuplicates: true });

      if (insErr) {
        await sb
          .from("fetch_queue")
          .update({
            last_error: insErr.message,
            next_run_at: new Date(Date.now() + 65_000).toISOString(),
            status: "pending",
          })
          .eq("day", day);

        return jsonError(insErr.message, 500, {
          stage: "matches_insert",
          day,
        });
      }
    }

    const isTodayOrFuture = day >= today;

    const nextRunAt = isTodayOrFuture
      ? new Date(Date.now() + FUTURE_REFRESH_HOURS * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() + 365 * 24 * 3600_000).toISOString();

    const { error: doneErr } = await sb
      .from("fetch_queue")
      .update({
        status: "done",
        next_run_at: nextRunAt,
      })
      .eq("day", day);

    if (doneErr) {
      return jsonError(doneErr.message, 500, {
        stage: "queue_done_update",
        day,
      });
    }

    return NextResponse.json({
      ok: true,
      day,
      fetchedFromApi: list.length,
      insertedCandidates: rows.length,
      supported: Array.from(SUPPORTED_COMP_CODES.values()),
      scheduledRefreshAt: nextRunAt,
      refreshHours: isTodayOrFuture ? FUTURE_REFRESH_HOURS : null,
      updatedAt: nowIso,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error", extra: { stage: "catch" } },
      { status: 500 }
    );
  }
}