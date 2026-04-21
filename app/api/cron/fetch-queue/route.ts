import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireCronSecret } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";

const SUPPORTED_COMP_CODES = [
  "CL",
  "PL",
  "BL1",
  "FL1",
  "SA",
  "PD",
  "WC",
] as const;

const SUPPORTED_COMP_CODES_SET = new Set<string>(SUPPORTED_COMP_CODES);

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
  return SUPPORTED_COMP_CODES_SET.has(code);
}

function computeBettingClosed(status: string, utcDateIso: string | null) {
  const s = (status || "").toUpperCase();
  if (s !== "SCHEDULED" && s !== "TIMED") return true;

  if (!utcDateIso) return false;

  const kickoffMs = Date.parse(utcDateIso);
  if (!Number.isFinite(kickoffMs)) return false;

  return kickoffMs <= Date.now();
}

function seasonToText(match: any): string | null {
  const seasonId = match?.season?.id;
  if (seasonId !== null && seasonId !== undefined && seasonId !== "") {
    return String(seasonId);
  }

  const startDate = match?.season?.startDate;
  if (typeof startDate === "string" && startDate.length >= 4) {
    return startDate.slice(0, 4);
  }

  return null;
}

async function fdFetch(path: string, opts?: { maxRetries?: number }) {
  const token =
    process.env.FOOTBALL_DATA_TOKEN || process.env.FOOTBALL_DATA_API_KEY;
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

async function writeSyncLog(
  sb: ReturnType<typeof supabaseAdmin>,
  payload: {
    cursor_date: string;
    phase: string;
    ok: boolean;
    matches_upserted?: number;
    odds_upserted?: number;
    leagues?: string[];
    message?: string | null;
    extra?: any;
  }
) {
  try {
    await sb.from("sync_logs").insert({
      cursor_date: payload.cursor_date,
      phase: payload.phase,
      ok: payload.ok,
      matches_upserted: payload.matches_upserted ?? 0,
      odds_upserted: payload.odds_upserted ?? 0,
      leagues: payload.leagues ?? [],
      message: payload.message ?? null,
      extra: payload.extra ?? {},
    });
  } catch (e) {
    console.error("sync_logs insert failed:", e);
  }
}

export async function POST(req: Request) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const sb = supabaseAdmin();
    const now = new Date();
    const nowIso = now.toISOString();
    const today = utcTodayYYYYMMDD();

    // 1) weź 1 dzień do obsłużenia
    const { data: job, error: qErr } = await sb
      .from("fetch_queue")
      .select("day,status,attempts,next_run_at")
      .eq("status", "pending")
      .lte("next_run_at", nowIso)
      .order("next_run_at", { ascending: true })
      .order("day", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (qErr) {
      return jsonError(qErr.message, 500, { stage: "queue_select" });
    }

    if (!job?.day) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "no_pending_jobs",
      });
    }

    const day = String(job.day);

    // 2) zaznacz próbę
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

    // 3) pobierz mecze osobno dla każdej wspieranej ligi
    const perCompetitionResults: {
      code: string;
      ok: boolean;
      fetchedCount: number;
      error?: string;
    }[] = [];

    const dedupedByMatchId = new Map<number, any>();

    for (const code of SUPPORTED_COMP_CODES) {
      try {
        const data = await fdFetch(
          `/competitions/${encodeURIComponent(
            code
          )}/matches?dateFrom=${encodeURIComponent(
            day
          )}&dateTo=${encodeURIComponent(day)}`,
          { maxRetries: 2 }
        );

        const matches = Array.isArray(data?.matches) ? data.matches : [];

        perCompetitionResults.push({
          code,
          ok: true,
          fetchedCount: matches.length,
        });

        for (const match of matches) {
          const matchId = Number(match?.id);
          if (!Number.isFinite(matchId)) continue;
          dedupedByMatchId.set(matchId, match);
        }

        // lekkie odciążenie API między ligami
        await sleep(150);
      } catch (e: any) {
        const msg = e?.message || `competition fetch failed: ${code}`;

        perCompetitionResults.push({
          code,
          ok: false,
          fetchedCount: 0,
          error: msg,
        });

        await sb
          .from("fetch_queue")
          .update({
            status: "pending",
            next_run_at: new Date(Date.now() + 65_000).toISOString(),
            last_error: msg,
          })
          .eq("day", day);

        await writeSyncLog(sb, {
          cursor_date: day,
          phase: "FETCH_QUEUE_DAY",
          ok: false,
          matches_upserted: 0,
          odds_upserted: 0,
          leagues: [...SUPPORTED_COMP_CODES],
          message: msg,
          extra: {
            stage: "competition_fetch",
            day,
            failedCompetition: code,
            perCompetitionResults,
          },
        });

        return jsonError(msg, 500, {
          stage: "competition_fetch",
          day,
          competition: code,
        });
      }
    }

    const list = Array.from(dedupedByMatchId.values());

    const supportedMatches = list.filter((m: any) => isSupportedCompetition(m));

    const allCompetitionCodesSeen: string[] = Array.from(
      new Set<string>(
        list
          .map((m: any): string =>
            String(m?.competition?.code ?? "").toUpperCase().trim()
          )
          .filter((code: string) => code.length > 0)
      )
    ).sort();

    const supportedCompetitionCodesSeen: string[] = Array.from(
      new Set<string>(
        supportedMatches
          .map((m: any): string =>
            String(m?.competition?.code ?? "").toUpperCase().trim()
          )
          .filter((code: string) => code.length > 0)
      )
    ).sort();

    // 4) przygotuj wiersze do UPSERT
    const rows: any[] = [];
    for (const m of supportedMatches) {
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

      if (!homeTeam || !awayTeam) continue;

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
        competition_id: compCode || null,
        competition_name: compName,
        utc_date: utcDateIso,
        status,
        matchday: toIntOrNull(m?.matchday),
        season: seasonToText(m),
        home_team: homeTeam,
        away_team: awayTeam,
        home_score: status === "FINISHED" ? ftHome : null,
        away_score: status === "FINISHED" ? ftAway : null,
        last_sync_at: nowIso,
        betting_closed: bettingClosed,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
      });
    }

    let upsertedRowsCount = 0;

    // 5) prawdziwy UPSERT po id — aktualizuje istniejące rekordy
    if (rows.length > 0) {
      const { data: upsertedData, error: upsertErr } = await sb
        .from("matches")
        .upsert(rows, { onConflict: "id" })
        .select("id");

      if (upsertErr) {
        await sb
          .from("fetch_queue")
          .update({
            status: "pending",
            next_run_at: new Date(Date.now() + 65_000).toISOString(),
            last_error: upsertErr.message,
          })
          .eq("day", day);

        await writeSyncLog(sb, {
          cursor_date: day,
          phase: "FETCH_QUEUE_DAY",
          ok: false,
          matches_upserted: 0,
          odds_upserted: 0,
          leagues: supportedCompetitionCodesSeen,
          message: upsertErr.message,
          extra: {
            stage: "matches_upsert",
            day,
            fetchedFromApi: list.length,
            supportedAfterFilter: supportedMatches.length,
            upsertPayloadCount: rows.length,
            allCompetitionCodesSeen,
            supportedCompetitionCodesSeen,
            perCompetitionResults,
          },
        });

        return jsonError(upsertErr.message, 500, {
          stage: "matches_upsert",
          day,
        });
      }

      upsertedRowsCount = Array.isArray(upsertedData)
        ? upsertedData.length
        : rows.length;
        try {
          await sb
            .from("api_cache")
            .delete()
            .like("key", "events_enabled_dates:%");
        } catch (e) {
          console.error("events_enabled_dates cache clear failed:", e);
        }
    }
    

    // 6) harmonogram kolejnego odświeżenia
    const isTodayOrFuture = day >= today;

    const nextRunAt = isTodayOrFuture
      ? new Date(
          Date.now() + FUTURE_REFRESH_HOURS * 60 * 60 * 1000
        ).toISOString()
      : new Date(Date.now() + 365 * 24 * 3600_000).toISOString();

    const { error: doneErr } = await sb
      .from("fetch_queue")
      .update({
        status: "done",
        next_run_at: nextRunAt,
        last_error: null,
      })
      .eq("day", day);

    if (doneErr) {
      await writeSyncLog(sb, {
        cursor_date: day,
        phase: "FETCH_QUEUE_DAY",
        ok: false,
        matches_upserted: upsertedRowsCount,
        odds_upserted: 0,
        leagues: supportedCompetitionCodesSeen,
        message: doneErr.message,
        extra: {
          stage: "queue_done_update",
          day,
          fetchedFromApi: list.length,
          supportedAfterFilter: supportedMatches.length,
          upsertPayloadCount: rows.length,
          upsertedRowsCount,
          allCompetitionCodesSeen,
          supportedCompetitionCodesSeen,
          perCompetitionResults,
        },
      });

      return jsonError(doneErr.message, 500, {
        stage: "queue_done_update",
        day,
      });
    }

    await writeSyncLog(sb, {
      cursor_date: day,
      phase: "FETCH_QUEUE_DAY",
      ok: true,
      matches_upserted: upsertedRowsCount,
      odds_upserted: 0,
      leagues: supportedCompetitionCodesSeen,
      message:
        rows.length > 0
          ? `Fetched ${list.length} matches across competitions, ${supportedMatches.length} supported, upserted ${upsertedRowsCount}`
          : `Fetched 0 supported matches across competitions for ${day}`,
      extra: {
        day,
        fetchedFromApi: list.length,
        supportedAfterFilter: supportedMatches.length,
        upsertPayloadCount: rows.length,
        upsertedRowsCount,
        allCompetitionCodesSeen,
        supportedCompetitionCodesSeen,
        perCompetitionResults,
        nextRunAt,
        refreshHours: isTodayOrFuture ? FUTURE_REFRESH_HOURS : null,
      },
    });

    return NextResponse.json({
      ok: true,
      day,
      fetchedFromApi: list.length,
      supportedAfterFilter: supportedMatches.length,
      upsertPayloadCount: rows.length,
      upsertedRowsCount,
      allCompetitionCodesSeen,
      supportedCompetitionCodesSeen,
      perCompetitionResults,
      supported: [...SUPPORTED_COMP_CODES],
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