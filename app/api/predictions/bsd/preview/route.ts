//app/api/predictions/bsd/preview/route.ts
import { NextResponse } from "next/server";
import { addDaysLocal, todayLocalYYYYMMDD } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BSD_BASE = "https://sports.bzzoiro.com/api";
const HORIZON_DAYS = 14;
const DEFAULT_TZ = "Europe/Warsaw";
const MAX_PAGES = 3;

type BsdPredictionNormalized = {
  source: "bsd";
  sourcePredictionId: number | null;
  sourceEventId: number | null;
  sourceDate: string;
  eventDate: string | null;

  league: {
    id: number | null;
    name: string | null;
    country: string | null;
  };

  homeTeam: {
    id: number | null;
    name: string;
  };

  awayTeam: {
    id: number | null;
    name: string;
  };

  predictedResult: "H" | "D" | "A" | null;
  predictedLabel: "home" | "draw" | "away" | null;

  mostLikelyScore: string | null;
  predictedHomeScore: number | null;
  predictedAwayScore: number | null;

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

  raw: any;
};

function jsonError(message: string, status = 500, extra?: Record<string, any>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

function isValidDateYmd(value: string | null) {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeInt(value: unknown): number | null {
  const n = safeNumber(value);
  if (n === null) return null;

  return Math.trunc(n);
}

function safeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const s = String(value).trim();
  return s ? s : null;
}

function normalizePredictedLabel(value: unknown) {
  const s = safeString(value)?.toUpperCase() ?? null;

  if (s === "H") return "home";
  if (s === "D") return "draw";
  if (s === "A") return "away";

  return null;
}

function parseMostLikelyScore(value: unknown) {
  const s = safeString(value);
  if (!s) {
    return {
      score: null,
      home: null,
      away: null,
    };
  }

  const m = s.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);

  if (!m) {
    return {
      score: s,
      home: null,
      away: null,
    };
  }

  const home = Number(m[1]);
  const away = Number(m[2]);

  return {
    score: `${home}-${away}`,
    home: Number.isFinite(home) ? home : null,
    away: Number.isFinite(away) ? away : null,
  };
}

function pickTeamId(event: any, side: "home" | "away") {
  const obj = side === "home" ? event?.home_team_obj : event?.away_team_obj;

  return (
    safeInt(obj?.id) ??
    safeInt(side === "home" ? event?.home_team_id : event?.away_team_id)
  );
}

function normalizeBsdPrediction(row: any, sourceDate: string): BsdPredictionNormalized {
  const event = row?.event ?? {};
  const league = event?.league ?? {};
  const score = parseMostLikelyScore(row?.most_likely_score);
  const predictedResultRaw = safeString(row?.predicted_result)?.toUpperCase() ?? null;

  const predictedResult =
    predictedResultRaw === "H" || predictedResultRaw === "D" || predictedResultRaw === "A"
      ? predictedResultRaw
      : null;

  return {
    source: "bsd",
    sourcePredictionId: safeInt(row?.id),
    sourceEventId: safeInt(event?.id),
    sourceDate,
    eventDate: safeString(event?.event_date),

    league: {
      id: safeInt(league?.id),
      name: safeString(league?.name),
      country: safeString(league?.country),
    },

    homeTeam: {
      id: pickTeamId(event, "home"),
      name: safeString(event?.home_team) ?? "Home",
    },

    awayTeam: {
      id: pickTeamId(event, "away"),
      name: safeString(event?.away_team) ?? "Away",
    },

    predictedResult,
    predictedLabel: normalizePredictedLabel(row?.predicted_result),

    mostLikelyScore: score.score,
    predictedHomeScore: score.home,
    predictedAwayScore: score.away,

    expectedHomeGoals: safeNumber(row?.expected_home_goals),
    expectedAwayGoals: safeNumber(row?.expected_away_goals),

    probabilities: {
      homeWin: safeNumber(row?.prob_home_win),
      draw: safeNumber(row?.prob_draw),
      awayWin: safeNumber(row?.prob_away_win),
      over15: safeNumber(row?.prob_over_15),
      over25: safeNumber(row?.prob_over_25),
      over35: safeNumber(row?.prob_over_35),
      bttsYes: safeNumber(row?.prob_btts_yes),
    },

    confidence: safeNumber(row?.confidence),
    modelVersion: safeString(row?.model_version),

    raw: row,
  };
}

async function fetchBsdJson(url: string, apiKey: string) {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Authorization: `Token ${apiKey}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();

  let data: any = null;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

function buildBsdPredictionsUrl(args: {
  date: string;
  leagueId: string | null;
  page: number;
}) {
  const url = new URL(`${BSD_BASE}/predictions/`);

  url.searchParams.set("date_from", args.date);
  url.searchParams.set("date_to", args.date);
  url.searchParams.set("tz", DEFAULT_TZ);
  url.searchParams.set("page", String(args.page));

  if (args.leagueId && /^\d+$/.test(args.leagueId)) {
    url.searchParams.set("league", args.leagueId);
  }

  return url.toString();
}

export async function GET(req: Request) {
  const apiKey = process.env.BSD_API_KEY;

  if (!apiKey) {
    return jsonError("Missing BSD_API_KEY in env", 500);
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const leagueId = searchParams.get("leagueId");
  const debug = searchParams.get("debug") === "1";

  if (!isValidDateYmd(date)) {
    return jsonError("Invalid date. Use YYYY-MM-DD", 400);
  }

  const safeDate = date as string;
  const today = todayLocalYYYYMMDD();
  const horizonTo = addDaysLocal(today, HORIZON_DAYS);

  if (safeDate < today) {
    return NextResponse.json({
      date: safeDate,
      source: "bsd",
      supported: false,
      reason: "BSD preview endpoint is configured for today and future dates only.",
      results: [],
    });
  }

  if (safeDate > horizonTo) {
    return NextResponse.json({
      date: safeDate,
      source: "bsd",
      supported: false,
      horizonDays: HORIZON_DAYS,
      horizonTo,
      reason: "Date is beyond prediction preview horizon.",
      results: [],
    });
  }

  const fetchedAt = new Date().toISOString();
  const allRows: any[] = [];
  const pageSummaries: any[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const sourceUrl = buildBsdPredictionsUrl({
      date: safeDate,
      leagueId,
      page,
    });

    const upstream = await fetchBsdJson(sourceUrl, apiKey);

    pageSummaries.push({
      page,
      sourceUrl,
      status: upstream.status,
      ok: upstream.ok,
      count: upstream.data?.count ?? null,
      resultsCount: Array.isArray(upstream.data?.results)
        ? upstream.data.results.length
        : null,
      hasNext: !!upstream.data?.next,
    });

    if (!upstream.ok) {
      return jsonError("BSD fetch failed", 502, {
        date: safeDate,
        sourceUrl,
        upstreamStatus: upstream.status,
        upstreamBody: debug ? upstream.data : undefined,
        pages: pageSummaries,
      });
    }

    const rows = Array.isArray(upstream.data?.results)
      ? upstream.data.results
      : [];

    allRows.push(...rows);

    if (!upstream.data?.next) {
      break;
    }
  }

  const normalized = allRows.map((row) => normalizeBsdPrediction(row, safeDate));

  return NextResponse.json({
    date: safeDate,
    source: "bsd",
    fetchedAt,
    timezone: DEFAULT_TZ,
    leagueId: leagueId ?? null,
    count: normalized.length,
    results: normalized,
    meta: {
      pages: pageSummaries,
      maxPages: MAX_PAGES,
    },
  });
}