// app/api/odds/sync/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";
const DEFAULT_LEAGUES = ["CL", "PL", "BL1", "FL1", "SA", "PD", "WC"] as const;

// standings cache w api_cache
const STANDINGS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

// ✅ HORYZONT: maks 30 dni do przodu
const MAX_AHEAD_DAYS = 30;

// ✅ “grace” dla kickoffu: żeby nie wyciąć meczów, które właśnie się zaczęły
const KICKOFF_GRACE_MINUTES = 20;

// ✅ Odświeżanie wg najstarszego updated_at (lub brak odds)
const ODDS_TTL_HOURS_DEFAULT = 6;

// ✅ Batch (żeby nie spalać limitów): ile meczów maks. na jedno wywołanie
const BATCH_LIMIT_DEFAULT = 30;

// ✅ Lock anty-spam (60s): tylko jedno liczenie na raz
const ODDS_LOCK_KEY = "lock:odds_sync";
const ODDS_LOCK_TTL_MS = 60 * 1000;

type SyncBody = {
  // ogranicz do konkretnego dnia (UTC) – opcjonalnie
  date?: string; // YYYY-MM-DD
  leagues?: string[];

  // model params
  maxGoals?: number; // default 7
  homeAdv?: number; // default 1.05
  drawBoost?: number; // default 1.18
  margin?: number; // default 1.06

  // rate-limit / pacing (tylko dla FD standings)
  throttleMs?: number; // default 0
  maxRetries?: number; // default 2

  // batch / TTL
  oddsTtlHours?: number; // default 6
  batchLimit?: number; // default 30
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

// ✅ globalny pacing między requestami do FD w ramach całego route call
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

function computeLambdas(args: {
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
  // fallback jeśli nie mamy standings ctx lub ID teamów
  if (!args.ctx || args.homeId == null || args.awayId == null) {
    return { lambdaH: 1.32, lambdaA: 1.08 };
  }

  const h = args.ctx.byTeamId.get(args.homeId) ?? null;
  const a = args.ctx.byTeamId.get(args.awayId) ?? null;
  if (!h || !a) return { lambdaH: 1.32, lambdaA: 1.08 };

  const hAtt = h.goalsFor / h.playedGames;
  const hDef = h.goalsAgainst / h.playedGames;
  const aAtt = a.goalsFor / a.playedGames;
  const aDef = a.goalsAgainst / a.playedGames;

  const lgGF = args.ctx.leagueAvgGoalsFor;
  const lgGA = args.ctx.leagueAvgGoalsAgainst;

  const base = lgGF;

  // 1) baza standings
  let lambdaH_raw = base * (hAtt / lgGF) * (aDef / lgGA) * args.homeAdv;
  let lambdaA_raw = base * (aAtt / lgGF) * (hDef / lgGA);

  // 2) shrinkage do średniej ligi, żeby nie robić zbyt skrajnych kursów
  const neutralHome = base * 1.06;
  const neutralAway = base * 0.94;

  let lambdaH = lambdaH_raw * 0.65 + neutralHome * 0.35;
  let lambdaA = lambdaA_raw * 0.65 + neutralAway * 0.35;

  // 3) rating overall — mniejszy wpływ niż wcześniej
  const homeOverall = Number.isFinite(args.homeRating)
    ? Number(args.homeRating)
    : null;
  const awayOverall = Number.isFinite(args.awayRating)
    ? Number(args.awayRating)
    : null;

  if (homeOverall != null && awayOverall != null) {
    const overallGap = clamp((homeOverall - awayOverall) / 100, -0.25, 0.25);
    lambdaH *= 1 + overallGap * 0.28;
    lambdaA *= 1 - overallGap * 0.28;
  }

  // 4) attack rating
  const homeAttack = Number.isFinite(args.homeAttackRating)
    ? Number(args.homeAttackRating)
    : null;
  const awayAttack = Number.isFinite(args.awayAttackRating)
    ? Number(args.awayAttackRating)
    : null;

  if (homeAttack != null && awayAttack != null) {
    const attackGap = clamp((homeAttack - awayAttack) / 100, -0.25, 0.25);
    lambdaH *= 1 + attackGap * 0.16;
    lambdaA *= 1 - attackGap * 0.10;
  }

  // 5) defense rating
  // defense ujemne — im bliżej zera, tym lepiej
  const homeDefense = Number.isFinite(args.homeDefenseRating)
    ? Number(args.homeDefenseRating)
    : null;
  const awayDefense = Number.isFinite(args.awayDefenseRating)
    ? Number(args.awayDefenseRating)
    : null;

  if (homeDefense != null && awayDefense != null) {
    const defenseGap = clamp((homeDefense - awayDefense) / 100, -0.25, 0.25);
    lambdaH *= 1 - defenseGap * 0.14;
    lambdaA *= 1 + defenseGap * 0.14;
  }

  // 6) form rating
  const homeForm = Number.isFinite(args.homeFormRating)
    ? Number(args.homeFormRating)
    : null;
  const awayForm = Number.isFinite(args.awayFormRating)
    ? Number(args.awayFormRating)
    : null;

  if (homeForm != null && awayForm != null) {
    const formGap = clamp((homeForm - awayForm) / 100, -0.25, 0.25);
    lambdaH *= 1 + formGap * 0.10;
    lambdaA *= 1 - formGap * 0.10;
  }

  // 7) końcowe ograniczenie — mniej ekstremów
  lambdaH = clamp(lambdaH, 0.45, 2.85);
  lambdaA = clamp(lambdaA, 0.35, 2.45);

  return { lambdaH, lambdaA };
}

function compute1X2FromLambdas(args: {
  lambdaH: number;
  lambdaA: number;
  drawBoost: number;
  maxGoals: number;
}) {
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

  let p1 = 0,
    pX = 0,
    p2 = 0;

  for (let i = 0; i < ph.length; i++) {
    for (let j = 0; j < pa.length; j++) {
      const p = ph[i] * pa[j];
      if (i > j) p1 += p;
      else if (i === j) pX += p;
      else p2 += p;
    }
  }

  // mocniejszy boost na remis
  pX *= args.drawBoost;

  let s = p1 + pX + p2;
  if (s > 0) {
    p1 /= s;
    pX /= s;
    p2 /= s;
  }

  // market smoothing — mniej skrajne kursy, bliżej realnych buków
  const base1 = 0.42;
  const baseX = 0.28;
  const base2 = 0.30;
  const mix = 0.75;

  p1 = p1 * mix + base1 * (1 - mix);
  pX = pX * mix + baseX * (1 - mix);
  p2 = p2 * mix + base2 * (1 - mix);

  p1 = clamp(p1, 0.03, 0.90);
  pX = clamp(pX, 0.06, 0.50);
  p2 = clamp(p2, 0.03, 0.90);

  const s2 = p1 + pX + p2;
  return { p1: p1 / s2, pX: pX / s2, p2: p2 / s2 };
}

function bookify(prob: number, margin: number) {
  const fairProb = clamp(prob, 0.01, 0.98);
  const fairOdds = 1 / fairProb;

  const bookProb = clamp(fairProb * margin, 0.01, 0.98);
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

// ✅ horyzont w UTC
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

    // ✅ jeśli podano date, blokujemy od razu wszystko > dziś+30 dni
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

    // ✅ LOCK: jeśli UI/Cron odpali równolegle, drugi call nie liczy nic
    const lock = await tryAcquireLock(sb, nowIso);
    if (!lock.ok) {
      return NextResponse.json({
        ok: true,
        skipped: "locked",
        lockAgeMs: lock.ageMs,
        updatedAt: nowIso,
      });
    }

    // ✅ twardy cutoff (żeby route NIGDY nie liczył rzeczy > dziś+30)
    const horizonIso = new Date(
      Date.now() + MAX_AHEAD_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    // ✅ 1) Wybierz kandydatów z DB (matches)
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

    // odetnij mecze “po czasie” (kickoff + grace)
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

    // ✅ 2) “kolejka” wg odds.updated_at:
    // - NULL (brak odds) first
    // - potem najstarszy updated_at
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

    // ✅ 3) Standings ctx per liga
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

    // ✅ 3b) latest team_ratings dla lig z requestu
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

    // ✅ 4) Liczenie + upsert odds
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

      const homeRatingRow = homeId != null ? latestRatings.get(homeId) ?? null : null;
      const awayRatingRow = awayId != null ? latestRatings.get(awayId) ?? null : null;

      const { lambdaH, lambdaA } = computeLambdas({
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
        lambdaH,
        lambdaA,
        drawBoost,
        maxGoals,
      });

      const lambdaT = clamp(lambdaH + lambdaA, 0.2, 8.0);
      const pUnder25 = poissonCdf(lambdaT, 2);
      const pOver25 = 1 - pUnder25;

      const pH0 = Math.exp(-lambdaH);
      const pA0 = Math.exp(-lambdaA);
      const p00 = Math.exp(-(lambdaH + lambdaA));
      const pBttsYes = clamp(1 - pH0 - pA0 + p00, 0.01, 0.98);
      const pBttsNo = 1 - pBttsYes;

      const pHomeUnder15 = poissonCdf(lambdaH, 1);
      const pHomeOver15 = 1 - pHomeUnder15;

      const pAwayUnder05 = poissonCdf(lambdaA, 0);
      const pAwayOver05 = 1 - pAwayUnder05;

      const rows: any[] = [];

      const baseMeta = {
        home_team: homeTeamName,
        away_team: awayTeamName,
      };

      // 1x2
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

      // ou_2_5
      {
        const bOver = bookify(pOver25, margin);
        const bUnder = bookify(pUnder25, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "ou_2_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bOver,
          },
          {
            match_id: matchId,
            market_id: "ou_2_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bUnder,
          }
        );
      }

      // btts
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

      // home_ou_1_5
      {
        const bOver = bookify(pHomeOver15, margin);
        const bUnder = bookify(pHomeUnder15, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "home_ou_1_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bOver,
          },
          {
            match_id: matchId,
            market_id: "home_ou_1_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bUnder,
          }
        );
      }

      // away_ou_0_5
      {
        const bOver = bookify(pAwayOver05, margin);
        const bUnder = bookify(pAwayUnder05, margin);

        rows.push(
          {
            match_id: matchId,
            market_id: "away_ou_0_5",
            selection: "over",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bOver,
          },
          {
            match_id: matchId,
            market_id: "away_ou_0_5",
            selection: "under",
            margin,
            risk_adjustment: 0,
            updated_at: nowIso,
            ...baseMeta,
            ...bUnder,
          }
        );
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
        "Odds computed from DB matches. Queue prioritizes missing odds first, then oldest updated_at. Model uses standings as base and blends latest team_ratings when available. Added shrinkage and smoothing to reduce extreme odds.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error", extra: { stage: "catch" } },
      { status: 500 }
    );
  }
}