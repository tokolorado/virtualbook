// app/api/events/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { addDaysLocal, todayLocalYYYYMMDD } from "@/lib/date";

const BASE = "https://api.football-data.org/v4";

const LEAGUES = [
  { code: "CL", name: "Champions League" },
  { code: "PL", name: "Premier League" },
  { code: "BL1", name: "Bundesliga" },
  { code: "FL1", name: "Ligue 1" },
  { code: "SA", name: "Serie A" },
  { code: "PD", name: "LaLiga" },
  { code: "WC", name: "World Cup" },
];

const MARKET_ID_1X2 = "1x2";

const FIXTURES_REFRESH_TTL_MS = 15 * 60 * 1000;
const LIVE_DETAIL_REFRESH_TTL_MS = 25 * 1000;
const PRESTART_DETAIL_REFRESH_TTL_MS = 60 * 1000;
const LIVE_DETAIL_BATCH_LIMIT = 24;

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

function safeScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;

  return Math.trunc(n);
}

function pickMatchScore(match: any, side: "home" | "away"): number | null {
  const fullTime = safeScore(match?.score?.fullTime?.[side]);
  if (fullTime !== null) return fullTime;

  const regularTime = safeScore(match?.score?.regularTime?.[side]);
  if (regularTime !== null) return regularTime;

  const halfTime = safeScore(match?.score?.halfTime?.[side]);
  if (halfTime !== null) return halfTime;

  return null;
}

function pickMatchMinute(match: any): number | null {
  const direct = safeInt(match?.minute);
  if (direct !== null && direct >= 0) return direct;

  const statusMinute = safeInt(match?.status?.minute);
  if (statusMinute !== null && statusMinute >= 0) return statusMinute;

  return null;
}

function pickInjuryTime(match: any): number | null {
  const direct = safeInt(match?.injuryTime);
  if (direct !== null && direct >= 0) return direct;

  const statusInjuryTime = safeInt(match?.status?.injuryTime);
  if (statusInjuryTime !== null && statusInjuryTime >= 0) {
    return statusInjuryTime;
  }

  return null;
}

function normalizeStatus(status: string | null | undefined) {
  const s = String(status ?? "").toUpperCase();

  if (s === "LIVE") return "IN_PLAY";
  if (s === "IN_PLAY") return "IN_PLAY";
  if (s === "PAUSED") return "PAUSED";
  if (s === "FINISHED") return "FINISHED";
  if (s === "CANCELED") return "CANCELED";
  if (s === "CANCELLED") return "CANCELLED";
  if (s === "POSTPONED") return "POSTPONED";
  if (s === "SUSPENDED") return "SUSPENDED";
  if (s === "AWARDED") return "AWARDED";
  if (s === "TIMED") return "TIMED";
  if (s === "SCHEDULED") return "SCHEDULED";

  return s || "SCHEDULED";
}

function isLiveStatus(status: string | null | undefined) {
  const s = normalizeStatus(status);
  return s === "IN_PLAY" || s === "PAUSED" || s === "LIVE";
}

function isFinishedStatus(status: string | null | undefined) {
  return normalizeStatus(status) === "FINISHED";
}

function isTerminalStatus(status: string | null | undefined) {
  const s = normalizeStatus(status);

  return (
    s === "FINISHED" ||
    s === "CANCELED" ||
    s === "CANCELLED" ||
    s === "POSTPONED" ||
    s === "SUSPENDED" ||
    s === "AWARDED"
  );
}

async function fetchFD(url: string, apiKey: string) {
  const r = await fetch(url, {
    headers: { "X-Auth-Token": apiKey },
    cache: "no-store",
  });

  const text = await r.text();

  return {
    ok: r.ok,
    status: r.status,
    data: safeJson(text),
  };
}

function isoStartOfUtcDay(dateYYYYMMDD: string) {
  return new Date(`${dateYYYYMMDD}T00:00:00.000Z`).toISOString();
}

function isoStartOfNextUtcDay(dateYYYYMMDD: string) {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);

  return dt.toISOString().slice(0, 10) + "T00:00:00.000Z";
}

type DbMatchRow = {
  id: number;
  utc_date: string;
  status: string | null;
  matchday: number | null;
  season: string | null;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  minute: number | null;
  injury_time: number | null;
  competition_id: string;
  competition_name: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
  last_sync_at: string | null;
};

function shouldRefreshMatchDetails(row: DbMatchRow, nowMs: number) {
  if (isTerminalStatus(row.status)) return false;

  const kickoffMs = Date.parse(row.utc_date);
  if (!Number.isFinite(kickoffMs)) return false;

  const statusIsLive = isLiveStatus(row.status);
  const startsSoonOrStarted = nowMs >= kickoffMs - 2 * 60 * 1000;
  const stillRelevant = nowMs <= kickoffMs + 4 * 60 * 60 * 1000;

  if (!statusIsLive && !(startsSoonOrStarted && stillRelevant)) {
    return false;
  }

  const lastSyncMs = row.last_sync_at ? Date.parse(row.last_sync_at) : NaN;
  if (!Number.isFinite(lastSyncMs)) return true;

  const ageMs = nowMs - lastSyncMs;
  const ttl = statusIsLive
    ? LIVE_DETAIL_REFRESH_TTL_MS
    : PRESTART_DETAIL_REFRESH_TTL_MS;

  return ageMs >= ttl;
}

export async function GET(req: Request) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey) return jsonError("Missing FOOTBALL_DATA_API_KEY in env", 500);
  if (!supabaseUrl) return jsonError("Missing SUPABASE_URL in env", 500);
  if (!serviceKey) {
    return jsonError("Missing SUPABASE_SERVICE_ROLE_KEY in env", 500);
  }

  const apiKeySafe: string = apiKey;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonError("Invalid date. Use YYYY-MM-DD", 400);
  }

  const HORIZON_DAYS = 14;
  const horizonToYmd = addDaysLocal(todayLocalYYYYMMDD(), HORIZON_DAYS);
  const isBeyondHorizon = date > horizonToYmd;

  if (isBeyondHorizon) {
    return NextResponse.json({
      date,
      dateFrom: null,
      dateTo: null,
      horizonDays: HORIZON_DAYS,
      horizonTo: horizonToYmd,
      isBeyondHorizon: true,
      results: [],
      errors: [],
    });
  }

  const dateFrom = addDaysLocal(date, -1);
  const dateTo = addDaysLocal(date, +1);

  const rangeStart = isoStartOfUtcDay(dateFrom);
  const rangeEnd = isoStartOfNextUtcDay(dateTo);

  const readCache = async (key: string) => {
    const { data, error } = await supabase
      .from("api_cache")
      .select("payload,updated_at")
      .eq("key", key)
      .maybeSingle();

    if (error || !data?.updated_at) return null;

    const age = Date.now() - new Date(data.updated_at).getTime();

    return {
      age,
      payload: data.payload as any,
    };
  };

  const writeCache = async (key: string, payload: any) => {
    await supabase.from("api_cache").upsert({
      key,
      payload,
      updated_at: new Date().toISOString(),
    });
  };

  async function readAllMatchesFromDb() {
    const { data, error } = await supabase
      .from("matches")
      .select(
        "id, utc_date, status, matchday, season, home_team, away_team, home_score, away_score, minute, injury_time, competition_id, competition_name, home_team_id, away_team_id, last_sync_at"
      )
      .in(
        "competition_id",
        LEAGUES.map((l) => l.code)
      )
      .gte("utc_date", rangeStart)
      .lt("utc_date", rangeEnd)
      .order("utc_date", { ascending: true });

    if (error) {
      throw new Error(`DB matches read error: ${error.message}`);
    }

    return (data ?? []) as DbMatchRow[];
  }

  async function readOddsMapFromDb(matchIds: number[]) {
    const safeIds = Array.from(
      new Set(matchIds.filter((x) => Number.isFinite(x)))
    );

    const oddsMap = new Map<
      number,
      { "1": number | null; X: number | null; "2": number | null }
    >();

    if (!safeIds.length) return oddsMap;

    const { data, error } = await supabase
      .from("odds")
      .select("match_id, market_id, selection, book_odds")
      .in("match_id", safeIds)
      .eq("market_id", MARKET_ID_1X2);

    if (error) {
      throw new Error(`DB odds read error: ${error.message}`);
    }

    for (const row of data ?? []) {
      const matchId = Number((row as any)?.match_id);
      const selection = String((row as any)?.selection ?? "");
      const bookOdds = Number((row as any)?.book_odds);

      if (!Number.isFinite(matchId)) continue;
      if (!Number.isFinite(bookOdds) || bookOdds <= 0) continue;

      const current = oddsMap.get(matchId) ?? {
        "1": null,
        X: null,
        "2": null,
      };

      if (selection === "1") {
        oddsMap.set(matchId, { ...current, "1": bookOdds });
      } else if (selection === "X") {
        oddsMap.set(matchId, { ...current, X: bookOdds });
      } else if (selection === "2") {
        oddsMap.set(matchId, { ...current, "2": bookOdds });
      }
    }

    return oddsMap;
  }

  async function fetchAndUpsertMatches(leagueCode: string, leagueName: string) {
    const fxUrl = new URL(`${BASE}/competitions/${leagueCode}/matches`);
    fxUrl.searchParams.set("dateFrom", dateFrom);
    fxUrl.searchParams.set("dateTo", dateTo);

    const fx = await fetchFD(fxUrl.toString(), apiKeySafe);

    if (!fx.ok) {
      return { ok: false, status: fx.status, data: fx.data };
    }

    const list = Array.isArray((fx.data as any)?.matches)
      ? (fx.data as any).matches
      : [];

    const nowIso = new Date().toISOString();

    const rows = list
      .map((m: any) => {
        const id = Number(m?.id);
        if (!Number.isFinite(id)) return null;

        const utc = m?.utcDate ? new Date(String(m.utcDate)).toISOString() : null;
        if (!utc) return null;

        const status = normalizeStatus(m?.status);
        const matchday = Number.isFinite(Number(m?.matchday))
          ? Number(m.matchday)
          : null;

        const season = m?.season?.startDate
          ? String(m.season.startDate).slice(0, 4)
          : null;

        const home = m?.homeTeam?.name ? String(m.homeTeam.name) : "Home";
        const away = m?.awayTeam?.name ? String(m.awayTeam.name) : "Away";

        const homeTeamId = Number.isFinite(Number(m?.homeTeam?.id))
          ? Number(m.homeTeam.id)
          : null;
        const awayTeamId = Number.isFinite(Number(m?.awayTeam?.id))
          ? Number(m.awayTeam.id)
          : null;

        const hs = pickMatchScore(m, "home");
        const as = pickMatchScore(m, "away");
        const minute = isLiveStatus(status) ? pickMatchMinute(m) : null;
        const injuryTime = isLiveStatus(status) ? pickInjuryTime(m) : null;

        const row: Record<string, any> = {
          id,
          competition_id: String(leagueCode),
          competition_name: String(leagueName),
          utc_date: utc ?? nowIso,
          status,
          matchday,
          season,
          home_team: home,
          away_team: away,
          home_team_id: homeTeamId,
          away_team_id: awayTeamId,
          minute,
          injury_time: injuryTime,
          last_sync_at: nowIso,
        };

        if (hs !== null) {
          row.home_score = hs;
        } else if (status === "SCHEDULED" || status === "TIMED") {
          row.home_score = null;
        }

        if (as !== null) {
          row.away_score = as;
        } else if (status === "SCHEDULED" || status === "TIMED") {
          row.away_score = null;
        }

        return row;
      })
      .filter(Boolean) as any[];

    if (rows.length) {
      const { error } = await supabase
        .from("matches")
        .upsert(rows, { onConflict: "id" });

      if (error) {
        return { ok: false, status: 500, data: { error: error.message } };
      }
    }

    return { ok: true, status: 200, data: fx.data };
  }

  async function refreshMatchDetailsFromFootballData(matchRows: DbMatchRow[]) {
    const nowMs = Date.now();
    const candidates = matchRows
      .filter((row) => shouldRefreshMatchDetails(row, nowMs))
      .sort((a, b) => {
        const aLive = isLiveStatus(a.status) ? 0 : 1;
        const bLive = isLiveStatus(b.status) ? 0 : 1;
        if (aLive !== bLive) return aLive - bLive;

        return Date.parse(a.utc_date) - Date.parse(b.utc_date);
      })
      .slice(0, LIVE_DETAIL_BATCH_LIMIT);

    const refreshed: number[] = [];
    const detailErrors: any[] = [];

    for (const row of candidates) {
      const detailUrl = `${BASE}/matches/${encodeURIComponent(String(row.id))}`;
      const detail = await fetchFD(detailUrl, apiKeySafe);

      if (!detail.ok) {
        detailErrors.push({
          type: "match_detail_fetch",
          matchId: row.id,
          status: detail.status,
          data: detail.data,
        });
        continue;
      }

      const upstreamMatch =
        (detail.data as any)?.match && typeof (detail.data as any).match === "object"
          ? (detail.data as any).match
          : detail.data;

      if (!upstreamMatch || typeof upstreamMatch !== "object") {
        detailErrors.push({
          type: "match_detail_shape",
          matchId: row.id,
          data: detail.data,
        });
        continue;
      }

      const status = normalizeStatus((upstreamMatch as any)?.status);

      if (isTerminalStatus(status)) {
        const { error } = await supabase
          .from("matches")
          .update({
            last_sync_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        if (error) {
          detailErrors.push({
            type: "match_detail_terminal_touch",
            matchId: row.id,
            error: error.message,
          });
          continue;
        }

        refreshed.push(row.id);
        continue;
      }

      const hs = pickMatchScore(upstreamMatch, "home");
      const as = pickMatchScore(upstreamMatch, "away");
      const isLive = isLiveStatus(status);

      const updatePayload: Record<string, any> = {
        status,
        minute: isLive ? pickMatchMinute(upstreamMatch) : null,
        injury_time: isLive ? pickInjuryTime(upstreamMatch) : null,
        last_sync_at: new Date().toISOString(),
      };

      if (hs !== null) {
        updatePayload.home_score = hs;
      } else if (status === "SCHEDULED" || status === "TIMED") {
        updatePayload.home_score = null;
      }

      if (as !== null) {
        updatePayload.away_score = as;
      } else if (status === "SCHEDULED" || status === "TIMED") {
        updatePayload.away_score = null;
      }

      const { error } = await supabase
        .from("matches")
        .update(updatePayload)
        .eq("id", row.id);

      if (error) {
        detailErrors.push({
          type: "match_detail_update",
          matchId: row.id,
          error: error.message,
        });
        continue;
      }

      refreshed.push(row.id);
    }

    return {
      refreshed,
      errors: detailErrors,
    };
  }

  const results: any[] = [];
  const errors: any[] = [];

  let allDbMatches: DbMatchRow[] = [];

  try {
    allDbMatches = await readAllMatchesFromDb();
  } catch (e: any) {
    errors.push({
      type: "db_matches_read",
      error: e?.message ?? String(e),
    });
    allDbMatches = [];
  }

  const matchesByLeague = new Map<string, DbMatchRow[]>();

  for (const lg of LEAGUES) {
    matchesByLeague.set(lg.code, []);
  }

  for (const m of allDbMatches) {
    const arr = matchesByLeague.get(m.competition_id) ?? [];
    arr.push(m);
    matchesByLeague.set(m.competition_id, arr);
  }

  for (const lg of LEAGUES) {
    const fxRefreshKey = `fx_refresh:${lg.code}:${dateFrom}:${dateTo}`;

    const fxHit = await readCache(fxRefreshKey);

    if (fxHit && fxHit.age < FIXTURES_REFRESH_TTL_MS) {
      continue;
    }

    const fx = await fetchAndUpsertMatches(lg.code, lg.name);
    
    await writeCache(fxRefreshKey, { refreshedAt: new Date().toISOString() });

    if (!fx.ok) {
      errors.push({
        type: "fixtures_fetch",
        league: lg.code,
        status: fx.status,
        data: fx.data,
      });
    }
  }

  try {
    allDbMatches = await readAllMatchesFromDb();
  } catch (e: any) {
    errors.push({
      type: "db_matches_read_after_upsert",
      error: e?.message ?? String(e),
    });
    allDbMatches = [];
  }

  const liveRefresh = await refreshMatchDetailsFromFootballData(allDbMatches);

  if (liveRefresh.errors.length > 0) {
    errors.push(...liveRefresh.errors);
  }

  if (liveRefresh.refreshed.length > 0) {
    try {
      allDbMatches = await readAllMatchesFromDb();
    } catch (e: any) {
      errors.push({
        type: "db_matches_read_after_live_refresh",
        error: e?.message ?? String(e),
      });
      allDbMatches = [];
    }
  }

  const finalMatchesByLeague = new Map<string, DbMatchRow[]>();

  for (const lg of LEAGUES) {
    finalMatchesByLeague.set(lg.code, []);
  }

  for (const m of allDbMatches) {
    const arr = finalMatchesByLeague.get(m.competition_id) ?? [];
    arr.push(m);
    finalMatchesByLeague.set(m.competition_id, arr);
  }

  let oddsMap = new Map<
    number,
    { "1": number | null; X: number | null; "2": number | null }
  >();

  try {
    const allMatchIds = allDbMatches
      .map((m) => Number(m.id))
      .filter((x) => Number.isFinite(x));

    oddsMap = await readOddsMapFromDb(allMatchIds);
  } catch (e: any) {
    errors.push({
      type: "db_odds_read",
      error: e?.message ?? String(e),
    });
  }

  for (const lg of LEAGUES) {
    const leagueMatches = finalMatchesByLeague.get(lg.code) ?? [];

    const fixtures = {
      competition: { name: lg.name, code: lg.code },
      matches: leagueMatches.map((m) => {
        const status = normalizeStatus(m.status);
        const isLive = isLiveStatus(status);
        const isFinished = isFinishedStatus(status);

        const odds = oddsMap.get(Number(m.id)) ?? {
          "1": null,
          X: null,
          "2": null,
        };

        return {
          id: m.id,
          utcDate: m.utc_date,
          status,
          live: {
            isLive,
            isFinished,
          },
          minute: isLive ? m.minute : null,
          injuryTime: isLive ? m.injury_time : null,
          matchday: m.matchday,
          season: m.season ? { startDate: `${m.season}-01-01` } : null,
          homeTeam: { id: m.home_team_id ?? null, name: m.home_team },
          awayTeam: { id: m.away_team_id ?? null, name: m.away_team },
          score: {
            fullTime: { home: m.home_score, away: m.away_score },
          },
          odds,
        };
      }),
    };

    results.push({ league: lg, fixtures });
  }

  return NextResponse.json({
    date,
    dateFrom,
    dateTo,
    horizonDays: HORIZON_DAYS,
    horizonTo: horizonToYmd,
    isBeyondHorizon: false,
    liveDetailsRefreshed: liveRefresh.refreshed,
    results,
    errors,
  });
}