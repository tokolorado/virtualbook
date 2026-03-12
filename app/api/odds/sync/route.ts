//app/api/odds/sync/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

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

// model udziału goli w połowach
const FIRST_HALF_SHARE = 0.45;

// selekcje dla exact_score — muszą być zgodne z katalogiem market_selection_catalog
const EXACT_SCORE_SELECTIONS = [
  "0:0",
  "1:0",
  "2:0",
  "2:1",
  "1:1",
  "0:1",
  "0:2",
  "1:2",
  "3:0",
  "3:1",
  "2:2",
  "1:3",
  "0:3",
  "3:2",
  "2:3",
] as const;

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
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ error: message, extra }, { status });
}

function isYYYYMMDD(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
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

type TeamRatingRow = {
  teamId: number;
  competitionId: string;
  overallRating: number;
  attackRating: number;
  defenseRating: number;
  formRating: number;
  matchesCount: number;
  ratingDate: string | null;
};

type TeamRatingsCtx = {
  byCompetitionTeam: Map<string, TeamRatingRow>;
};

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

function teamRatingKey(competitionId: string, teamId: number) {
  return `${competitionId}:${teamId}`;
}

function buildTeamRatingsCtx(rows: any[]): TeamRatingsCtx {
  const byCompetitionTeam = new Map<string, TeamRatingRow>();

  for (const raw of rows ?? []) {
    const teamId = Number(raw?.team_id);
    const competitionId = String(raw?.competition_id ?? "");
    if (!Number.isFinite(teamId) || !competitionId) continue;

    const candidate: TeamRatingRow = {
      teamId,
      competitionId,
      overallRating: Number(raw?.overall_rating ?? 0),
      attackRating: Number(raw?.attack_rating ?? 0),
      defenseRating: Number(raw?.defense_rating ?? 0),
      formRating: Number(raw?.form_rating ?? 0),
      matchesCount: Number(raw?.matches_count ?? 0),
      ratingDate:
        typeof raw?.rating_date === "string" ? String(raw.rating_date) : null,
    };

    const key = teamRatingKey(competitionId, teamId);
    const prev = byCompetitionTeam.get(key);

    if (!prev) {
      byCompetitionTeam.set(key, candidate);
      continue;
    }

    const prevTs = prev.ratingDate ? Date.parse(prev.ratingDate) : -Infinity;
    const nextTs = candidate.ratingDate
      ? Date.parse(candidate.ratingDate)
      : -Infinity;

    if (nextTs >= prevTs) {
      byCompetitionTeam.set(key, candidate);
    }
  }

  return { byCompetitionTeam };
}

function getTeamRating(
  ctx: TeamRatingsCtx | null,
  competitionId: string | null,
  teamId: number | null
) {
  if (!ctx || !competitionId || teamId == null) return null;
  return ctx.byCompetitionTeam.get(teamRatingKey(competitionId, teamId)) ?? null;
}

function poissonPmf(lambda: number, k: number) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function poissonCdf(lambda: number, k: number) {
  let s = 0;
  for (let i = 0; i <= k; i++) s += poissonPmf(lambda, i);
  return clamp(s, 0, 1);
}

function exactScoreProb(lambdaH: number, lambdaA: number, hg: number, ag: number) {
  return poissonPmf(lambdaH, hg) * poissonPmf(lambdaA, ag);
}

function totalEvenProb(lambdaTotal: number) {
  return clamp((1 + Math.exp(-2 * lambdaTotal)) / 2, 0.0001, 0.9999);
}

function getCompetitionModel(competitionId: string | null) {
  const isCL = competitionId === "CL";

  if (isCL) {
    return {
      // Liga Mistrzów: mniejszy wpływ “ligowych” standings, większy ratingów
      homeAdv: 1.025,
      standingsWeight: 0.38,
      neutralWeight: 0.62,
      neutralHome: 1.34,
      neutralAway: 1.18,

      overallImpact: 0.42,
      attackHomeImpact: 0.24,
      attackAwayImpact: 0.16,
      defenseImpact: 0.22,
      formImpact: 0.08,

      maxOverallGap: 0.22,
      maxAttackGap: 0.22,
      maxDefenseGap: 0.22,
      maxFormGap: 0.18,

      minLambdaH: 0.55,
      maxLambdaH: 2.35,
      minLambdaA: 0.45,
      maxLambdaA: 2.10,

      drawBoost: 1.08,
      smoothMix: 0.84,
      base1: 0.39,
      baseX: 0.27,
      base2: 0.34,
      minP1: 0.08,
      maxP1: 0.82,
      minPX: 0.14,
      maxPX: 0.38,
      minP2: 0.08,
      maxP2: 0.82,
    };
  }

  return {
    // ligi krajowe: zostają blisko obecnego zachowania
    homeAdv: 1.05,
    standingsWeight: 0.65,
    neutralWeight: 0.35,
    neutralHome: 1.06,
    neutralAway: 0.94,

    overallImpact: 0.28,
    attackHomeImpact: 0.16,
    attackAwayImpact: 0.10,
    defenseImpact: 0.14,
    formImpact: 0.10,

    maxOverallGap: 0.25,
    maxAttackGap: 0.25,
    maxDefenseGap: 0.25,
    maxFormGap: 0.25,

    minLambdaH: 0.45,
    maxLambdaH: 2.85,
    minLambdaA: 0.35,
    maxLambdaA: 2.45,

    drawBoost: 1.18,
    smoothMix: 0.75,
    base1: 0.42,
    baseX: 0.28,
    base2: 0.30,
    minP1: 0.03,
    maxP1: 0.90,
    minPX: 0.06,
    maxPX: 0.50,
    minP2: 0.03,
    maxP2: 0.90,
  };
}

function computeLambdas(args: {
  competitionId: string | null;
  homeId: number | null;
  awayId: number | null;
  ctx: StandingsCtx | null;
  homeAdv: number;
  homeRating: number | null;
  awayRating: number | null;
  homeAttackRating: number | null;
  awayAttackRating: number | null;
  homeDefenseRating: number | null;
  awayDefenseRating: number | null;
  homeFormRating: number | null;
  awayFormRating: number | null;
}) {
  const model = getCompetitionModel(args.competitionId);

  // fallback bez standings
  if (!args.ctx || args.homeId == null || args.awayId == null) {
    let fallbackH = args.competitionId === "CL" ? 1.34 : 1.32;
    let fallbackA = args.competitionId === "CL" ? 1.18 : 1.08;

    const homeOverall =
      Number.isFinite(args.homeRating) ? Number(args.homeRating) : null;
    const awayOverall =
      Number.isFinite(args.awayRating) ? Number(args.awayRating) : null;

    if (homeOverall != null && awayOverall != null) {
      const gap = clamp(
        (homeOverall - awayOverall) / 100,
        -model.maxOverallGap,
        model.maxOverallGap
      );
      fallbackH *= 1 + gap * model.overallImpact;
      fallbackA *= 1 - gap * model.overallImpact;
    }

    return {
      lambdaH: clamp(fallbackH, model.minLambdaH, model.maxLambdaH),
      lambdaA: clamp(fallbackA, model.minLambdaA, model.maxLambdaA),
    };
  }

  const h = args.ctx.byTeamId.get(args.homeId) ?? null;
  const a = args.ctx.byTeamId.get(args.awayId) ?? null;
  if (!h || !a) {
    return {
      lambdaH: clamp(1.32, model.minLambdaH, model.maxLambdaH),
      lambdaA: clamp(1.08, model.minLambdaA, model.maxLambdaA),
    };
  }

  const hAtt = h.goalsFor / h.playedGames;
  const hDef = h.goalsAgainst / h.playedGames;
  const aAtt = a.goalsFor / a.playedGames;
  const aDef = a.goalsAgainst / a.playedGames;

  const lgGF = args.ctx.leagueAvgGoalsFor;
  const lgGA = args.ctx.leagueAvgGoalsAgainst;

  const base = lgGF;

  // standings-driven raw
  const lambdaH_raw = base * (hAtt / lgGF) * (aDef / lgGA) * model.homeAdv;
  const lambdaA_raw = base * (aAtt / lgGF) * (hDef / lgGA);

  // shrinkage
  let lambdaH =
    lambdaH_raw * model.standingsWeight +
    model.neutralHome * model.neutralWeight;

  let lambdaA =
    lambdaA_raw * model.standingsWeight +
    model.neutralAway * model.neutralWeight;

  const homeOverall =
    Number.isFinite(args.homeRating) ? Number(args.homeRating) : null;
  const awayOverall =
    Number.isFinite(args.awayRating) ? Number(args.awayRating) : null;

  if (homeOverall != null && awayOverall != null) {
    const overallGap = clamp(
      (homeOverall - awayOverall) / 100,
      -model.maxOverallGap,
      model.maxOverallGap
    );
    lambdaH *= 1 + overallGap * model.overallImpact;
    lambdaA *= 1 - overallGap * model.overallImpact;
  }

  const homeAttack =
    Number.isFinite(args.homeAttackRating) ? Number(args.homeAttackRating) : null;
  const awayAttack =
    Number.isFinite(args.awayAttackRating) ? Number(args.awayAttackRating) : null;

  if (homeAttack != null && awayAttack != null) {
    const attackGap = clamp(
      (homeAttack - awayAttack) / 100,
      -model.maxAttackGap,
      model.maxAttackGap
    );
    lambdaH *= 1 + attackGap * model.attackHomeImpact;
    lambdaA *= 1 - attackGap * model.attackAwayImpact;
  }

  const homeDefense =
    Number.isFinite(args.homeDefenseRating) ? Number(args.homeDefenseRating) : null;
  const awayDefense =
    Number.isFinite(args.awayDefenseRating) ? Number(args.awayDefenseRating) : null;

  if (homeDefense != null && awayDefense != null) {
    const defenseGap = clamp(
      (homeDefense - awayDefense) / 100,
      -model.maxDefenseGap,
      model.maxDefenseGap
    );
    lambdaH *= 1 - defenseGap * model.defenseImpact;
    lambdaA *= 1 + defenseGap * model.defenseImpact;
  }

  const homeForm =
    Number.isFinite(args.homeFormRating) ? Number(args.homeFormRating) : null;
  const awayForm =
    Number.isFinite(args.awayFormRating) ? Number(args.awayFormRating) : null;

  if (homeForm != null && awayForm != null) {
    const formGap = clamp(
      (homeForm - awayForm) / 100,
      -model.maxFormGap,
      model.maxFormGap
    );
    lambdaH *= 1 + formGap * model.formImpact;
    lambdaA *= 1 - formGap * model.formImpact;
  }

  lambdaH = clamp(lambdaH, model.minLambdaH, model.maxLambdaH);
  lambdaA = clamp(lambdaA, model.minLambdaA, model.maxLambdaA);

  return { lambdaH, lambdaA };
}

function compute1X2FromLambdas(args: {
  competitionId: string | null;
  lambdaH: number;
  lambdaA: number;
  drawBoost: number;
  maxGoals: number;
}) {
  const model = getCompetitionModel(args.competitionId);
  const effectiveDrawBoost =
    args.competitionId === "CL" ? model.drawBoost : args.drawBoost;

  const maxGoals = Math.max(3, Math.min(10, Math.floor(args.maxGoals)));

  const ph: number[] = [];
  const pa: number[] = [];
  let sumH = 0;
  let sumA = 0;

  for (let k = 0; k <= maxGoals; k++) {
    const pH = poissonPmf(args.lambdaH, k);
    const pA = poissonPmf(args.lambdaA, k);
    ph.push(pH);
    pa.push(pA);
    sumH += pH;
    sumA += pA;
  }

  if (sumH > 0) for (let i = 0; i < ph.length; i++) ph[i] /= sumH;
  if (sumA > 0) for (let i = 0; i < pa.length; i++) pa[i] /= sumA;

  let p1 = 0;
  let pX = 0;
  let p2 = 0;

  for (let i = 0; i < ph.length; i++) {
    for (let j = 0; j < pa.length; j++) {
      const p = ph[i] * pa[j];
      if (i > j) p1 += p;
      else if (i === j) pX += p;
      else p2 += p;
    }
  }

  pX *= effectiveDrawBoost;

  let s = p1 + pX + p2;
  if (s > 0) {
    p1 /= s;
    pX /= s;
    p2 /= s;
  }

  // smoothing
  p1 = p1 * model.smoothMix + model.base1 * (1 - model.smoothMix);
  pX = pX * model.smoothMix + model.baseX * (1 - model.smoothMix);
  p2 = p2 * model.smoothMix + model.base2 * (1 - model.smoothMix);

  p1 = clamp(p1, model.minP1, model.maxP1);
  pX = clamp(pX, model.minPX, model.maxPX);
  p2 = clamp(p2, model.minP2, model.maxP2);

  const s2 = p1 + pX + p2;
  return { p1: p1 / s2, pX: pX / s2, p2: p2 / s2 };
}

function bookify(
  prob: number,
  margin: number,
  minProb = 0.01,
  maxProb = 0.98
) {
  const fairProb = clamp(prob, minProb, maxProb);
  const fairOdds = 1 / fairProb;

  const bookProb = clamp(fairProb * margin, minProb, maxProb);
  const bookOdds = 1 / bookProb;

  return {
    fair_prob: fairProb,
    fair_odds: fairOdds,
    book_prob: bookProb,
    book_odds: bookOdds,
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

export async function POST(req: Request) {
  try {
    const bodyText = await req.text();
    let body: SyncBody = {};
    try {
      body = bodyText ? (JSON.parse(bodyText) as SyncBody) : {};
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

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
        .select(
          "team_id, competition_id, overall_rating, attack_rating, defense_rating, form_rating, rating_date"
        )
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

      const ctx = compCode ? standingsByLeague.get(compCode) ?? null : null;

      const latestRatings = compCode
        ? latestRatingsByLeague.get(compCode) ?? new Map<number, any>()
        : new Map<number, any>();

      const homeRatingRow =
        homeId != null ? latestRatings.get(homeId) ?? null : null;
      const awayRatingRow =
        awayId != null ? latestRatings.get(awayId) ?? null : null;

      const { lambdaH, lambdaA } = computeLambdas({
        competitionId: compCode,
        homeId,
        awayId,
        ctx,
        homeAdv,

        homeRating: homeRatingRow?.overall_rating ?? null,
        awayRating: awayRatingRow?.overall_rating ?? null,

        homeAttackRating: homeRatingRow?.attack_rating ?? null,
        awayAttackRating: awayRatingRow?.attack_rating ?? null,

        homeDefenseRating: homeRatingRow?.defense_rating ?? null,
        awayDefenseRating: awayRatingRow?.defense_rating ?? null,

        homeFormRating: homeRatingRow?.form_rating ?? null,
        awayFormRating: awayRatingRow?.form_rating ?? null,
      });

      const { p1, pX, p2 } = compute1X2FromLambdas({
        competitionId: compCode,
        lambdaH,
        lambdaA,
        drawBoost,
        maxGoals,
      });

      const lambdaT = clamp(lambdaH + lambdaA, 0.2, 8.0);

      const pUnder15 = poissonCdf(lambdaT, 1);
      const pOver15 = 1 - pUnder15;

      const pUnder25 = poissonCdf(lambdaT, 2);
      const pOver25 = 1 - pUnder25;

      const pUnder35 = poissonCdf(lambdaT, 3);
      const pOver35 = 1 - pUnder35;

      const pH0 = Math.exp(-lambdaH);
      const pA0 = Math.exp(-lambdaA);
      const p00 = Math.exp(-lambdaT);
      const pBttsYes = clamp(1 - pH0 - pA0 + p00, 0.01, 0.98);
      const pBttsNo = 1 - pBttsYes;

      const pHomeUnder05 = poissonCdf(lambdaH, 0);
      const pHomeOver05 = 1 - pHomeUnder05;
      const pHomeUnder15 = poissonCdf(lambdaH, 1);
      const pHomeOver15 = 1 - pHomeUnder15;
      const pHomeUnder25 = poissonCdf(lambdaH, 2);
      const pHomeOver25 = 1 - pHomeUnder25;

      const pAwayUnder05 = poissonCdf(lambdaA, 0);
      const pAwayOver05 = 1 - pAwayUnder05;
      const pAwayUnder15 = poissonCdf(lambdaA, 1);
      const pAwayOver15 = 1 - pAwayUnder15;
      const pAwayUnder25 = poissonCdf(lambdaA, 2);
      const pAwayOver25 = 1 - pAwayUnder25;

      const p1X = clamp(p1 + pX, 0.01, 0.99);
      const p12 = clamp(p1 + p2, 0.01, 0.99);
      const pX2 = clamp(pX + p2, 0.01, 0.99);

      const lambdaH_HT = clamp(lambdaH * FIRST_HALF_SHARE, 0.05, 4.5);
      const lambdaA_HT = clamp(lambdaA * FIRST_HALF_SHARE, 0.05, 4.5);
      const lambdaT_HT = clamp(lambdaH_HT + lambdaA_HT, 0.1, 6.0);

      const { p1: p1HT, pX: pXHT, p2: p2HT } = compute1X2FromLambdas({
        competitionId: compCode,
        lambdaH: lambdaH_HT,
        lambdaA: lambdaA_HT,
        drawBoost: drawBoost * 1.1,
        maxGoals: Math.max(4, maxGoals - 1),
      });

      const pHTUnder05 = poissonCdf(lambdaT_HT, 0);
      const pHTOver05 = 1 - pHTUnder05;
      const pHTUnder15 = poissonCdf(lambdaT_HT, 1);
      const pHTOver15 = 1 - pHTUnder15;

      const pH0HT = Math.exp(-lambdaH_HT);
      const pA0HT = Math.exp(-lambdaA_HT);
      const p00HT = Math.exp(-lambdaT_HT);
      const pHTBttsYes = clamp(1 - pH0HT - pA0HT + p00HT, 0.01, 0.98);
      const pHTBttsNo = 1 - pHTBttsYes;

      const lambdaH_ST = clamp(lambdaH - lambdaH_HT, 0.05, 4.5);
      const lambdaA_ST = clamp(lambdaA - lambdaA_HT, 0.05, 4.5);
      const lambdaT_ST = clamp(lambdaH_ST + lambdaA_ST, 0.1, 6.0);

      const pSTUnder05 = poissonCdf(lambdaT_ST, 0);
      const pSTOver05 = 1 - pSTUnder05;
      const pSTUnder15 = poissonCdf(lambdaT_ST, 1);
      const pSTOver15 = 1 - pSTUnder15;

      const pEven = totalEvenProb(lambdaT);
      const pOdd = 1 - pEven;

            const p1XHT = clamp(p1HT + pXHT, 0.01, 0.99);
      const p12HT = clamp(p1HT + p2HT, 0.01, 0.99);
      const pX2HT = clamp(pXHT + p2HT, 0.01, 0.99);

      const pHTHomeUnder05 = poissonCdf(lambdaH_HT, 0);
      const pHTHomeOver05 = 1 - pHTHomeUnder05;
      const pHTHomeUnder15 = poissonCdf(lambdaH_HT, 1);
      const pHTHomeOver15 = 1 - pHTHomeUnder15;

      const pHTAwayUnder05 = poissonCdf(lambdaA_HT, 0);
      const pHTAwayOver05 = 1 - pHTAwayUnder05;
      const pHTAwayUnder15 = poissonCdf(lambdaA_HT, 1);
      const pHTAwayOver15 = 1 - pHTAwayUnder15;

      const { p1: p1ST, pX: pXST, p2: p2ST } = compute1X2FromLambdas({
        competitionId: compCode,
        lambdaH: lambdaH_ST,
        lambdaA: lambdaA_ST,
        drawBoost: drawBoost * 1.05,
        maxGoals: Math.max(4, maxGoals - 1),
      });

      const pH0ST = Math.exp(-lambdaH_ST);
      const pA0ST = Math.exp(-lambdaA_ST);
      const p00ST = Math.exp(-lambdaT_ST);
      const pSTBttsYes = clamp(1 - pH0ST - pA0ST + p00ST, 0.01, 0.98);
      const pSTBttsNo = 1 - pSTBttsYes;

      const dnbDenom = Math.max(p1 + p2, 0.0001);
      const pHomeDnb = clamp(p1 / dnbDenom, 0.01, 0.99);
      const pAwayDnb = clamp(p2 / dnbDenom, 0.01, 0.99);

      const pHomeWinToNilYes = clamp((1 - pH0) * pA0, 0.0005, 0.999);
      const pHomeWinToNilNo = 1 - pHomeWinToNilYes;

      const pAwayWinToNilYes = clamp((1 - pA0) * pH0, 0.0005, 0.999);
      const pAwayWinToNilNo = 1 - pAwayWinToNilYes;

      const pCleanSheetHomeYes = clamp(pA0, 0.0005, 0.999);
      const pCleanSheetHomeNo = 1 - pCleanSheetHomeYes;

      const pCleanSheetAwayYes = clamp(pH0, 0.0005, 0.999);
      const pCleanSheetAwayNo = 1 - pCleanSheetAwayYes;


      const exactScoreProbMap = new Map<string, number>();
      let knownExactScoreSum = 0;

      for (const key of EXACT_SCORE_SELECTIONS) {
        const [hgRaw, agRaw] = key.split(":");
        const hg = Number(hgRaw);
        const ag = Number(agRaw);
        const p = exactScoreProb(lambdaH, lambdaA, hg, ag);
        exactScoreProbMap.set(key, p);
        knownExactScoreSum += p;
      }

      const pExactOther = clamp(1 - knownExactScoreSum, 0.0005, 0.999);

      const rows: any[] = [];

      const baseMeta = {
        home_team: homeTeamName,
        away_team: awayTeamName,
      };

      {
        const b1 = bookify(p1, margin);
        const bX = bookify(pX, margin);
        const b2 = bookify(p2, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "1x2",
            selection: "1",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...b1,
          },
          {
            match_id: matchId,
            market_id: "1x2",
            selection: "X",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bX,
          },
          {
            match_id: matchId,
            market_id: "1x2",
            selection: "2",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...b2,
          }
        );
      }

      {
        const b1X = bookify(p1X, margin);
        const b12 = bookify(p12, margin);
        const bX2 = bookify(pX2, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "dc",
            selection: "1X",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...b1X,
          },
          {
            match_id: matchId,
            market_id: "dc",
            selection: "12",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...b12,
          },
          {
            match_id: matchId,
            market_id: "dc",
            selection: "X2",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bX2,
          }
        );
      }

            {
        const bHomeDnb = bookify(pHomeDnb, margin);
        const bAwayDnb = bookify(pAwayDnb, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "dnb",
            selection: "1",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHomeDnb,
          },
          {
            match_id: matchId,
            market_id: "dnb",
            selection: "2",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bAwayDnb,
          }
        );
      }





      {
        const bOver15 = bookify(pOver15, margin);
        const bUnder15 = bookify(pUnder15, margin);
        const bOver25 = bookify(pOver25, margin);
        const bUnder25 = bookify(pUnder25, margin);
        const bOver35 = bookify(pOver35, margin);
        const bUnder35 = bookify(pUnder35, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "ou_1_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bOver15,
          },
          {
            match_id: matchId,
            market_id: "ou_1_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bUnder15,
          },
          {
            match_id: matchId,
            market_id: "ou_2_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bOver25,
          },
          {
            match_id: matchId,
            market_id: "ou_2_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bUnder25,
          },
          {
            match_id: matchId,
            market_id: "ou_3_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bOver35,
          },
          {
            match_id: matchId,
            market_id: "ou_3_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bUnder35,
          }
        );
      }

      {
        const bYes = bookify(pBttsYes, margin);
        const bNo = bookify(pBttsNo, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "btts",
            selection: "yes",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bYes,
          },
          {
            match_id: matchId,
            market_id: "btts",
            selection: "no",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bNo,
          }
        );
      }

      {
        const bHomeOver05 = bookify(pHomeOver05, margin);
        const bHomeUnder05 = bookify(pHomeUnder05, margin);
        const bHomeOver15 = bookify(pHomeOver15, margin);
        const bHomeUnder15 = bookify(pHomeUnder15, margin);
        const bHomeOver25 = bookify(pHomeOver25, margin);
        const bHomeUnder25 = bookify(pHomeUnder25, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "home_ou_0_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHomeOver05,
          },
          {
            match_id: matchId,
            market_id: "home_ou_0_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHomeUnder05,
          },
          {
            match_id: matchId,
            market_id: "home_ou_1_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHomeOver15,
          },
          {
            match_id: matchId,
            market_id: "home_ou_1_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHomeUnder15,
          },
          {
            match_id: matchId,
            market_id: "home_ou_2_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHomeOver25,
          },
          {
            match_id: matchId,
            market_id: "home_ou_2_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHomeUnder25,
          }
        );
      }

      {
        const bAwayOver05 = bookify(pAwayOver05, margin);
        const bAwayUnder05 = bookify(pAwayUnder05, margin);
        const bAwayOver15 = bookify(pAwayOver15, margin);
        const bAwayUnder15 = bookify(pAwayUnder15, margin);
        const bAwayOver25 = bookify(pAwayOver25, margin);
        const bAwayUnder25 = bookify(pAwayUnder25, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "away_ou_0_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bAwayOver05,
          },
          {
            match_id: matchId,
            market_id: "away_ou_0_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bAwayUnder05,
          },
          {
            match_id: matchId,
            market_id: "away_ou_1_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bAwayOver15,
          },
          {
            match_id: matchId,
            market_id: "away_ou_1_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bAwayUnder15,
          },
          {
            match_id: matchId,
            market_id: "away_ou_2_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bAwayOver25,
          },
          {
            match_id: matchId,
            market_id: "away_ou_2_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bAwayUnder25,
          }
        );
      }

      {
        const b1HT = bookify(p1HT, margin);
        const bXHT = bookify(pXHT, margin);
        const b2HT = bookify(p2HT, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "ht_1x2",
            selection: "1",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...b1HT,
          },
          {
            match_id: matchId,
            market_id: "ht_1x2",
            selection: "X",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bXHT,
          },
          {
            match_id: matchId,
            market_id: "ht_1x2",
            selection: "2",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...b2HT,
          }
        );
      }

            {
        const b1XHT = bookify(p1XHT, margin);
        const b12HT = bookify(p12HT, margin);
        const bX2HT = bookify(pX2HT, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "ht_dc",
            selection: "1X",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...b1XHT,
          },
          {
            match_id: matchId,
            market_id: "ht_dc",
            selection: "12",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...b12HT,
          },
          {
            match_id: matchId,
            market_id: "ht_dc",
            selection: "X2",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bX2HT,
          }
        );
      }

      {
        const bHTOver05 = bookify(pHTOver05, margin);
        const bHTUnder05 = bookify(pHTUnder05, margin);
        const bHTOver15 = bookify(pHTOver15, margin);
        const bHTUnder15 = bookify(pHTUnder15, margin);
        const bHTYes = bookify(pHTBttsYes, margin);
        const bHTNo = bookify(pHTBttsNo, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "ht_ou_0_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHTOver05,
          },
          {
            match_id: matchId,
            market_id: "ht_ou_0_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHTUnder05,
          },
          {
            match_id: matchId,
            market_id: "ht_ou_1_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHTOver15,
          },
          {
            match_id: matchId,
            market_id: "ht_ou_1_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHTUnder15,
          },
          {
            match_id: matchId,
            market_id: "ht_btts",
            selection: "yes",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHTYes,
          },
          {
            match_id: matchId,
            market_id: "ht_btts",
            selection: "no",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHTNo,
          }
        );
      }

            {
        const bHTHomeOver05 = bookify(pHTHomeOver05, margin);
        const bHTHomeUnder05 = bookify(pHTHomeUnder05, margin);
        const bHTHomeOver15 = bookify(pHTHomeOver15, margin);
        const bHTHomeUnder15 = bookify(pHTHomeUnder15, margin);

        const bHTAwayOver05 = bookify(pHTAwayOver05, margin);
        const bHTAwayUnder05 = bookify(pHTAwayUnder05, margin);
        const bHTAwayOver15 = bookify(pHTAwayOver15, margin);
        const bHTAwayUnder15 = bookify(pHTAwayUnder15, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "ht_home_ou_0_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHTHomeOver05,
          },
          {
            match_id: matchId,
            market_id: "ht_home_ou_0_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHTHomeUnder05,
          },
          {
            match_id: matchId,
            market_id: "ht_home_ou_1_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHTHomeOver15,
          },
          {
            match_id: matchId,
            market_id: "ht_home_ou_1_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHTHomeUnder15,
          },
          {
            match_id: matchId,
            market_id: "ht_away_ou_0_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHTAwayOver05,
          },
          {
            match_id: matchId,
            market_id: "ht_away_ou_0_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHTAwayUnder05,
          },
          {
            match_id: matchId,
            market_id: "ht_away_ou_1_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHTAwayOver15,
          },
          {
            match_id: matchId,
            market_id: "ht_away_ou_1_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHTAwayUnder15,
          }
        );
      }

      {
        const bSTOver05 = bookify(pSTOver05, margin);
        const bSTUnder05 = bookify(pSTUnder05, margin);
        const bSTOver15 = bookify(pSTOver15, margin);
        const bSTUnder15 = bookify(pSTUnder15, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "st_ou_0_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bSTOver05,
          },
          {
            match_id: matchId,
            market_id: "st_ou_0_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bSTUnder05,
          },
          {
            match_id: matchId,
            market_id: "st_ou_1_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bSTOver15,
          },
          {
            match_id: matchId,
            market_id: "st_ou_1_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bSTUnder15,
          }
        );
      }

            {
        const b1ST = bookify(p1ST, margin);
        const bXST = bookify(pXST, margin);
        const b2ST = bookify(p2ST, margin);

        const bSTYes = bookify(pSTBttsYes, margin);
        const bSTNo = bookify(pSTBttsNo, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "st_1x2",
            selection: "1",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...b1ST,
          },
          {
            match_id: matchId,
            market_id: "st_1x2",
            selection: "X",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bXST,
          },
          {
            match_id: matchId,
            market_id: "st_1x2",
            selection: "2",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...b2ST,
          },
          {
            match_id: matchId,
            market_id: "st_btts",
            selection: "yes",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bSTYes,
          },
          {
            match_id: matchId,
            market_id: "st_btts",
            selection: "no",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bSTNo,
          }
        );
      }

      {
        const bEven = bookify(pEven, margin);
        const bOdd = bookify(pOdd, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "odd_even",
            selection: "even",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bEven,
          },
          {
            match_id: matchId,
            market_id: "odd_even",
            selection: "odd",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bOdd,
          }
        );
      }

            {
        const bHomeWinToNilYes = bookify(pHomeWinToNilYes, margin, 0.0005, 0.95);
        const bHomeWinToNilNo = bookify(pHomeWinToNilNo, margin);

        const bAwayWinToNilYes = bookify(pAwayWinToNilYes, margin, 0.0005, 0.95);
        const bAwayWinToNilNo = bookify(pAwayWinToNilNo, margin);

        const bCleanSheetHomeYes = bookify(pCleanSheetHomeYes, margin, 0.0005, 0.95);
        const bCleanSheetHomeNo = bookify(pCleanSheetHomeNo, margin);

        const bCleanSheetAwayYes = bookify(pCleanSheetAwayYes, margin, 0.0005, 0.95);
        const bCleanSheetAwayNo = bookify(pCleanSheetAwayNo, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "home_win_to_nil",
            selection: "yes",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHomeWinToNilYes,
          },
          {
            match_id: matchId,
            market_id: "home_win_to_nil",
            selection: "no",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bHomeWinToNilNo,
          },
          {
            match_id: matchId,
            market_id: "away_win_to_nil",
            selection: "yes",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bAwayWinToNilYes,
          },
          {
            match_id: matchId,
            market_id: "away_win_to_nil",
            selection: "no",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bAwayWinToNilNo,
          },
          {
            match_id: matchId,
            market_id: "clean_sheet_home",
            selection: "yes",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bCleanSheetHomeYes,
          },
          {
            match_id: matchId,
            market_id: "clean_sheet_home",
            selection: "no",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bCleanSheetHomeNo,
          },
          {
            match_id: matchId,
            market_id: "clean_sheet_away",
            selection: "yes",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bCleanSheetAwayYes,
          },
          {
            match_id: matchId,
            market_id: "clean_sheet_away",
            selection: "no",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bCleanSheetAwayNo,
          }
        );
      }

      {
        for (const key of EXACT_SCORE_SELECTIONS) {
          const p = exactScoreProbMap.get(key) ?? 0;
          const book = bookify(p, margin, 0.0005, 0.95);

          rows.push({
            match_id: matchId,
            market_id: "exact_score",
            selection: key,
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...book,
          });
        }

        const bookOther = bookify(pExactOther, margin, 0.0005, 0.95);

        rows.push({
          match_id: matchId,
          market_id: "exact_score",
          selection: "other",
          margin,
          risk_adjustment: 0,
          updated_at: nowIso,
          ...baseMeta,
          ...bookOther,
        });
      }

      const { error: oErr } = await sb.from("odds").upsert(rows, {
        onConflict: "match_id,market_id,selection",
      });

      if (oErr) {
        return jsonError(oErr.message, 500, {
          stage: "odds_upsert",
          match_id: matchId,
        });
      }

      oddsUpserted += rows.length;
      processedMatches += 1;
    }

    try {
      await clearEnabledDatesCache(sb);
    } catch (e) {
      console.error("enabled dates cache clear failed:", e);
    }

    return NextResponse.json({
      ok: true,
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
  "Odds computed from DB matches. Extended markets now include double chance, DNB, multiple goal totals, team goal totals, first-half and second-half totals, first-half and second-half result markets, first-half double chance, first-half/second-half BTTS, odd/even, exact score, win to nil and clean sheet markets.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error", extra: { stage: "catch" } },
      { status: 500 }
    );
  }
}