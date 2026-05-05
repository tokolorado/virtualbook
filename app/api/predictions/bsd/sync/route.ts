import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { addDaysLocal, todayLocalYYYYMMDD } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BSD_BASE = "https://sports.bzzoiro.com/api";
const DEFAULT_TZ = "Europe/Warsaw";
const HORIZON_DAYS = 14;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_REFRESH_STALE_HOURS = 24;
const MARKET = "correct_score";
const DISPLAYABLE_BSD_PRICING_METHOD = "bsd_market_normalized";

const LEAGUES = [
  { code: "CL", name: "Champions League" },
  { code: "UEL", name: "Europa League" },
  { code: "PL", name: "Premier League" },
  { code: "CH", name: "Championship" },
  { code: "BL1", name: "Bundesliga" },
  { code: "FL1", name: "Ligue 1" },
  { code: "SA", name: "Serie A" },
  { code: "CI", name: "Coppa Italia" },
  { code: "PD", name: "LaLiga" },
  { code: "EK", name: "Ekstraklasa" },
  { code: "POR1", name: "Liga Portugal" },
  { code: "NED1", name: "Eredivisie" },
  { code: "MLS", name: "Major League Soccer" },
  { code: "SPL", name: "Saudi Pro League" },
  { code: "TUR1", name: "Super Lig" },
  { code: "WC", name: "World Cup" },
];

const LEAGUE_NAME_BY_CODE = new Map(LEAGUES.map((l) => [l.code, l.name]));

type SupabaseServiceClient = {
  from: (table: string) => any;
};

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

type OddsAvailabilityRow = {
  match_id: number | string;
};

type ExistingPredictionRow = {
  match_id: number | string;
  source_prediction_id: string | null;
  updated_at: string | null;
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

function requireSecret(req: Request) {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return jsonError("Missing CRON_SECRET in env", 500);
  }

  const { searchParams } = new URL(req.url);

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();

  const provided =
    req.headers.get("x-cron-secret") ??
    searchParams.get("secret") ??
    bearer;

  if (provided !== expected) {
    return jsonError("Unauthorized", 401);
  }

  return null;
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
  const editSimilarity = maxLen > 0 ? 1 - levenshtein(ac, bc) / maxLen : 0;

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

  if (homeSimilarity < 0.72) reasons.push("home_team_similarity_too_low");
  if (awaySimilarity < 0.72) reasons.push("away_team_similarity_too_low");
  if (timeDiffMinutes !== null && timeDiffMinutes > 240) {
    reasons.push("time_difference_too_large");
  }
  if (leagueSimilarity < 0.45) reasons.push("league_similarity_low");

  const normalSideScore = (homeSimilarity + awaySimilarity) / 2;
  const swappedSideScore = (swappedHomeSimilarity + swappedAwaySimilarity) / 2;

  if (swappedSideScore > normalSideScore + 0.15) {
    reasons.push("possible_home_away_swap");
  }

  if (!reasons.length) reasons.push("candidate_ok");

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

async function readMatchesWithRealBsdOdds(
  supabase: SupabaseServiceClient,
  matchIds: number[]
) {
  if (!matchIds.length) return new Set<number>();

  const { data, error } = await supabase
    .from("odds")
    .select("match_id")
    .in("match_id", matchIds)
    .eq("source", "bsd")
    .eq("pricing_method", DISPLAYABLE_BSD_PRICING_METHOD);

  if (error) {
    throw new Error(`DB odds availability read error: ${error.message}`);
  }

  return new Set(
    ((data ?? []) as OddsAvailabilityRow[])
      .map((row) => Number(row.match_id))
      .filter((id) => Number.isFinite(id))
  );
}

async function readExistingPredictionMap(
  supabase: SupabaseServiceClient,
  matchIds: number[]
) {
  const map = new Map<number, ExistingPredictionRow>();
  if (!matchIds.length) return map;

  const { data, error } = await supabase
    .from("event_predictions")
    .select("match_id, source_prediction_id, updated_at")
    .in("match_id", matchIds)
    .eq("source", "bsd")
    .eq("market", MARKET)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`DB existing predictions read error: ${error.message}`);
  }

  for (const row of (data ?? []) as ExistingPredictionRow[]) {
    const matchId = Number(row.match_id);
    if (!Number.isFinite(matchId) || map.has(matchId)) continue;
    map.set(matchId, row);
  }

  return map;
}

function shouldRefreshPrediction(args: {
  existing: ExistingPredictionRow | null;
  nextSourcePredictionId: string | null;
  staleBeforeMs: number;
}) {
  if (!args.existing) return true;

  const existingSourcePredictionId = safeString(
    args.existing.source_prediction_id
  );
  if (
    args.nextSourcePredictionId &&
    existingSourcePredictionId &&
    args.nextSourcePredictionId !== existingSourcePredictionId
  ) {
    return true;
  }

  const updatedAtMs = args.existing.updated_at
    ? Date.parse(args.existing.updated_at)
    : NaN;

  if (!Number.isFinite(updatedAtMs)) return true;

  return updatedAtMs < args.staleBeforeMs;
}

function toPredictionRow(args: {
  candidate: MatchCandidate;
  prediction: BsdPrediction;
  fetchedAt: string;
}) {
  const p = args.prediction;
  const c = args.candidate;

  return {
    match_id: c.match.id,

    source: "bsd",
    market: MARKET,

    predicted_home_score: p.predictedHomeScore,
    predicted_away_score: p.predictedAwayScore,
    predicted_score: p.mostLikelyScore,

    predicted_result: p.predictedResult,
    predicted_label: p.predictedLabel,

    expected_home_goals: p.expectedHomeGoals,
    expected_away_goals: p.expectedAwayGoals,

    probability_home_win: p.probabilities.homeWin,
    probability_draw: p.probabilities.draw,
    probability_away_win: p.probabilities.awayWin,
    probability_over_15: p.probabilities.over15,
    probability_over_25: p.probabilities.over25,
    probability_over_35: p.probabilities.over35,
    probability_btts_yes: p.probabilities.bttsYes,

    confidence: p.confidence,
    model_version: p.modelVersion,

    source_prediction_id:
      p.sourcePredictionId === null ? null : String(p.sourcePredictionId),
    source_event_id: p.sourceEventId === null ? null : String(p.sourceEventId),
    source_league_id: p.league.id === null ? null : String(p.league.id),
    source_league_name: p.league.name,
    source_home_team_id: p.homeTeam.id === null ? null : String(p.homeTeam.id),
    source_away_team_id: p.awayTeam.id === null ? null : String(p.awayTeam.id),
    source_home_team_name: p.homeTeam.name,
    source_away_team_name: p.awayTeam.name,
    source_event_date: p.eventDate,

    match_confidence: c.confidence,
    match_score: c.score,

    source_payload: p.raw,

    fetched_at: args.fetchedAt,
    updated_at: args.fetchedAt,
  };
}

function compactSaved(row: any) {
  return {
    matchId: row.match_id,
    source: row.source,
    market: row.market,
    predictedScore: row.predicted_score,
    predictedHomeScore: row.predicted_home_score,
    predictedAwayScore: row.predicted_away_score,
    predictedResult: row.predicted_result,
    predictedLabel: row.predicted_label,
    confidence: row.confidence,
    matchConfidence: row.match_confidence,
    matchScore: round4(row.match_score),
    sourcePredictionId: row.source_prediction_id,
    sourceEventId: row.source_event_id,
  };
}

export async function GET(req: Request) {
  const unauthorized = requireSecret(req);
  if (unauthorized) return unauthorized;

  const bsdApiKey = process.env.BSD_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!bsdApiKey) return jsonError("Missing BSD_API_KEY in env", 500);
  if (!supabaseUrl) return jsonError("Missing SUPABASE_URL in env", 500);
  if (!serviceKey) return jsonError("Missing SUPABASE_SERVICE_ROLE_KEY in env", 500);

  const { searchParams } = new URL(req.url);

  const date = searchParams.get("date");
  const leagueId = searchParams.get("leagueId");
  const dryRun = searchParams.get("dryRun") === "1";
  const refreshStaleHoursParam = Number(searchParams.get("refreshStaleHours"));
  const refreshStaleHours =
    Number.isFinite(refreshStaleHoursParam) && refreshStaleHoursParam >= 0
      ? Math.min(Math.trunc(refreshStaleHoursParam), 24 * 14)
      : DEFAULT_REFRESH_STALE_HOURS;

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
      reason: "BSD sync is configured for today and future dates only.",
      insertedOrUpdated: 0,
    });
  }

  if (safeDate > horizonTo) {
    return NextResponse.json({
      date: safeDate,
      source: "bsd",
      supported: false,
      horizonDays: HORIZON_DAYS,
      horizonTo,
      reason: "Date is beyond prediction sync horizon.",
      insertedOrUpdated: 0,
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
    .gte("utc_date", rangeStart)
    .lt("utc_date", rangeEnd)
    .order("utc_date", { ascending: true });

  if (dbError) {
    return jsonError("DB matches read error", 500, {
      details: dbError.message,
    });
  }

  const dbMatchesForLocalDate = ((dbRows ?? []) as DbMatchRow[]).filter((match) => {
    return localDateYmd(match.utc_date) === safeDate;
  });

  const localMatchIds = dbMatchesForLocalDate
    .map((match) => Number(match.id))
    .filter((id) => Number.isFinite(id));

  const matchesWithRealOdds = await readMatchesWithRealBsdOdds(
    supabase,
    localMatchIds
  );

  const dbMatchesRaw = dbMatchesForLocalDate.filter((match) =>
    matchesWithRealOdds.has(Number(match.id))
  );

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
      upstreamBody: bsd.data,
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
    };
  });

  const assignedPredictionKeys = new Set<string>();
  const assignedMatchIds = new Set<number>();

  const acceptedAttempts = attempts
    .filter((attempt) => attempt.best?.accepted)
    .sort((a, b) => {
      const aScore = a.best?.score ?? 0;
      const bScore = b.best?.score ?? 0;

      return bScore - aScore;
    });

  const matched: {
    prediction: BsdPrediction;
    candidate: MatchCandidate;
  }[] = [];

  const duplicateRejected: any[] = [];

  for (const attempt of acceptedAttempts) {
    const best = attempt.best;
    if (!best) continue;

    if (assignedMatchIds.has(best.match.id)) {
      duplicateRejected.push({
        sourcePredictionId: attempt.prediction.sourcePredictionId,
        sourceEventId: attempt.prediction.sourceEventId,
        matchId: best.match.id,
        reason: "match_already_assigned_to_better_prediction",
      });
      continue;
    }

    assignedPredictionKeys.add(attempt.key);
    assignedMatchIds.add(best.match.id);

    matched.push({
      prediction: attempt.prediction,
      candidate: best,
    });
  }

  const fetchedAt = new Date().toISOString();
  const staleBeforeMs =
    refreshStaleHours === 0
      ? Number.POSITIVE_INFINITY
      : Date.now() - refreshStaleHours * 60 * 60 * 1000;
  const existingPredictionMap = await readExistingPredictionMap(
    supabase,
    matched.map((item) => item.candidate.match.id)
  );

  const skippedFresh: any[] = [];

  const rows = matched
    .filter((item) => {
      const existing =
        existingPredictionMap.get(item.candidate.match.id) ?? null;
      const nextSourcePredictionId =
        item.prediction.sourcePredictionId === null
          ? null
          : String(item.prediction.sourcePredictionId);

      const refresh = shouldRefreshPrediction({
        existing,
        nextSourcePredictionId,
        staleBeforeMs,
      });

      if (!refresh) {
        skippedFresh.push({
          matchId: item.candidate.match.id,
          sourcePredictionId: nextSourcePredictionId,
          updatedAt: existing?.updated_at ?? null,
        });
      }

      return refresh;
    })
    .map((item) =>
      toPredictionRow({
        prediction: item.prediction,
        candidate: item.candidate,
        fetchedAt,
      })
    );

  if (!dryRun && rows.length > 0) {
    const { error: upsertError } = await supabase
      .from("event_predictions")
      .upsert(rows, {
        onConflict: "match_id,source,market",
      });

    if (upsertError) {
      return jsonError("event_predictions upsert error", 500, {
        details: upsertError.message,
      });
    }
  }

  return NextResponse.json({
    date: safeDate,
    source: "bsd",
    market: MARKET,
    dryRun,
    fetchedAt,
    db: {
      rangeStart,
      rangeEnd,
      rawMatchesInRangeCount: (dbRows ?? []).length,
      matchesForLocalDateCount: dbMatchesForLocalDate.length,
      matchesWithRealBsdOddsCount: dbMatchesRaw.length,
      competitions: LEAGUES,
    },
    bsd: {
      predictionsCount: bsdPredictions.length,
      pages: bsd.pages,
    },
    summary: {
      matchedCount: matched.length,
      duplicateRejectedCount: duplicateRejected.length,
      upsertedCount: dryRun ? 0 : rows.length,
      dryRunRowsCount: dryRun ? rows.length : 0,
      skippedFreshCount: skippedFresh.length,
      unmatchedBsdCount: bsdPredictions.length - matched.length,
      unmatchedMatchesCount: dbMatchesRaw.length - assignedMatchIds.size,
      skippedMatchesWithoutRealOddsCount:
        dbMatchesForLocalDate.length - dbMatchesRaw.length,
    },
    saved: rows.map(compactSaved),
    skippedFresh,
    duplicateRejected,
    meta: {
      maxPages,
      refreshStaleHours,
      note: dryRun
        ? "Dry run only. No rows were written."
        : "Matched BSD predictions for matches with real BSD odds were upserted into event_predictions.",
    },
  });
}
