//app/api/predictions/bsd/match-preview/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { addDaysLocal, todayLocalYYYYMMDD } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BSD_BASE = "https://sports.bzzoiro.com/api";
const DEFAULT_TZ = "Europe/Warsaw";
const HORIZON_DAYS = 14;
const DEFAULT_MAX_PAGES = 10;

const LEAGUES = [
  { code: "CL", name: "Champions League" },
  { code: "PL", name: "Premier League" },
  { code: "BL1", name: "Bundesliga" },
  { code: "FL1", name: "Ligue 1" },
  { code: "SA", name: "Serie A" },
  { code: "PD", name: "LaLiga" },
  { code: "WC", name: "World Cup" },
];

const LEAGUE_NAME_BY_CODE = new Map(LEAGUES.map((l) => [l.code, l.name]));

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
};

type BsdPrediction = {
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

type MatchCandidate = {
  match: DbMatchRow;
  score: number;
  confidence: "exact" | "strong" | "fuzzy" | "rejected";
  accepted: boolean;
  homeSimilarity: number;
  awaySimilarity: number;
  swappedHomeSimilarity: number;
  swappedAwaySimilarity: number;
  leagueSimilarity: number;
  timeScore: number;
  timeDiffMinutes: number | null;
  reasons: string[];
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

function round4(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 10000) / 10000;
}

function normalizePredictedResult(value: unknown): "H" | "D" | "A" | null {
  const s = safeString(value)?.toUpperCase() ?? null;

  if (s === "H" || s === "D" || s === "A") return s;

  return null;
}

function normalizePredictedLabel(value: unknown): "home" | "draw" | "away" | null {
  const s = normalizePredictedResult(value);

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

function normalizeBsdPrediction(row: any, sourceDate: string): BsdPrediction {
  const event = row?.event ?? {};
  const league = event?.league ?? {};
  const score = parseMostLikelyScore(row?.most_likely_score);

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

    predictedResult: normalizePredictedResult(row?.predicted_result),
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

function isoStartOfUtcDay(dateYYYYMMDD: string) {
  return new Date(`${dateYYYYMMDD}T00:00:00.000Z`).toISOString();
}

function isoStartOfNextUtcDay(dateYYYYMMDD: string) {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));

  dt.setUTCDate(dt.getUTCDate() + 1);

  return dt.toISOString().slice(0, 10) + "T00:00:00.000Z";
}

function localDateYmd(value: string | null | undefined, timezone = DEFAULT_TZ) {
  if (!value) return null;

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;

  if (!y || !m || !d) return null;

  return `${y}-${m}-${d}`;
}

function localTimeHHMM(value: string | null | undefined, timezone = DEFAULT_TZ) {
  if (!value) return null;

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const h = parts.find((p) => p.type === "hour")?.value;
  const m = parts.find((p) => p.type === "minute")?.value;

  if (!h || !m) return null;

  return `${h}:${m}`;
}

function localMinutesOfDay(value: string | null | undefined, timezone = DEFAULT_TZ) {
  if (!value) return null;

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  return (hour % 24) * 60 + minute;
}

function normalizeBase(value: string) {
  return value
    .toLowerCase()
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalTeamName(value: string) {
  let s = normalizeBase(value);

  s = s
    .replace(/\bman utd\b/g, "manchester united")
    .replace(/\bman united\b/g, "manchester united")
    .replace(/\bman city\b/g, "manchester city")
    .replace(/\bpsg\b/g, "paris saint germain")
    .replace(/\bparis sg\b/g, "paris saint germain")
    .replace(/\batl madrid\b/g, "atletico madrid")
    .replace(/\batletico de madrid\b/g, "atletico madrid")
    .replace(/\bclub atletico de madrid\b/g, "atletico madrid")
    .replace(/\binter milano\b/g, "inter milan")
    .replace(/\bfc internazionale milano\b/g, "inter milan")
    .replace(/\binternazionale milano\b/g, "inter milan")
    .replace(/\binternazionale\b/g, "inter")
    .replace(/\bsporting lisbon\b/g, "sporting cp")
    .replace(/\bbayern munchen\b/g, "bayern munich")
    .replace(/\bbayer leverkusen\b/g, "leverkusen")
    .replace(/\bborussia monchengladbach\b/g, "monchengladbach");

  const stopwords = new Set([
    "fc",
    "afc",
    "cf",
    "sc",
    "ac",
    "as",
    "ss",
    "cd",
    "ud",
    "club",
    "football",
    "futbol",
    "calcio",
    "de",
    "the",
  ]);

  const tokens = s.split(" ").filter((token) => token && !stopwords.has(token));

  return tokens.join(" ").trim();
}

function canonicalLeagueName(value: string) {
  let s = normalizeBase(value);

  s = s
    .replace(/\buefa champions league\b/g, "champions league")
    .replace(/\benglish premier league\b/g, "premier league")
    .replace(/\bspanish laliga\b/g, "laliga")
    .replace(/\bla liga\b/g, "laliga")
    .replace(/\bserie a tim\b/g, "serie a")
    .replace(/\bfifa world cup\b/g, "world cup");

  const stopwords = new Set(["uefa", "fifa", "the"]);

  const tokens = s.split(" ").filter((token) => token && !stopwords.has(token));

  return tokens.join(" ").trim();
}

function compact(value: string) {
  return value.replace(/\s+/g, "");
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }

    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}

function tokenJaccard(a: string, b: string) {
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));

  if (!aTokens.size || !bTokens.size) return 0;

  let intersection = 0;

  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }

  const union = new Set([...aTokens, ...bTokens]).size;

  return union > 0 ? intersection / union : 0;
}

function stringSimilarity(aRaw: string, bRaw: string, mode: "team" | "league") {
  const a = mode === "team" ? canonicalTeamName(aRaw) : canonicalLeagueName(aRaw);
  const b = mode === "team" ? canonicalTeamName(bRaw) : canonicalLeagueName(bRaw);

  if (!a || !b) return 0;
  if (a === b) return 1;

  const ac = compact(a);
  const bc = compact(b);

  if (ac === bc) return 1;

  if (ac.length >= 5 && bc.length >= 5) {
    if (ac.includes(bc) || bc.includes(ac)) return 0.92;
  }

  const jaccard = tokenJaccard(a, b);
  const maxLen = Math.max(ac.length, bc.length);
  const editSimilarity =
    maxLen > 0 ? 1 - levenshtein(ac, bc) / maxLen : 0;

  return Math.max(0, Math.min(1, Math.max(jaccard, editSimilarity)));
}

function timeScoreFromDiff(diff: number | null) {
  if (diff === null) return 0.2;
  if (diff <= 5) return 1;
  if (diff <= 15) return 0.95;
  if (diff <= 30) return 0.85;
  if (diff <= 60) return 0.7;
  if (diff <= 120) return 0.45;
  if (diff <= 240) return 0.2;

  return 0;
}

function classifyCandidate(args: {
  score: number;
  homeSimilarity: number;
  awaySimilarity: number;
  timeDiffMinutes: number | null;
}) {
  const timeDiff = args.timeDiffMinutes;

  if (
    args.score >= 0.94 &&
    args.homeSimilarity >= 0.92 &&
    args.awaySimilarity >= 0.92 &&
    (timeDiff === null || timeDiff <= 30)
  ) {
    return "exact" as const;
  }

  if (
    args.score >= 0.86 &&
    args.homeSimilarity >= 0.82 &&
    args.awaySimilarity >= 0.82 &&
    (timeDiff === null || timeDiff <= 120)
  ) {
    return "strong" as const;
  }

  if (
    args.score >= 0.78 &&
    args.homeSimilarity >= 0.72 &&
    args.awaySimilarity >= 0.72 &&
    (timeDiff === null || timeDiff <= 240)
  ) {
    return "fuzzy" as const;
  }

  return "rejected" as const;
}

function buildCandidate(prediction: BsdPrediction, match: DbMatchRow): MatchCandidate {
  const homeSimilarity = stringSimilarity(
    prediction.homeTeam.name,
    match.home_team,
    "team"
  );

  const awaySimilarity = stringSimilarity(
    prediction.awayTeam.name,
    match.away_team,
    "team"
  );

  const swappedHomeSimilarity = stringSimilarity(
    prediction.homeTeam.name,
    match.away_team,
    "team"
  );

  const swappedAwaySimilarity = stringSimilarity(
    prediction.awayTeam.name,
    match.home_team,
    "team"
  );

  const dbLeagueName =
    match.competition_name ??
    LEAGUE_NAME_BY_CODE.get(match.competition_id) ??
    match.competition_id;

  const leagueSimilarity = prediction.league.name
    ? stringSimilarity(prediction.league.name, dbLeagueName, "league")
    : 0.2;

  const bsdMinutes = localMinutesOfDay(prediction.eventDate);
  const dbMinutes = localMinutesOfDay(match.utc_date);

  const timeDiffMinutes =
    bsdMinutes === null || dbMinutes === null
      ? null
      : Math.abs(bsdMinutes - dbMinutes);

  const timeScore = timeScoreFromDiff(timeDiffMinutes);

  const score =
    homeSimilarity * 0.38 +
    awaySimilarity * 0.38 +
    timeScore * 0.14 +
    leagueSimilarity * 0.1;

  const confidence = classifyCandidate({
    score,
    homeSimilarity,
    awaySimilarity,
    timeDiffMinutes,
  });

  const reasons: string[] = [];

  if (homeSimilarity < 0.72) {
    reasons.push("home_team_similarity_too_low");
  }

  if (awaySimilarity < 0.72) {
    reasons.push("away_team_similarity_too_low");
  }

  if (timeDiffMinutes !== null && timeDiffMinutes > 240) {
    reasons.push("time_difference_too_large");
  }

  if (leagueSimilarity < 0.45) {
    reasons.push("league_similarity_low");
  }

  const normalSideScore = (homeSimilarity + awaySimilarity) / 2;
  const swappedSideScore = (swappedHomeSimilarity + swappedAwaySimilarity) / 2;

  if (swappedSideScore > normalSideScore + 0.15) {
    reasons.push("possible_home_away_swap");
  }

  if (!reasons.length) {
    reasons.push("candidate_ok");
  }

  return {
    match,
    score,
    confidence,
    accepted: confidence !== "rejected",
    homeSimilarity,
    awaySimilarity,
    swappedHomeSimilarity,
    swappedAwaySimilarity,
    leagueSimilarity,
    timeScore,
    timeDiffMinutes,
    reasons,
  };
}

function predictionKey(prediction: BsdPrediction) {
  if (prediction.sourcePredictionId !== null) {
    return `prediction:${prediction.sourcePredictionId}`;
  }

  return [
    "fallback",
    prediction.sourceDate,
    prediction.league.name ?? "unknown-league",
    prediction.homeTeam.name,
    prediction.awayTeam.name,
    prediction.eventDate ?? "unknown-date",
  ].join(":");
}

function compactMatch(match: DbMatchRow) {
  return {
    id: match.id,
    utcDate: match.utc_date,
    localDate: localDateYmd(match.utc_date),
    localTime: localTimeHHMM(match.utc_date),
    status: match.status,
    competition: {
      id: match.competition_id,
      name: match.competition_name,
    },
    homeTeam: {
      id: match.home_team_id,
      name: match.home_team,
      canonical: canonicalTeamName(match.home_team),
    },
    awayTeam: {
      id: match.away_team_id,
      name: match.away_team,
      canonical: canonicalTeamName(match.away_team),
    },
  };
}

function compactPrediction(prediction: BsdPrediction, debug: boolean) {
  return {
    source: prediction.source,
    sourcePredictionId: prediction.sourcePredictionId,
    sourceEventId: prediction.sourceEventId,
    sourceDate: prediction.sourceDate,
    eventDate: prediction.eventDate,
    localDate: localDateYmd(prediction.eventDate),
    localTime: localTimeHHMM(prediction.eventDate),
    league: prediction.league,
    homeTeam: {
      ...prediction.homeTeam,
      canonical: canonicalTeamName(prediction.homeTeam.name),
    },
    awayTeam: {
      ...prediction.awayTeam,
      canonical: canonicalTeamName(prediction.awayTeam.name),
    },
    predictedResult: prediction.predictedResult,
    predictedLabel: prediction.predictedLabel,
    mostLikelyScore: prediction.mostLikelyScore,
    predictedHomeScore: prediction.predictedHomeScore,
    predictedAwayScore: prediction.predictedAwayScore,
    expectedHomeGoals: prediction.expectedHomeGoals,
    expectedAwayGoals: prediction.expectedAwayGoals,
    probabilities: prediction.probabilities,
    confidence: prediction.confidence,
    modelVersion: prediction.modelVersion,
    raw: debug ? prediction.raw : undefined,
  };
}

function compactCandidate(candidate: MatchCandidate | null) {
  if (!candidate) return null;

  return {
    matchId: candidate.match.id,
    score: round4(candidate.score),
    confidence: candidate.confidence,
    accepted: candidate.accepted,
    homeSimilarity: round4(candidate.homeSimilarity),
    awaySimilarity: round4(candidate.awaySimilarity),
    swappedHomeSimilarity: round4(candidate.swappedHomeSimilarity),
    swappedAwaySimilarity: round4(candidate.swappedAwaySimilarity),
    leagueSimilarity: round4(candidate.leagueSimilarity),
    timeScore: round4(candidate.timeScore),
    timeDiffMinutes: candidate.timeDiffMinutes,
    reasons: candidate.reasons,
    dbMatch: compactMatch(candidate.match),
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

async function fetchBsdPredictions(args: {
  apiKey: string;
  date: string;
  leagueId: string | null;
  maxPages: number;
}) {
  const allRows: any[] = [];
  const pages: any[] = [];

  for (let page = 1; page <= args.maxPages; page += 1) {
    const sourceUrl = buildBsdPredictionsUrl({
      date: args.date,
      leagueId: args.leagueId,
      page,
    });

    const upstream = await fetchBsdJson(sourceUrl, args.apiKey);

    pages.push({
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
      return {
        ok: false,
        status: upstream.status,
        data: upstream.data,
        rows: allRows,
        pages,
      };
    }

    const rows = Array.isArray(upstream.data?.results)
      ? upstream.data.results
      : [];

    allRows.push(...rows);

    if (!upstream.data?.next) break;
  }

  return {
    ok: true,
    status: 200,
    data: null,
    rows: allRows,
    pages,
  };
}

export async function GET(req: Request) {
  const bsdApiKey = process.env.BSD_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!bsdApiKey) return jsonError("Missing BSD_API_KEY in env", 500);
  if (!supabaseUrl) return jsonError("Missing SUPABASE_URL in env", 500);
  if (!serviceKey) {
    return jsonError("Missing SUPABASE_SERVICE_ROLE_KEY in env", 500);
  }

  const { searchParams } = new URL(req.url);

  const date = searchParams.get("date");
  const leagueId = searchParams.get("leagueId");
  const debug = searchParams.get("debug") === "1";

  const requestedPageLimit = Number(searchParams.get("pageLimit"));
  const maxPages =
    Number.isFinite(requestedPageLimit) && requestedPageLimit > 0
      ? Math.min(Math.trunc(requestedPageLimit), 20)
      : DEFAULT_MAX_PAGES;

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
      reason: "BSD match preview is configured for today and future dates only.",
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

  const supabase = createClient(supabaseUrl, serviceKey);

  const dateFrom = addDaysLocal(safeDate, -1);
  const dateTo = addDaysLocal(safeDate, +1);

  const rangeStart = isoStartOfUtcDay(dateFrom);
  const rangeEnd = isoStartOfNextUtcDay(dateTo);

  const { data: dbRows, error: dbError } = await supabase
    .from("matches")
    .select(
      "id, utc_date, status, matchday, season, home_team, away_team, home_score, away_score, competition_id, competition_name, home_team_id, away_team_id"
    )
    .eq("source", "bsd")
    .in(
      "competition_id",
      LEAGUES.map((l) => l.code)
    )
    .gte("utc_date", rangeStart)
    .lt("utc_date", rangeEnd)
    .order("utc_date", { ascending: true });

  if (dbError) {
    return jsonError("DB matches read error", 500, {
      details: dbError.message,
    });
  }

  const dbMatchesRaw = ((dbRows ?? []) as DbMatchRow[]).filter((match) => {
    return localDateYmd(match.utc_date) === safeDate;
  });

  const bsd = await fetchBsdPredictions({
    apiKey: bsdApiKey,
    date: safeDate,
    leagueId,
    maxPages,
  });

  if (!bsd.ok) {
    return jsonError("BSD fetch failed", 502, {
      date: safeDate,
      upstreamStatus: bsd.status,
      upstreamBody: debug ? bsd.data : undefined,
      pages: bsd.pages,
    });
  }

  const bsdPredictions = bsd.rows.map((row) =>
    normalizeBsdPrediction(row, safeDate)
  );

  const attempts = bsdPredictions.map((prediction) => {
    const candidates = dbMatchesRaw
      .map((match) => buildCandidate(prediction, match))
      .sort((a, b) => b.score - a.score);

    return {
      prediction,
      key: predictionKey(prediction),
      best: candidates[0] ?? null,
      candidates,
    };
  });

  const assignedPredictionKeys = new Set<string>();
  const assignedMatchIds = new Set<number>();

  const matched: any[] = [];
  const duplicateRejected: any[] = [];

  const acceptedAttempts = attempts
    .filter((attempt) => attempt.best?.accepted)
    .sort((a, b) => {
      const aScore = a.best?.score ?? 0;
      const bScore = b.best?.score ?? 0;

      return bScore - aScore;
    });

  for (const attempt of acceptedAttempts) {
    const best = attempt.best;
    if (!best) continue;

    if (assignedMatchIds.has(best.match.id)) {
      duplicateRejected.push({
        prediction: compactPrediction(attempt.prediction, debug),
        bestCandidate: compactCandidate(best),
        reason: "match_already_assigned_to_better_prediction",
      });
      continue;
    }

    assignedPredictionKeys.add(attempt.key);
    assignedMatchIds.add(best.match.id);

    matched.push({
      match: compactMatch(best.match),
      prediction: compactPrediction(attempt.prediction, debug),
      matching: {
        score: round4(best.score),
        confidence: best.confidence,
        homeSimilarity: round4(best.homeSimilarity),
        awaySimilarity: round4(best.awaySimilarity),
        swappedHomeSimilarity: round4(best.swappedHomeSimilarity),
        swappedAwaySimilarity: round4(best.swappedAwaySimilarity),
        leagueSimilarity: round4(best.leagueSimilarity),
        timeScore: round4(best.timeScore),
        timeDiffMinutes: best.timeDiffMinutes,
        reasons: best.reasons,
      },
      candidates: debug
        ? attempt.candidates.slice(0, 5).map(compactCandidate)
        : undefined,
    });
  }

  const unmatchedBsd = attempts
    .filter((attempt) => !assignedPredictionKeys.has(attempt.key))
    .map((attempt) => {
      const duplicate = duplicateRejected.find((x) => {
        return (
          x.prediction?.sourcePredictionId ===
          attempt.prediction.sourcePredictionId
        );
      });

      return {
        prediction: compactPrediction(attempt.prediction, debug),
        reason:
          duplicate?.reason ??
          (attempt.best
            ? "best_candidate_below_acceptance_threshold"
            : "no_db_matches_for_date"),
        bestCandidate: compactCandidate(attempt.best),
        candidates: debug
          ? attempt.candidates.slice(0, 5).map(compactCandidate)
          : undefined,
      };
    });

  const unmatchedMatches = dbMatchesRaw
    .filter((match) => !assignedMatchIds.has(match.id))
    .map((match) => {
      const possiblePredictions = attempts
        .map((attempt) => {
          const candidate = attempt.candidates.find(
            (c) => c.match.id === match.id
          );

          if (!candidate) return null;

          return {
            prediction: compactPrediction(attempt.prediction, false),
            candidate: compactCandidate(candidate),
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => {
          const aScore = a?.candidate?.score ?? 0;
          const bScore = b?.candidate?.score ?? 0;

          return bScore - aScore;
        })
        .slice(0, debug ? 5 : 1);

      return {
        match: compactMatch(match),
        bestPredictionCandidates: possiblePredictions,
      };
    });

  return NextResponse.json({
    date: safeDate,
    source: "bsd",
    fetchedAt: new Date().toISOString(),
    timezone: DEFAULT_TZ,
    leagueId: leagueId ?? null,
    db: {
      rangeStart,
      rangeEnd,
      rawMatchesInRangeCount: (dbRows ?? []).length,
      matchesForLocalDateCount: dbMatchesRaw.length,
      competitions: LEAGUES,
    },
    bsd: {
      predictionsCount: bsdPredictions.length,
      pages: bsd.pages,
    },
    summary: {
      matchedCount: matched.length,
      unmatchedBsdCount: unmatchedBsd.length,
      unmatchedMatchesCount: unmatchedMatches.length,
    },
    matched,
    unmatchedBsd,
    unmatchedMatches,
    meta: {
      debug,
      maxPages,
      note:
        "This endpoint is read-only. It does not write event_predictions and does not modify matches.",
    },
  });
}