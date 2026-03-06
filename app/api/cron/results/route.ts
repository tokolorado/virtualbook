// app/api/cron/results/route.ts

import { cronLogStart, cronLogSuccess, cronLogError } from "@/lib/cronLogger";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";

// ✅ Twoje wspierane ligi (football-data competition.code)
const SUPPORTED_COMP_CODES = new Set(["CL", "PL", "BL1", "FL1", "SA", "PD", "WC"]);

const HORIZON_DAYS = 14;

function utcYmdFromNowPlusDays(days: number) {
  const dt = new Date(Date.now() + days * 86400_000);
  return dt.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

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

// ✅ FIX: null/undefined NIE może robić się 0
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
  // zamykamy gdy:
  // - status nie jest SCHEDULED/TIMED (czyli live/finished/itd)
  // - albo kickoff <= teraz
  const s = (status || "").toUpperCase();
  if (s !== "SCHEDULED" && s !== "TIMED") return true;

  if (!utcDateIso) return false;
  const kickoffMs = Date.parse(utcDateIso);
  if (!Number.isFinite(kickoffMs)) return false;
  return kickoffMs <= Date.now();
}

function canonicalCompetitionName(code: string): string | null {
  const map: Record<string, string> = {
    CL: "Champions League",
    PL: "Premier League",
    BL1: "Bundesliga",
    FL1: "Ligue 1",
    SA: "Serie A",
    PD: "LaLiga",
    WC: "World Cup",
  };

  return map[code] ?? null;
}


async function upsertOneMatchFromFD(sb: any, match: any, nowIso: string) {
  const matchId = Number(match?.id);
  if (!Number.isFinite(matchId)) return { updated: false, matchId: null, status: null };

  // ✅ FILTR LIG
  if (!isSupportedCompetition(match)) {
    return { updated: false, matchId, status: null, skipped: "unsupported_competition" };
  }

  const status = normalizeStatus(String(match?.status ?? ""));
  const utcDateIso = toIsoOrNull(match?.utcDate);

  const ftHome = toIntOrNull(match?.score?.fullTime?.home);
  const ftAway = toIntOrNull(match?.score?.fullTime?.away);
  const htHome = toIntOrNull(match?.score?.halfTime?.home);
  const htAway = toIntOrNull(match?.score?.halfTime?.away);

  const compCode = String(match?.competition?.code ?? "").toUpperCase().trim();
  const compName = canonicalCompetitionName(compCode);

  const homeTeam = typeof match?.homeTeam?.name === "string" ? match.homeTeam.name : null;
  const awayTeam = typeof match?.awayTeam?.name === "string" ? match.awayTeam.name : null;


    const homeTeamId =
    Number.isFinite(Number(match?.homeTeam?.id)) ? Number(match.homeTeam.id) : null;
    const awayTeamId =
    Number.isFinite(Number(match?.awayTeam?.id)) ? Number(match.awayTeam.id) : null;

  const bettingClosed = computeBettingClosed(status, utcDateIso);

  // ✅ matches: upsert (żeby działało nawet gdy meczu nie ma w DB)
  const patchMatches: any = {
    id: matchId,
    status,
    last_sync_at: nowIso,
    betting_closed: bettingClosed,
  };

  if (utcDateIso) patchMatches.utc_date = utcDateIso;

  // ✅ Twoje wymaganie:
  // - competition_id = dwuliterowy kod ligi (SA/PL/...)
  // - competition_name = pełna nazwa (Serie A/Premier League/...)
  if (compCode) patchMatches.competition_id = compCode;
  if (compName) patchMatches.competition_name = compName;

  if (homeTeam) patchMatches.home_team = homeTeam;
  if (awayTeam) patchMatches.away_team = awayTeam;

  if (homeTeamId != null) patchMatches.home_team_id = homeTeamId;
  if (awayTeamId != null) patchMatches.away_team_id = awayTeamId;

  // ✅ KLUCZOWY FIX:
  // Dla meczów, które NIE są FINISHED, trzymamy NULL w matches (żeby nie było "fake 0:0").
  const canWriteScoreToMatches = status === "FINISHED"; // jeśli chcesz live, dopisz: || status === "IN_PLAY" || status === "PAUSED"

  if (canWriteScoreToMatches) {
    patchMatches.home_score = ftHome;
    patchMatches.away_score = ftAway;
  } else {
    patchMatches.home_score = null;
    patchMatches.away_score = null;
  }

  const { error: mErr } = await sb.from("matches").upsert(patchMatches, { onConflict: "id" });
  if (mErr) throw new Error(`matches upsert failed: ${mErr.message}`);

  // ✅ match_results
  // Jeśli chcesz mieć pełną spójność ("wynik dopiero po FINISHED"), też czyścimy.
  const startedAt = utcDateIso;
  const finishedAt = status === "FINISHED" ? nowIso : null;

  const canWriteScoreToResults = status === "FINISHED"; // analogicznie jak wyżej (dopisz IN_PLAY/PAUSED jeśli chcesz live)

  const resRow: any = {
    match_id: matchId,
    status,
    home_score: canWriteScoreToResults ? ftHome : null,
    away_score: canWriteScoreToResults ? ftAway : null,
    ht_home_score: canWriteScoreToResults ? htHome : null,
    ht_away_score: canWriteScoreToResults ? htAway : null,
    sh_home_score: null,
    sh_away_score: null,
    started_at: startedAt,
    finished_at: finishedAt,
    updated_at: nowIso,
  };

  const { error: rErr } = await sb.from("match_results").upsert(resRow, { onConflict: "match_id" });
  if (rErr) throw new Error(`match_results upsert failed: ${rErr.message}`);

  return { updated: true, matchId, status, compCode };
}

async function fetchExistingMatchIds(sb: any, ids: number[]) {
  if (!ids.length) return new Set<number>();

  // supabase ma limity długości URL → tnijmy na batch'e
  const BATCH = 200;
  const existing = new Set<number>();

  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);

    const { data, error } = await sb
      .from("matches")
      .select("id")
      .in("id", slice);

    if (error) throw new Error(`fetchExistingMatchIds failed: ${error.message}`);

    for (const r of data ?? []) {
      const id = Number((r as any).id);
      if (Number.isFinite(id)) existing.add(id);
    }
  }

  return existing;
}


export async function POST(req: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const got = req.headers.get("x-cron-secret");
      if (got !== secret) return jsonError("Unauthorized", 401);
    }

    const sb = supabaseAdmin();
    const nowIso = new Date().toISOString();

    const horizonDays = HORIZON_DAYS;
    const horizonDateYmd = utcYmdFromNowPlusDays(horizonDays);

    const url = new URL(req.url);
    const mode = (url.searchParams.get("mode") || "").toLowerCase();

    // ✅ TRYB: range (dzisiaj + wczoraj / dowolny zakres)
    if (mode === "range") {
      const dateFrom = url.searchParams.get("dateFrom");
      const dateTo = url.searchParams.get("dateTo");
      if (!dateFrom || !dateTo) {
        return jsonError("Missing dateFrom/dateTo (YYYY-MM-DD)", 400, {
          example: "?mode=range&dateFrom=2026-03-02&dateTo=2026-03-03",
        });
      }

      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 200), 500));

      const data = await fdFetch(
        `/matches?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`,
        { maxRetries: 2 }
      );

        const list = Array.isArray(data?.matches) ? data.matches : [];
        const slice = list.slice(0, limit);

        // ✅ 1) wyciągamy ID z paczki
        const incomingIds: number[] = [];
        for (const m of slice) {
        const id = Number((m as any)?.id);
        if (Number.isFinite(id)) incomingIds.push(id);
        }

        // ✅ 2) sprawdzamy co już mamy w DB
        const existingIds = await fetchExistingMatchIds(sb, incomingIds);

        let inserted = 0; // realnie: nowe mecze dodane
        let finished = 0;
        let skippedUnsupported = 0;
        let skippedExisting = 0;

        for (const m of slice) {
        const matchId = Number((m as any)?.id);
        if (!Number.isFinite(matchId)) continue;

        // jeśli już jest w DB → nie dotykamy, żeby nie robić upsertów
        if (existingIds.has(matchId)) {
            skippedExisting++;
            continue;
        }

        const r = await upsertOneMatchFromFD(sb, m, nowIso);

        if ((r as any).skipped === "unsupported_competition") {
            skippedUnsupported++;
            continue;
        }

        if (r.updated) {
            inserted++;
            if (r.status === "FINISHED") finished++;
        }
        }

      return NextResponse.json({
        ok: true,
        mode: "range",
        dateFrom,
        dateTo,
        inserted,
        finished,
        skippedExisting,
        skippedUnsupported,
        limit,
        updatedAt: nowIso,
        supported: Array.from(SUPPORTED_COMP_CODES.values()),
        horizon: { days: horizonDays, dateYmd: horizonDateYmd },
      });
    }

    // ⬇️ TRYB DOMYŚLNY: “stale TIMED” + dociąganie statusu z football-data
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 10), 50));

    const cutoffIso = new Date(Date.now() - 120 * 60 * 1000).toISOString();
    const recentSyncIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { data: candidates, error: cErr } = await sb
      .from("matches")
      .select("id, utc_date, status, last_sync_at")
      .lte("utc_date", cutoffIso)
      .in("status", ["TIMED", "SCHEDULED", "IN_PLAY", "PAUSED"])
      .or(`last_sync_at.is.null,last_sync_at.lt.${recentSyncIso}`)
      .order("utc_date", { ascending: true })
      .limit(limit);

    if (cErr) return jsonError(cErr.message, 500, { stage: "candidates_query" });

    const rows = candidates ?? [];

    let processed = 0;
    let becameFinished = 0;
    let skippedUnsupported = 0;

    for (const row of rows as any[]) {
      const matchId = Number(row?.id);
      if (!Number.isFinite(matchId)) continue;

      // ✅ FIX: football-data zwraca mecz BEZ wrappera "match"
      const data = await fdFetch(`/matches/${matchId}`, { maxRetries: 2 });
      const match = data?.match ?? data;
      if (!match) continue;

      // ✅ FILTR LIG (żeby np. Eredivisie nie wchodziło)
      if (!isSupportedCompetition(match)) {
        skippedUnsupported++;
        // nadal aktualizuj last_sync_at? tu nie ruszamy – zostawiamy
        continue;
      }

      const before = String(row?.status || "").toUpperCase();
      const status = normalizeStatus(String(match?.status ?? ""));
      const utcDateIso = toIsoOrNull(match?.utcDate);

      const ftHome = toIntOrNull(match?.score?.fullTime?.home);
      const ftAway = toIntOrNull(match?.score?.fullTime?.away);

      const compCode = String(match?.competition?.code ?? "").toUpperCase().trim();
      const compName = canonicalCompetitionName(compCode);

      const homeTeam = typeof match?.homeTeam?.name === "string" ? match.homeTeam.name : null;
      const awayTeam = typeof match?.awayTeam?.name === "string" ? match.awayTeam.name : null;
      const homeTeamId =
      Number.isFinite(Number(match?.homeTeam?.id)) ? Number(match.homeTeam.id) : null;
      const awayTeamId =
     Number.isFinite(Number(match?.awayTeam?.id)) ? Number(match.awayTeam.id) : null;

      const bettingClosed = computeBettingClosed(status, utcDateIso);

      const patchMatches: any = {
        status,
        last_sync_at: nowIso,
        betting_closed: bettingClosed,
      };

      if (utcDateIso) patchMatches.utc_date = utcDateIso;
      if (compCode) patchMatches.competition_id = compCode;
      if (compName) patchMatches.competition_name = compName;
      if (homeTeam) patchMatches.home_team = homeTeam;
      if (awayTeam) patchMatches.away_team = awayTeam;
      if (homeTeamId != null) patchMatches.home_team_id = homeTeamId;
      if (awayTeamId != null) patchMatches.away_team_id = awayTeamId;

      // ✅ KLUCZOWY FIX:
      // Dla meczów, które NIE są FINISHED, trzymamy NULL w matches.
      const canWriteScoreToMatches = status === "FINISHED"; // dopisz IN_PLAY/PAUSED jeśli chcesz live

      if (canWriteScoreToMatches) {
        patchMatches.home_score = ftHome;
        patchMatches.away_score = ftAway;
      } else {
        patchMatches.home_score = null;
        patchMatches.away_score = null;
      }

      const { error: uErr } = await sb.from("matches").update(patchMatches).eq("id", matchId);
      if (uErr) return jsonError(uErr.message, 500, { stage: "matches_update", matchId });

      // match_results upsert
      const htHome = toIntOrNull(match?.score?.halfTime?.home);
      const htAway = toIntOrNull(match?.score?.halfTime?.away);

      const startedAt = utcDateIso;
      const finishedAt = status === "FINISHED" ? nowIso : null;

      const canWriteScoreToResults = status === "FINISHED"; // dopisz IN_PLAY/PAUSED jeśli chcesz live

      const resRow: any = {
        match_id: matchId,
        status,
        home_score: canWriteScoreToResults ? ftHome : null,
        away_score: canWriteScoreToResults ? ftAway : null,
        ht_home_score: canWriteScoreToResults ? htHome : null,
        ht_away_score: canWriteScoreToResults ? htAway : null,
        sh_home_score: null,
        sh_away_score: null,
        started_at: startedAt,
        finished_at: finishedAt,
        updated_at: nowIso,
      };

      const { error: rErr } = await sb.from("match_results").upsert(resRow, { onConflict: "match_id" });
      if (rErr) return jsonError(rErr.message, 500, { stage: "match_results_upsert", matchId });

      if (before !== "FINISHED" && status === "FINISHED") becameFinished++;
      processed++;
    }

    return NextResponse.json({
      ok: true,
      mode: "stale-timed",
      processed,
      becameFinished,
      skippedUnsupported,
      limit,
      cutoffIso,
      recentSyncIso,
      updatedAt: nowIso,
      supported: Array.from(SUPPORTED_COMP_CODES.values()),
      horizon: { days: horizonDays, dateYmd: horizonDateYmd },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error", extra: { stage: "catch" } },
      { status: 500 }
    );
  }
}