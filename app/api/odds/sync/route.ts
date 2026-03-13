// app/api/odds/sync/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { generateOddsV1 } from "@/lib/odds/engine-v1";
import { generateOddsV2 } from "@/lib/odds/engine-v2";
import type { MatchInput, EngineContext } from "@/lib/odds/types";
import { requireCronSecret } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";
const DEFAULT_LEAGUES = ["CL", "PL", "BL1", "FL1", "SA", "PD", "WC"] as const;

// standings cache w api_cache
const STANDINGS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

// maks 30 dni do przodu
const MAX_AHEAD_DAYS = 30;

// grace dla kickoffu
const KICKOFF_GRACE_MINUTES = 20;

// odświeżanie wg najstarszego updated_at
const ODDS_TTL_HOURS_DEFAULT = 6;

// batch
const BATCH_LIMIT_DEFAULT = 30;

// lock anty-spam
const ODDS_LOCK_KEY = "lock:odds_sync";
const ODDS_LOCK_TTL_MS = 60 * 1000;

// snapshot config
const FIRST_HALF_SHARE = 0.45;
const SNAPSHOT_SAMPLE_LIMIT = 20;

type SyncBody = {
  date?: string; // YYYY-MM-DD
  leagues?: string[];

  maxGoals?: number;
  homeAdv?: number;
  drawBoost?: number;
  margin?: number;

  throttleMs?: number;
  maxRetries?: number;

  oddsTtlHours?: number;
  batchLimit?: number;

  engine?: "v1" | "v2";
};

type TeamRow = {
  teamId: number;
  playedGames: number;
  goalsFor: number;
  goalsAgainst: number;
};

type StandingsCtx = {
  byTeamId: Map<number, TeamRow>;
  leagueAvgGoalsFor: number;
  leagueAvgGoalsAgainst: number;
};

type GeneratedOddsResult = {
  engineVersion?: string;
  rows: any[];
  debug?: any;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ error: message, extra }, { status });
}

function isYYYYMMDD(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
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

// globalny pacing między requestami
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

async function fdFetch(
  path: string,
  opts: { throttleMs: number; maxRetries: number }
) {
  const token =
    process.env.FOOTBALL_DATA_TOKEN || process.env.FOOTBALL_DATA_API_KEY;

  if (!token) {
    throw new Error("Missing FOOTBALL_DATA_TOKEN (or FOOTBALL_DATA_API_KEY)");
  }

  const url = `${FOOTBALL_DATA_BASE}${path}`;

  let attempt = 0;

  while (true) {
    attempt++;

    await globalThrottle(opts.throttleMs);

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
      `football-data error (HTTP ${r.status}) for ${path}`;

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

    throw new Error(msg);
  }
}

function buildStandingsCtx(standingsJson: any): StandingsCtx | null {
  const table =
    standingsJson?.standings?.find((x: any) => x.type === "TOTAL")?.table ??
    standingsJson?.standings?.[0]?.table ??
    [];

  if (!Array.isArray(table) || table.length < 2) return null;

  const byTeamId = new Map<number, TeamRow>();
  let sumGF = 0;
  let sumGA = 0;
  let sumPG = 0;

  for (const row of table) {
    const teamId = row?.team?.id;
    const pg = Number(row?.playedGames ?? 0);
    const gf = Number(row?.goalsFor ?? 0);
    const ga = Number(row?.goalsAgainst ?? 0);

    if (typeof teamId !== "number") continue;
    if (!Number.isFinite(pg) || pg <= 0) continue;

    byTeamId.set(teamId, {
      teamId,
      playedGames: pg,
      goalsFor: gf,
      goalsAgainst: ga,
    });

    sumGF += gf;
    sumGA += ga;
    sumPG += pg;
  }

  if (byTeamId.size < 2 || sumPG <= 0) return null;

  return {
    byTeamId,
    leagueAvgGoalsFor: Math.max(0.9, sumGF / sumPG),
    leagueAvgGoalsAgainst: Math.max(0.9, sumGA / sumPG),
  };
}

// --- api_cache helpers ---
async function cacheRead(
  sb: ReturnType<typeof supabaseAdmin>,
  key: string,
  ttlMs: number
) {
  const { data } = await sb
    .from("api_cache")
    .select("payload,updated_at")
    .eq("key", key)
    .maybeSingle();

  if (!data?.payload || !data?.updated_at) return null;

  const age = Date.now() - new Date(data.updated_at).getTime();
  if (age > ttlMs) return null;

  return data.payload as any;
}

async function cacheWrite(
  sb: ReturnType<typeof supabaseAdmin>,
  key: string,
  payload: any,
  nowIso: string
) {
  await sb.from("api_cache").upsert({
    key,
    payload,
    updated_at: nowIso,
  });
}

async function tryAcquireLock(
  sb: ReturnType<typeof supabaseAdmin>,
  nowIso: string
): Promise<{ ok: true } | { ok: false; reason: "locked"; ageMs: number }> {
  const { data } = await sb
    .from("api_cache")
    .select("updated_at")
    .eq("key", ODDS_LOCK_KEY)
    .maybeSingle();

  if (data?.updated_at) {
    const ageMs = Date.now() - new Date(data.updated_at).getTime();
    if (ageMs >= 0 && ageMs < ODDS_LOCK_TTL_MS) {
      return { ok: false, reason: "locked", ageMs };
    }
  }

  await sb.from("api_cache").upsert({
    key: ODDS_LOCK_KEY,
    payload: { locked: true },
    updated_at: nowIso,
  });

  return { ok: true };
}

async function clearEnabledDatesCache(
  sb: ReturnType<typeof supabaseAdmin>
) {
  const { data, error } = await sb
    .from("api_cache")
    .select("key")
    .like("key", "events_enabled_dates:%");

  if (error) {
    console.error("clearEnabledDatesCache select error:", error.message);
    return;
  }

  const keys = (data ?? [])
    .map((row: any) => row?.key)
    .filter(
      (key: unknown): key is string =>
        typeof key === "string" && key.length > 0
    );

  if (!keys.length) return;

  const { error: deleteError } = await sb
    .from("api_cache")
    .delete()
    .in("key", keys);

  if (deleteError) {
    console.error("clearEnabledDatesCache delete error:", deleteError.message);
  }
}

function utcTodayYYYYMMDD() {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysISODate(dateYYYYMMDD: string, days: number) {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
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

function getMapValue<T>(map: Map<string, T>, marketId: string, selection: string) {
  return map.get(`${marketId}__${selection}`) ?? null;
}

function buildProbabilitySnapshot(rows: any[], firstHalfShare: number) {
  const fairMap = new Map<string, number>();
  const exactScoreMap: Record<string, number | null> = {};

  for (const row of rows) {
    const marketId = String(row?.market_id ?? "");
    const selection = String(row?.selection ?? "");
    const fairProb = numOrNull(row?.fair_prob);

    if (marketId && selection && fairProb != null) {
      fairMap.set(`${marketId}__${selection}`, fairProb);
    }

    if (marketId === "exact_score") {
      exactScoreMap[selection] = fairProb;
    }
  }

  const p1 = getMapValue(fairMap, "1x2", "1");
  const pX = getMapValue(fairMap, "1x2", "X");
  const p2 = getMapValue(fairMap, "1x2", "2");

  const p1X = getMapValue(fairMap, "dc", "1X");
  const p12 = getMapValue(fairMap, "dc", "12");
  const pX2 = getMapValue(fairMap, "dc", "X2");

  const pHomeDnb = getMapValue(fairMap, "dnb", "1");
  const pAwayDnb = getMapValue(fairMap, "dnb", "2");

  const pOver15 = getMapValue(fairMap, "ou_1_5", "over");
  const pUnder15 = getMapValue(fairMap, "ou_1_5", "under");
  const pOver25 = getMapValue(fairMap, "ou_2_5", "over");
  const pUnder25 = getMapValue(fairMap, "ou_2_5", "under");
  const pOver35 = getMapValue(fairMap, "ou_3_5", "over");
  const pUnder35 = getMapValue(fairMap, "ou_3_5", "under");

  const pBttsYes = getMapValue(fairMap, "btts", "yes");
  const pBttsNo = getMapValue(fairMap, "btts", "no");

  const pHomeOver05 = getMapValue(fairMap, "home_ou_0_5", "over");
  const pHomeUnder05 = getMapValue(fairMap, "home_ou_0_5", "under");
  const pHomeOver15 = getMapValue(fairMap, "home_ou_1_5", "over");
  const pHomeUnder15 = getMapValue(fairMap, "home_ou_1_5", "under");
  const pHomeOver25 = getMapValue(fairMap, "home_ou_2_5", "over");
  const pHomeUnder25 = getMapValue(fairMap, "home_ou_2_5", "under");

  const pAwayOver05 = getMapValue(fairMap, "away_ou_0_5", "over");
  const pAwayUnder05 = getMapValue(fairMap, "away_ou_0_5", "under");
  const pAwayOver15 = getMapValue(fairMap, "away_ou_1_5", "over");
  const pAwayUnder15 = getMapValue(fairMap, "away_ou_1_5", "under");
  const pAwayOver25 = getMapValue(fairMap, "away_ou_2_5", "over");
  const pAwayUnder25 = getMapValue(fairMap, "away_ou_2_5", "under");

  const p1HT = getMapValue(fairMap, "ht_1x2", "1");
  const pXHT = getMapValue(fairMap, "ht_1x2", "X");
  const p2HT = getMapValue(fairMap, "ht_1x2", "2");
  const p1XHT = getMapValue(fairMap, "ht_dc", "1X");
  const p12HT = getMapValue(fairMap, "ht_dc", "12");
  const pX2HT = getMapValue(fairMap, "ht_dc", "X2");
  const pHTOver05 = getMapValue(fairMap, "ht_ou_0_5", "over");
  const pHTUnder05 = getMapValue(fairMap, "ht_ou_0_5", "under");
  const pHTOver15 = getMapValue(fairMap, "ht_ou_1_5", "over");
  const pHTUnder15 = getMapValue(fairMap, "ht_ou_1_5", "under");
  const pHTBttsYes = getMapValue(fairMap, "ht_btts", "yes");
  const pHTBttsNo = getMapValue(fairMap, "ht_btts", "no");
  const pHTHomeOver05 = getMapValue(fairMap, "ht_home_ou_0_5", "over");
  const pHTHomeUnder05 = getMapValue(fairMap, "ht_home_ou_0_5", "under");
  const pHTHomeOver15 = getMapValue(fairMap, "ht_home_ou_1_5", "over");
  const pHTHomeUnder15 = getMapValue(fairMap, "ht_home_ou_1_5", "under");
  const pHTAwayOver05 = getMapValue(fairMap, "ht_away_ou_0_5", "over");
  const pHTAwayUnder05 = getMapValue(fairMap, "ht_away_ou_0_5", "under");
  const pHTAwayOver15 = getMapValue(fairMap, "ht_away_ou_1_5", "over");
  const pHTAwayUnder15 = getMapValue(fairMap, "ht_away_ou_1_5", "under");

  const p1ST = getMapValue(fairMap, "st_1x2", "1");
  const pXST = getMapValue(fairMap, "st_1x2", "X");
  const p2ST = getMapValue(fairMap, "st_1x2", "2");
  const pSTOver05 = getMapValue(fairMap, "st_ou_0_5", "over");
  const pSTUnder05 = getMapValue(fairMap, "st_ou_0_5", "under");
  const pSTOver15 = getMapValue(fairMap, "st_ou_1_5", "over");
  const pSTUnder15 = getMapValue(fairMap, "st_ou_1_5", "under");
  const pSTBttsYes = getMapValue(fairMap, "st_btts", "yes");
  const pSTBttsNo = getMapValue(fairMap, "st_btts", "no");

  const pEven = getMapValue(fairMap, "odd_even", "even");
  const pOdd = getMapValue(fairMap, "odd_even", "odd");

  const pHomeWinToNilYes = getMapValue(fairMap, "home_win_to_nil", "yes");
  const pHomeWinToNilNo = getMapValue(fairMap, "home_win_to_nil", "no");
  const pAwayWinToNilYes = getMapValue(fairMap, "away_win_to_nil", "yes");
  const pAwayWinToNilNo = getMapValue(fairMap, "away_win_to_nil", "no");
  const pCleanSheetHomeYes = getMapValue(fairMap, "clean_sheet_home", "yes");
  const pCleanSheetHomeNo = getMapValue(fairMap, "clean_sheet_home", "no");
  const pCleanSheetAwayYes = getMapValue(fairMap, "clean_sheet_away", "yes");
  const pCleanSheetAwayNo = getMapValue(fairMap, "clean_sheet_away", "no");

  const pExactOther = getMapValue(fairMap, "exact_score", "other");

  const lambdaH = null;
  const lambdaA = null;
  const lambdaT = null;

  const lambdaHHT = lambdaH != null ? lambdaH * firstHalfShare : null;
  const lambdaAHT = lambdaA != null ? lambdaA * firstHalfShare : null;
  const lambdaTHT =
    lambdaHHT != null && lambdaAHT != null ? lambdaHHT + lambdaAHT : null;

  const lambdaHST = lambdaH != null && lambdaHHT != null ? lambdaH - lambdaHHT : null;
  const lambdaAST = lambdaA != null && lambdaAHT != null ? lambdaA - lambdaAHT : null;
  const lambdaTST =
    lambdaHST != null && lambdaAST != null ? lambdaHST + lambdaAST : null;

  return {
    main: {
      p1,
      pX,
      p2,
      p1X,
      p12,
      pX2,
      pHomeDnb,
      pAwayDnb,
    },
    totals: {
      lambdaT,
      pOver15,
      pUnder15,
      pOver25,
      pUnder25,
      pOver35,
      pUnder35,
    },
    btts: {
      pBttsYes,
      pBttsNo,
    },
    teamGoals: {
      home: {
        lambda: lambdaH,
        pOver05: pHomeOver05,
        pUnder05: pHomeUnder05,
        pOver15: pHomeOver15,
        pUnder15: pHomeUnder15,
        pOver25: pHomeOver25,
        pUnder25: pHomeUnder25,
      },
      away: {
        lambda: lambdaA,
        pOver05: pAwayOver05,
        pUnder05: pAwayUnder05,
        pOver15: pAwayOver15,
        pUnder15: pAwayUnder15,
        pOver25: pAwayOver25,
        pUnder25: pAwayUnder25,
      },
    },
    firstHalf: {
      lambdaH: lambdaHHT,
      lambdaA: lambdaAHT,
      lambdaT: lambdaTHT,
      p1: p1HT,
      pX: pXHT,
      p2: p2HT,
      p1X: p1XHT,
      p12: p12HT,
      pX2: pX2HT,
      pOver05: pHTOver05,
      pUnder05: pHTUnder05,
      pOver15: pHTOver15,
      pUnder15: pHTUnder15,
      pBttsYes: pHTBttsYes,
      pBttsNo: pHTBttsNo,
      pHomeOver05: pHTHomeOver05,
      pHomeUnder05: pHTHomeUnder05,
      pHomeOver15: pHTHomeOver15,
      pHomeUnder15: pHTHomeUnder15,
      pAwayOver05: pHTAwayOver05,
      pAwayUnder05: pHTAwayUnder05,
      pAwayOver15: pHTAwayOver15,
      pAwayUnder15: pHTAwayUnder15,
    },
    secondHalf: {
      lambdaH: lambdaHST,
      lambdaA: lambdaAST,
      lambdaT: lambdaTST,
      p1: p1ST,
      pX: pXST,
      p2: p2ST,
      pOver05: pSTOver05,
      pUnder05: pSTUnder05,
      pOver15: pSTOver15,
      pUnder15: pSTUnder15,
      pBttsYes: pSTBttsYes,
      pBttsNo: pSTBttsNo,
    },
    extras: {
      pEven,
      pOdd,
      pHomeWinToNilYes,
      pHomeWinToNilNo,
      pAwayWinToNilYes,
      pAwayWinToNilNo,
      pCleanSheetHomeYes,
      pCleanSheetHomeNo,
      pCleanSheetAwayYes,
      pCleanSheetAwayNo,
    },
    exactScore: {
      bySelection: exactScoreMap,
      pExactOther,
    },
  };
}

function buildRowsSummary(rows: any[]) {
  const marketsCount = new Set(
    rows.map((row) => String(row?.market_id ?? "")).filter(Boolean)
  ).size;

  const sample = rows.slice(0, SNAPSHOT_SAMPLE_LIMIT).map((row) => ({
    market_id: row?.market_id ?? null,
    selection: row?.selection ?? null,
    fair_prob: numOrNull(row?.fair_prob),
    fair_odds: numOrNull(row?.fair_odds),
    book_prob: numOrNull(row?.book_prob),
    book_odds: numOrNull(row?.book_odds),
  }));

  return {
    rowsCount: rows.length,
    marketsCount,
    sample,
  };
}

function getDebugNumber(debug: any, ...paths: string[][]) {
  for (const path of paths) {
    let cur = debug;
    for (const key of path) {
      cur = cur?.[key];
    }
    const n = numOrNull(cur);
    if (n != null) return n;
  }
  return null;
}

function mergeV2DebugIntoProbabilities(probabilities: any, debug: any) {
  if (!debug || typeof debug !== "object") return probabilities;

  const lambdaH = getDebugNumber(debug, ["lambdaH"], ["model", "lambdas", "lambdaH"]);
  const lambdaA = getDebugNumber(debug, ["lambdaA"], ["model", "lambdas", "lambdaA"]);
  const lambdaT = getDebugNumber(
    debug,
    ["totalGoals"],
    ["lambdaT"],
    ["model", "lambdas", "lambdaT"]
  );

  const firstHalfShare =
    getDebugNumber(debug, ["config", "firstHalfShare"]) ?? FIRST_HALF_SHARE;

  const lambdaHHT = lambdaH != null ? lambdaH * firstHalfShare : null;
  const lambdaAHT = lambdaA != null ? lambdaA * firstHalfShare : null;
  const lambdaTHT =
    lambdaHHT != null && lambdaAHT != null ? lambdaHHT + lambdaAHT : null;

  const lambdaHST = lambdaH != null && lambdaHHT != null ? lambdaH - lambdaHHT : null;
  const lambdaAST = lambdaA != null && lambdaAHT != null ? lambdaA - lambdaAHT : null;
  const lambdaTST =
    lambdaHST != null && lambdaAST != null ? lambdaHST + lambdaAST : null;

  return {
    ...probabilities,
    totals: {
      ...probabilities.totals,
      lambdaT,
    },
    teamGoals: {
      home: {
        ...probabilities.teamGoals.home,
        lambda: lambdaH,
      },
      away: {
        ...probabilities.teamGoals.away,
        lambda: lambdaA,
      },
    },
    firstHalf: {
      ...probabilities.firstHalf,
      lambdaH: lambdaHHT,
      lambdaA: lambdaAHT,
      lambdaT: lambdaTHT,
    },
    secondHalf: {
      ...probabilities.secondHalf,
      lambdaH: lambdaHST,
      lambdaA: lambdaAST,
      lambdaT: lambdaTST,
    },
  };
}

function buildInputSnapshot(args: {
  engine: "v1" | "v2";
  nowIso: string;
  margin: number;
  homeAdv: number;
  drawBoost: number;
  maxGoals: number;
  firstHalfShare: number;
  matchId: number;
  competitionId: string | null;
  homeId: number | null;
  awayId: number | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  standingsCtx: StandingsCtx | null;
  homeStanding: TeamRow | null;
  awayStanding: TeamRow | null;
  homeRatingRow: any;
  awayRatingRow: any;
}) {
  return {
    config: {
      engine: args.engine,
      nowIso: args.nowIso,
      margin: args.margin,
      homeAdv: args.homeAdv,
      drawBoost: args.drawBoost,
      maxGoals: args.maxGoals,
      firstHalfShare: args.firstHalfShare,
    },
    matchId: args.matchId,
    competitionId: args.competitionId,
    homeTeamId: args.homeId,
    awayTeamId: args.awayId,
    homeTeam: args.homeTeamName,
    awayTeam: args.awayTeamName,
    standings: {
      available: !!args.standingsCtx,
      leagueAvgGoalsFor: args.standingsCtx?.leagueAvgGoalsFor ?? null,
      leagueAvgGoalsAgainst: args.standingsCtx?.leagueAvgGoalsAgainst ?? null,
      home: args.homeStanding
        ? {
            teamId: args.homeStanding.teamId,
            playedGames: args.homeStanding.playedGames,
            goalsFor: args.homeStanding.goalsFor,
            goalsAgainst: args.homeStanding.goalsAgainst,
          }
        : null,
      away: args.awayStanding
        ? {
            teamId: args.awayStanding.teamId,
            playedGames: args.awayStanding.playedGames,
            goalsFor: args.awayStanding.goalsFor,
            goalsAgainst: args.awayStanding.goalsAgainst,
          }
        : null,
    },
    ratings: {
      home: args.homeRatingRow
        ? {
            overall_rating: numOrNull(args.homeRatingRow?.overall_rating),
            attack_rating: numOrNull(args.homeRatingRow?.attack_rating),
            defense_rating: numOrNull(args.homeRatingRow?.defense_rating),
            form_rating: numOrNull(args.homeRatingRow?.form_rating),
            matches_count: numOrNull(args.homeRatingRow?.matches_count),
            rating_date: args.homeRatingRow?.rating_date ?? null,
          }
        : null,
      away: args.awayRatingRow
        ? {
            overall_rating: numOrNull(args.awayRatingRow?.overall_rating),
            attack_rating: numOrNull(args.awayRatingRow?.attack_rating),
            defense_rating: numOrNull(args.awayRatingRow?.defense_rating),
            form_rating: numOrNull(args.awayRatingRow?.form_rating),
            matches_count: numOrNull(args.awayRatingRow?.matches_count),
            rating_date: args.awayRatingRow?.rating_date ?? null,
          }
        : null,
    },
  };
}

function buildOutputSnapshot(args: {
  engine: "v1" | "v2";
  generated: GeneratedOddsResult;
  rows: any[];
  nowIso: string;
  margin: number;
  homeAdv: number;
  drawBoost: number;
  maxGoals: number;
  firstHalfShare: number;
  matchId: number;
  competitionId: string | null;
  homeId: number | null;
  awayId: number | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
}) {
  const baseProbabilities = buildProbabilitySnapshot(
    args.rows,
    args.firstHalfShare
  );

  const v2Debug =
    args.engine === "v2" &&
    args.generated?.debug &&
    typeof args.generated.debug === "object"
      ? args.generated.debug
      : null;

  if (v2Debug) {
    const snapshot: any = {
      ...v2Debug,
    };

    snapshot.engineVersion = snapshot.engineVersion ?? args.engine;

    snapshot.match = snapshot.match ?? {
      matchId: args.matchId,
      competitionId: args.competitionId,
      homeId: args.homeId,
      awayId: args.awayId,
      homeTeam: args.homeTeamName,
      awayTeam: args.awayTeamName,
    };

    snapshot.config = {
      ...(snapshot.config ?? {}),
      engine: args.engine,
      nowIso: snapshot.config?.nowIso ?? args.nowIso,
      margin: snapshot.config?.margin ?? args.margin,
      homeAdv: snapshot.config?.homeAdv ?? args.homeAdv,
      drawBoostInput:
        snapshot.config?.drawBoostInput ?? args.drawBoost,
      maxGoals: snapshot.config?.maxGoals ?? args.maxGoals,
      firstHalfShare:
        snapshot.config?.firstHalfShare ?? args.firstHalfShare,
    };

    snapshot.probabilities = mergeV2DebugIntoProbabilities(
      snapshot.probabilities ?? baseProbabilities,
      v2Debug
    );

    snapshot.rowsSummary =
      snapshot.rowsSummary ?? buildRowsSummary(args.rows);

    return snapshot;
  }

  return {
    engineVersion: args.engine,
    match: {
      matchId: args.matchId,
      competitionId: args.competitionId,
      homeId: args.homeId,
      awayId: args.awayId,
      homeTeam: args.homeTeamName,
      awayTeam: args.awayTeamName,
    },
    config: {
      engine: args.engine,
      nowIso: args.nowIso,
      margin: args.margin,
      homeAdv: args.homeAdv,
      drawBoost: args.drawBoost,
      maxGoals: args.maxGoals,
      firstHalfShare: args.firstHalfShare,
    },
    probabilities: baseProbabilities,
    rowsSummary: buildRowsSummary(args.rows),
    note: "Engine did not expose debug payload",
  };
}

export async function POST(req: Request) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const bodyText = await req.text();
    let body: SyncBody = {};

    try {
      body = bodyText ? (JSON.parse(bodyText) as SyncBody) : {};
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    // domyślnie: v2
    const engine: "v1" | "v2" = body.engine === "v1" ? "v1" : "v2";

    const date = body.date;
    if (date != null && !isYYYYMMDD(date)) {
      return jsonError("date must be YYYY-MM-DD", 400, { date });
    }

    if (date) {
      const today = utcTodayYYYYMMDD();
      const lastAllowed = plusDaysISODate(today, MAX_AHEAD_DAYS);

      if (date > lastAllowed) {
        return jsonError(
          `date is beyond allowed future horizon (${MAX_AHEAD_DAYS} days)`,
          400,
          { date, today, lastAllowed }
        );
      }
    }

    const leagues =
      Array.isArray(body.leagues) && body.leagues.length
        ? body.leagues.map(String)
        : [...DEFAULT_LEAGUES];

    const maxGoals = Number.isFinite(Number(body.maxGoals))
      ? Number(body.maxGoals)
      : 7;

    const homeAdv = Number.isFinite(Number(body.homeAdv))
      ? Number(body.homeAdv)
      : 1.05;

    const drawBoost = Number.isFinite(Number(body.drawBoost))
      ? Number(body.drawBoost)
      : 1.18;

    const margin = Number.isFinite(Number(body.margin))
      ? Number(body.margin)
      : 1.06;

    const throttleMs = Number.isFinite(Number(body.throttleMs))
      ? Math.max(0, Number(body.throttleMs))
      : 0;

    const maxRetries = Number.isFinite(Number(body.maxRetries))
      ? Math.max(0, Math.floor(Number(body.maxRetries)))
      : 2;

    const oddsTtlHours = Number.isFinite(Number(body.oddsTtlHours))
      ? Math.max(0, Number(body.oddsTtlHours))
      : ODDS_TTL_HOURS_DEFAULT;

    const batchLimit = Number.isFinite(Number(body.batchLimit))
      ? Math.max(1, Math.min(200, Math.floor(Number(body.batchLimit))))
      : BATCH_LIMIT_DEFAULT;

    const sb = supabaseAdmin();
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const kickoffGraceMs = KICKOFF_GRACE_MINUTES * 60 * 1000;

    const lock = await tryAcquireLock(sb, nowIso);
    if (!lock.ok) {
      return NextResponse.json({
        ok: true,
        engine,
        skipped: "locked",
        lockAgeMs: lock.ageMs,
        updatedAt: nowIso,
      });
    }

    const horizonIso = new Date(
      Date.now() + MAX_AHEAD_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const rangeStart = date ? isoStartOfUtcDay(date) : null;
    const rangeEnd = date ? isoStartOfNextUtcDay(date) : null;

    const CANDIDATES_POOL = Math.max(200, batchLimit * 20);

    let q = sb
      .from("matches")
      .select(
        "id, utc_date, status, betting_closed, competition_id, home_team, away_team, home_team_id, away_team_id"
      )
      .in("competition_id", leagues)
      .in("status", ["SCHEDULED", "TIMED"])
      .eq("betting_closed", false)
      .lte("utc_date", horizonIso)
      .order("utc_date", { ascending: true })
      .limit(CANDIDATES_POOL);

    if (rangeStart && rangeEnd) {
      q = q.gte("utc_date", rangeStart).lt("utc_date", rangeEnd);
    }

    const { data: matchCandidates, error: mErr } = await q;
    if (mErr) {
      return jsonError(mErr.message, 500, { stage: "matches_candidates_read" });
    }

    const candidates = (matchCandidates ?? []) as any[];

    const eligible = candidates.filter((m) => {
      const utc = typeof m?.utc_date === "string" ? m.utc_date : null;
      if (!utc) return false;

      const kickoffMs = Date.parse(utc);
      if (!Number.isFinite(kickoffMs)) return false;

      return kickoffMs > nowMs - kickoffGraceMs;
    });

    if (!eligible.length) {
      return NextResponse.json({
        ok: true,
        engine,
        leagues,
        date: date ?? null,
        processedMatches: 0,
        oddsUpserted: 0,
        reason: "no_eligible_matches",
        updatedAt: nowIso,
        horizon: { maxAheadDays: MAX_AHEAD_DAYS, horizonIso },
        kickoffGraceMinutes: KICKOFF_GRACE_MINUTES,
      });
    }

    const matchIds = eligible.map((m) => Number(m.id)).filter(Number.isFinite);

    if (!matchIds.length) {
      return NextResponse.json({
        ok: true,
        engine,
        leagues,
        date: date ?? null,
        processedMatches: 0,
        oddsUpserted: 0,
        reason: "no_match_ids",
        updatedAt: nowIso,
      });
    }

    const { data: oddsRows, error: oReadErr } = await sb
      .from("odds")
      .select("match_id, updated_at")
      .in("match_id", matchIds);

    if (oReadErr) {
      return jsonError(oReadErr.message, 500, { stage: "odds_read_for_queue" });
    }

    const lastByMatch = new Map<number, number>();

    for (const r of (oddsRows ?? []) as any[]) {
      const mid = Number(r?.match_id);
      if (!Number.isFinite(mid)) continue;

      const ms = Date.parse(String(r?.updated_at ?? ""));
      if (!Number.isFinite(ms)) continue;

      const prev = lastByMatch.get(mid);
      if (prev == null || ms > prev) lastByMatch.set(mid, ms);
    }

    const ttlMs = oddsTtlHours * 60 * 60 * 1000;

    const queue = eligible
      .map((m) => {
        const mid = Number(m.id);
        const lastMs = lastByMatch.get(mid) ?? null;
        return { match: m, matchId: mid, lastMs };
      })
      .filter((x) => Number.isFinite(x.matchId))
      .filter((x) => x.lastMs == null || nowMs - x.lastMs >= ttlMs)
      .sort((a, b) => {
        if (a.lastMs == null && b.lastMs == null) return 0;
        if (a.lastMs == null) return -1;
        if (b.lastMs == null) return 1;
        return a.lastMs - b.lastMs;
      })
      .slice(0, batchLimit);

    if (!queue.length) {
      return NextResponse.json({
        ok: true,
        engine,
        leagues,
        date: date ?? null,
        processedMatches: 0,
        oddsUpserted: 0,
        reason: "everything_fresh",
        ttlHours: oddsTtlHours,
        updatedAt: nowIso,
      });
    }

    const standingsByLeague = new Map<string, StandingsCtx | null>();
    const fetchOpts = { throttleMs, maxRetries };

    for (const code of leagues) {
      const standingsCacheKey = `st:${code}`;
      let standingsJson: any = await cacheRead(
        sb,
        standingsCacheKey,
        STANDINGS_CACHE_TTL_MS
      );

      if (!standingsJson) {
        try {
          standingsJson = await fdFetch(
            `/competitions/${encodeURIComponent(code)}/standings`,
            fetchOpts
          );
          await cacheWrite(sb, standingsCacheKey, standingsJson, nowIso);
        } catch {
          standingsJson = null;
        }
      }

      standingsByLeague.set(
        code,
        standingsJson ? buildStandingsCtx(standingsJson) : null
      );
    }

    const latestRatingsByLeague = new Map<string, Map<number, any>>();

    for (const code of leagues) {
      const { data: ratingRows } = await sb
        .from("team_ratings")
        .select("*")
        .eq("competition_id", code)
        .order("rating_date", { ascending: false });

      const byTeam = new Map<number, any>();

      for (const row of ratingRows ?? []) {
        const teamId = Number((row as any)?.team_id);
        if (!Number.isFinite(teamId)) continue;
        if (byTeam.has(teamId)) continue;
        byTeam.set(teamId, row);
      }

      latestRatingsByLeague.set(code, byTeam);
    }

    let oddsUpserted = 0;
    let processedMatches = 0;

    for (const item of queue) {
      const m = item.match;
      const matchId = item.matchId;

      const compCode =
        typeof m?.competition_id === "string" ? String(m.competition_id) : null;

      const homeId =
        typeof m?.home_team_id === "number" ? m.home_team_id : null;

      const awayId =
        typeof m?.away_team_id === "number" ? m.away_team_id : null;

      const homeTeamName =
        typeof m?.home_team === "string" ? m.home_team : null;

      const awayTeamName =
        typeof m?.away_team === "string" ? m.away_team : null;

      const standingsCtx = compCode
        ? standingsByLeague.get(compCode) ?? null
        : null;

      const homeStanding = homeId != null ? standingsCtx?.byTeamId.get(homeId) ?? null : null;
      const awayStanding = awayId != null ? standingsCtx?.byTeamId.get(awayId) ?? null : null;

      const latestRatings = compCode
        ? latestRatingsByLeague.get(compCode) ?? new Map<number, any>()
        : new Map<number, any>();

      const homeRatingRow =
        homeId != null ? latestRatings.get(homeId) ?? null : null;

      const awayRatingRow =
        awayId != null ? latestRatings.get(awayId) ?? null : null;

      const matchInput: MatchInput = {
        matchId,
        competitionId: compCode,
        homeId,
        awayId,
        homeTeamName,
        awayTeamName,
      };

      const engineCtx: EngineContext = {
        standingsCtx,
        homeRatingRow,
        awayRatingRow,
      };

      const engineConfig = {
        nowIso,
        margin,
        maxGoals,
        homeAdv,
        drawBoost,
        firstHalfShare: FIRST_HALF_SHARE,
      };

      const generated: GeneratedOddsResult =
        engine === "v2"
          ? (generateOddsV2(matchInput, engineCtx, engineConfig) as GeneratedOddsResult)
          : (generateOddsV1(matchInput, engineCtx, engineConfig) as GeneratedOddsResult);

      const generatedRows = Array.isArray(generated?.rows) ? generated.rows : [];

      const upsertRows = generatedRows.map((row: any) => ({
        ...row,
        match_id: matchId,
        home_team: row?.home_team ?? homeTeamName,
        away_team: row?.away_team ?? awayTeamName,
        updated_at: row?.updated_at ?? nowIso,
        engine_version: row?.engine_version ?? engine,
      }));

      const { error: oErr } = await sb.from("odds").upsert(upsertRows, {
        onConflict: "match_id,market_id,selection",
      });

      if (oErr) {
        return jsonError(oErr.message, 500, {
          stage: "odds_upsert",
          match_id: matchId,
          engine,
        });
      }

      const inputSnapshot = buildInputSnapshot({
        engine,
        nowIso,
        margin,
        homeAdv,
        drawBoost,
        maxGoals,
        firstHalfShare: FIRST_HALF_SHARE,
        matchId,
        competitionId: compCode,
        homeId,
        awayId,
        homeTeamName,
        awayTeamName,
        standingsCtx,
        homeStanding,
        awayStanding,
        homeRatingRow,
        awayRatingRow,
      });

      const outputSnapshot = buildOutputSnapshot({
        engine,
        generated,
        rows: upsertRows,
        nowIso,
        margin,
        homeAdv,
        drawBoost,
        maxGoals,
        firstHalfShare: FIRST_HALF_SHARE,
        matchId,
        competitionId: compCode,
        homeId,
        awayId,
        homeTeamName,
        awayTeamName,
      });

      try {
        const { error: runErr } = await sb.from("odds_engine_runs").insert({
          match_id: matchId,
          engine_version: engine,
          competition_id: compCode,
          home_team_id: homeId,
          away_team_id: awayId,
          home_team: homeTeamName,
          away_team: awayTeamName,
          input_snapshot: inputSnapshot,
          output_snapshot: outputSnapshot,
          odds_rows_count: upsertRows.length,
        });

        if (runErr) {
          console.error("odds_engine_runs insert error:", runErr.message);
        }
      } catch (e) {
        console.error("odds_engine_runs insert failed:", e);
      }

      oddsUpserted += upsertRows.length;
      processedMatches += 1;
    }

    try {
      await clearEnabledDatesCache(sb);
    } catch (e) {
      console.error("enabled dates cache clear failed:", e);
    }

    return NextResponse.json({
      ok: true,
      engine,
      date: date ?? null,
      leagues,
      throttleMs,
      maxRetries,
      processedMatches,
      oddsUpserted,
      queue: {
        batchLimit,
        ttlHours: oddsTtlHours,
        poolSize: eligible.length,
        selected: queue.length,
      },
      updatedAt: nowIso,
      horizon: { maxAheadDays: MAX_AHEAD_DAYS, horizonIso },
      kickoffGraceMinutes: KICKOFF_GRACE_MINUTES,
      note:
        engine === "v2"
          ? "Odds computed by v2 engine."
          : "Odds computed by v1 engine.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error", extra: { stage: "catch" } },
      { status: 500 }
    );
  }
}