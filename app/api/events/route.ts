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
const LIVE_DETAIL_REFRESH_TTL_MS = 15 * 1000;
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

function cleanString(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function isPlaceholderTeamName(value: unknown, side?: "home" | "away") {
  const s = cleanString(value).toLowerCase();

  if (!s) return true;

  if (s === "tbd") return true;
  if (s === "to be decided") return true;
  if (s === "unknown") return true;
  if (s === "n/a") return true;

  if (side === "home" && s === "home") return true;
  if (side === "away" && s === "away") return true;

  return false;
}

function safeTeamId(value: unknown): number | null {
  const n = safeInt(value);
  if (n === null) return null;

  // Football-Data czasem zwraca id: 0 dla placeholderów Home/Away.
  if (n <= 0) return null;

  return n;
}

function pickTeamName(args: {
  upstreamName: unknown;
  existingName: unknown;
  fallback: string;
  side: "home" | "away";
}) {
  const upstream = cleanString(args.upstreamName);
  const existing = cleanString(args.existingName);

  if (!isPlaceholderTeamName(upstream, args.side)) return upstream;
  if (!isPlaceholderTeamName(existing, args.side)) return existing;

  return args.fallback;
}

function pickTeamId(args: {
  upstreamId: unknown;
  existingId: unknown;
}) {
  const upstream = safeTeamId(args.upstreamId);
  if (upstream !== null) return upstream;

  const existing = safeTeamId(args.existingId);
  if (existing !== null) return existing;

  return null;
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

function canPersistScore(status: string | null | undefined) {
  return isFinishedStatus(status);
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
  home_team: string | null;
  away_team: string | null;
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

type ExistingTeamRow = {
  id: number;
  home_team: string | null;
  away_team: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
};

type DisplayScore = {
  home: number | null;
  away: number | null;
  status: string;
  source: string;
  updatedAt: string;
};

type PredictionDisplay = {
  source: string;
  market: string;
  predictedScore: string | null;
  predictedHomeScore: number | null;
  predictedAwayScore: number | null;
  predictedResult: string | null;
  predictedLabel: string | null;
  expectedHomeGoals: number | null;
  expectedAwayGoals: number | null;
  probabilities: {
    homeWin: number | null;
    draw: number | null;
    awayWin: number | null;
    over15: number | null;
    over25: number | null;
    over35: number | null;
    bttsYes: number | null;
  };
  confidence: number | null;
  modelVersion: string | null;
  matchConfidence: string | null;
  matchScore: number | null;
  sourcePredictionId: string | null;
  sourceEventId: string | null;
  updatedAt: string | null;
};

function hasAnyScore(home: number | null, away: number | null) {
  return home !== null || away !== null;
}

function canExposeDisplayScore(status: string | null | undefined) {
  return isLiveStatus(status) || isFinishedStatus(status);
}

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

  const displayScores = new Map<number, DisplayScore>();

  function rememberDisplayScore(args: {
    matchId: number;
    status: string;
    home: number | null;
    away: number | null;
    source: string;
    updatedAt: string;
  }) {
    if (!canExposeDisplayScore(args.status)) return;
    if (!hasAnyScore(args.home, args.away)) return;

    displayScores.set(args.matchId, {
      home: args.home,
      away: args.away,
      status: args.status,
      source: args.source,
      updatedAt: args.updatedAt,
    });
  }

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

  async function readExistingTeamRows(matchIds: number[]) {
    const safeIds = Array.from(
      new Set(matchIds.filter((x) => Number.isFinite(x)))
    );

    const map = new Map<number, ExistingTeamRow>();

    if (!safeIds.length) return map;

    const { data, error } = await supabase
      .from("matches")
      .select("id, home_team, away_team, home_team_id, away_team_id")
      .in("id", safeIds);

    if (error) {
      throw new Error(`DB existing team rows read error: ${error.message}`);
    }

    for (const row of (data ?? []) as ExistingTeamRow[]) {
      const id = Number(row.id);
      if (!Number.isFinite(id)) continue;

      map.set(id, row);
    }

    return map;
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
      .eq("market_id", MARKET_ID_1X2)
      .eq("source", "bsd");

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

  async function readPredictionsMapFromDb(matchIds: number[]) {
    const safeIds = Array.from(
      new Set(matchIds.filter((x) => Number.isFinite(x)))
    );

    const predictionsMap = new Map<number, PredictionDisplay>();

    if (!safeIds.length) return predictionsMap;

    const { data, error } = await supabase
      .from("event_predictions")
      .select(
        "match_id, source, market, predicted_score, predicted_home_score, predicted_away_score, predicted_result, predicted_label, expected_home_goals, expected_away_goals, probability_home_win, probability_draw, probability_away_win, probability_over_15, probability_over_25, probability_over_35, probability_btts_yes, confidence, model_version, match_confidence, match_score, source_prediction_id, source_event_id, updated_at"
      )
      .in("match_id", safeIds)
      .eq("source", "bsd")
      .eq("market", "correct_score")
      .order("updated_at", { ascending: false });

    if (error) {
      throw new Error(`DB predictions read error: ${error.message}`);
    }

    for (const row of data ?? []) {
      const matchId = Number((row as any)?.match_id);

      if (!Number.isFinite(matchId)) continue;
      if (predictionsMap.has(matchId)) continue;

      predictionsMap.set(matchId, {
        source: String((row as any)?.source ?? "bsd"),
        market: String((row as any)?.market ?? "correct_score"),

        predictedScore: (row as any)?.predicted_score
          ? String((row as any).predicted_score)
          : null,
        predictedHomeScore: safeInt((row as any)?.predicted_home_score),
        predictedAwayScore: safeInt((row as any)?.predicted_away_score),

        predictedResult: (row as any)?.predicted_result
          ? String((row as any).predicted_result)
          : null,
        predictedLabel: (row as any)?.predicted_label
          ? String((row as any).predicted_label)
          : null,

        expectedHomeGoals: safeScore((row as any)?.expected_home_goals),
        expectedAwayGoals: safeScore((row as any)?.expected_away_goals),

        probabilities: {
          homeWin: safeScore((row as any)?.probability_home_win),
          draw: safeScore((row as any)?.probability_draw),
          awayWin: safeScore((row as any)?.probability_away_win),
          over15: safeScore((row as any)?.probability_over_15),
          over25: safeScore((row as any)?.probability_over_25),
          over35: safeScore((row as any)?.probability_over_35),
          bttsYes: safeScore((row as any)?.probability_btts_yes),
        },

        confidence: safeScore((row as any)?.confidence),
        modelVersion: (row as any)?.model_version
          ? String((row as any).model_version)
          : null,

        matchConfidence: (row as any)?.match_confidence
          ? String((row as any).match_confidence)
          : null,
        matchScore: safeScore((row as any)?.match_score),

        sourcePredictionId: (row as any)?.source_prediction_id
          ? String((row as any).source_prediction_id)
          : null,
        sourceEventId: (row as any)?.source_event_id
          ? String((row as any).source_event_id)
          : null,

        updatedAt: (row as any)?.updated_at
          ? String((row as any).updated_at)
          : null,
      });
    }

    return predictionsMap;
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

    const ids = list
      .map((m: any) => Number(m?.id))
      .filter((id: number) => Number.isFinite(id));

    let existingById = new Map<number, ExistingTeamRow>();

    try {
      existingById = await readExistingTeamRows(ids);
    } catch (e: any) {
      return {
        ok: false,
        status: 500,
        data: {
          error: e?.message ?? String(e),
        },
      };
    }

    const nowIso = new Date().toISOString();

    const rows = list
      .map((m: any) => {
        const id = Number(m?.id);
        if (!Number.isFinite(id)) return null;

        const utc = m?.utcDate ? new Date(String(m.utcDate)).toISOString() : null;
        if (!utc) return null;

        const existing = existingById.get(id) ?? null;

        const status = normalizeStatus(m?.status);
        const matchday = Number.isFinite(Number(m?.matchday))
          ? Number(m.matchday)
          : null;

        const season = m?.season?.startDate
          ? String(m.season.startDate).slice(0, 4)
          : null;

        const home = pickTeamName({
          upstreamName: m?.homeTeam?.name,
          existingName: existing?.home_team,
          fallback: "Home",
          side: "home",
        });

        const away = pickTeamName({
          upstreamName: m?.awayTeam?.name,
          existingName: existing?.away_team,
          fallback: "Away",
          side: "away",
        });

        const homeTeamId = pickTeamId({
          upstreamId: m?.homeTeam?.id,
          existingId: existing?.home_team_id,
        });

        const awayTeamId = pickTeamId({
          upstreamId: m?.awayTeam?.id,
          existingId: existing?.away_team_id,
        });

        const hs = pickMatchScore(m, "home");
        const as = pickMatchScore(m, "away");
        const scoreCanBePersisted = canPersistScore(status);
        const minute = isLiveStatus(status) ? pickMatchMinute(m) : null;
        const injuryTime = isLiveStatus(status) ? pickInjuryTime(m) : null;

        rememberDisplayScore({
          matchId: id,
          status,
          home: hs,
          away: as,
          source: "football-data:league",
          updatedAt: nowIso,
        });

        const row: Record<string, any> = {
          id,
          competition_id: String(leagueCode),
          competition_name: String(leagueName),
          utc_date: utc,
          status,
          matchday,
          season,
          home_team: home,
          away_team: away,
          home_team_id: homeTeamId,
          away_team_id: awayTeamId,
          home_score: scoreCanBePersisted ? hs : null,
          away_score: scoreCanBePersisted ? as : null,
          minute,
          injury_time: injuryTime,
          last_sync_at: nowIso,
        };

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
        (detail.data as any)?.match &&
        typeof (detail.data as any).match === "object"
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
      const scoreCanBePersisted = canPersistScore(status);
      const hs = pickMatchScore(upstreamMatch, "home");
      const as = pickMatchScore(upstreamMatch, "away");
      const isLive = isLiveStatus(status);
      const syncAt = new Date().toISOString();

      rememberDisplayScore({
        matchId: row.id,
        status,
        home: hs,
        away: as,
        source: "football-data:match-detail",
        updatedAt: syncAt,
      });

      if (isTerminalStatus(status)) {
        const { error } = await supabase
          .from("matches")
          .update({
            status,
            home_score: scoreCanBePersisted ? hs : null,
            away_score: scoreCanBePersisted ? as : null,
            minute: null,
            injury_time: null,
            last_sync_at: syncAt,
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

      const updatePayload: Record<string, any> = {
        status,
        home_score: scoreCanBePersisted ? hs : null,
        away_score: scoreCanBePersisted ? as : null,
        minute: isLive ? pickMatchMinute(upstreamMatch) : null,
        injury_time: isLive ? pickInjuryTime(upstreamMatch) : null,
        last_sync_at: syncAt,
      };

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

  let predictionsMap = new Map<number, PredictionDisplay>();

  try {
    const allMatchIds = allDbMatches
      .map((m) => Number(m.id))
      .filter((x) => Number.isFinite(x));

    predictionsMap = await readPredictionsMapFromDb(allMatchIds);
  } catch (e: any) {
    errors.push({
      type: "db_predictions_read",
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
        const displayScore = displayScores.get(Number(m.id)) ?? null;

        const odds = oddsMap.get(Number(m.id)) ?? {
          "1": null,
          X: null,
          "2": null,
        };

        const prediction = predictionsMap.get(Number(m.id)) ?? null;

        const homeName = cleanString(m.home_team) || "Home";
        const awayName = cleanString(m.away_team) || "Away";

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
          homeTeam: {
            id: safeTeamId(m.home_team_id),
            name: homeName,
          },
          awayTeam: {
            id: safeTeamId(m.away_team_id),
            name: awayName,
          },
          score: {
            fullTime: { home: m.home_score, away: m.away_score },
          },
          displayScore,
          odds,
          prediction,
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