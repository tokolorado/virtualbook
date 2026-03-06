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

async function fetchFD(url: string, apiKey: string) {
  const r = await fetch(url, {
    headers: { "X-Auth-Token": apiKey },
    cache: "no-store",
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, data: safeJson(text) };
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
  competition_id: string;
  competition_name: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
  last_sync_at: string | null;
};

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

  const FIXTURES_REFRESH_TTL_MS = 15 * 60 * 1000;

  // okno 3 dni (UTC safety), UI i tak filtruje na selectedDate
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
    return { age, payload: data.payload as any };
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
        "id, utc_date, status, matchday, season, home_team, away_team, home_score, away_score, competition_id, competition_name, home_team_id, away_team_id, last_sync_at"
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

        const statusRaw = m?.status ? String(m.status) : "SCHEDULED";
        const status = statusRaw.toUpperCase();

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

        const isFinal = status === "FINISHED";

        const hs =
          isFinal && Number.isFinite(Number(m?.score?.fullTime?.home))
            ? Number(m.score.fullTime.home)
            : null;

        const as =
          isFinal && Number.isFinite(Number(m?.score?.fullTime?.away))
            ? Number(m.score.fullTime.away)
            : null;

        return {
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
          home_score: hs,
          away_score: as,
          last_sync_at: nowIso,
        };
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

  const results: any[] = [];
  const errors: any[] = [];

  // 1) Jedno zbiorcze czytanie z DB
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

  // 2) Refresh tylko dla lig, które nie mają żadnych meczów w DB
  for (const lg of LEAGUES) {
    const leagueMatches = matchesByLeague.get(lg.code) ?? [];
    const needsRefresh = leagueMatches.length === 0;

    if (!needsRefresh) continue;

    const fxRefreshKey = `fx_refresh:${lg.code}:${dateFrom}:${dateTo}`;
    let canRefresh = true;

    const fxHit = await readCache(fxRefreshKey);
    if (fxHit && fxHit.age < FIXTURES_REFRESH_TTL_MS) {
      canRefresh = false;
    }

    if (!canRefresh) continue;

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

  // 3) Drugie, końcowe czytanie z DB po ewentualnych refreshach
  try {
    allDbMatches = await readAllMatchesFromDb();
  } catch (e: any) {
    errors.push({
      type: "db_matches_read_after_upsert",
      error: e?.message ?? String(e),
    });
    allDbMatches = [];
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

  // 4) Jedno zbiorcze czytanie odds
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

  // 5) Składanie odpowiedzi bez standings
  for (const lg of LEAGUES) {
    const leagueMatches = finalMatchesByLeague.get(lg.code) ?? [];

    const fixtures = {
      competition: { name: lg.name, code: lg.code },
      matches: leagueMatches.map((m) => {
        const odds = oddsMap.get(Number(m.id)) ?? {
          "1": null,
          X: null,
          "2": null,
        };

        return {
          id: m.id,
          utcDate: m.utc_date,
          status: m.status,
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
    results,
    errors,
  });
}