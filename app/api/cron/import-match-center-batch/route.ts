// app/api/cron/import-match-center-batch/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireCronSecret } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MATCH_CENTER_IMPORT_PATH = "/api/import/match-center";

const DEFAULT_STATUSES = [
  "SCHEDULED",
  "TIMED",
  "IN_PLAY",
  "PAUSED",
  "LIVE",
  "FINISHED",
] as const;

const DEFAULT_LIMIT = 12;
const DEFAULT_POOL_SIZE = 60;
const DEFAULT_CONCURRENCY = 1;

const DEFAULT_PRE_KICKOFF_MINUTES = 180;
const DEFAULT_POST_KICKOFF_GRACE_MINUTES = 180;
const DEFAULT_FINISHED_LOOKBACK_HOURS = 12;
const DEFAULT_REFRESH_COOLDOWN_MINUTES = 15;

type MatchStatus =
  | "SCHEDULED"
  | "TIMED"
  | "IN_PLAY"
  | "PAUSED"
  | "LIVE"
  | "FINISHED"
  | string;

type MatchRow = {
  id: number;
  utc_date: string;
  status: MatchStatus;
  competition_id: string | null;
  competition_name: string | null;
  home_team: string;
  away_team: string;
};

type MatchLineupRow = {
  match_id: number;
  home_formation: string | null;
  away_formation: string | null;
  home_status: string | null;
  away_status: string | null;
  home_coach: string | null;
  away_coach: string | null;
  updated_at: string | null;
};

type MatchLineupPlayerRow = {
  match_id: number;
};

type MatchTeamStatsRow = {
  match_id: number;
  created_at: string | null;
  shots: number | null;
  shots_on_target: number | null;
  possession: number | null;
  corners: number | null;
  fouls: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
};

type BatchOptions = {
  limit: number;
  poolSize: number;
  concurrency: number;
  force: boolean;
  dryRun: boolean;
  matchIds: number[];
  statuses: string[];
  competitionIds: string[];
  preKickoffMinutes: number;
  postKickoffGraceMinutes: number;
  finishedLookbackHours: number;
  refreshCooldownMinutes: number;
  onlyMissingLineups: boolean;
  onlyMissingStats: boolean;
};

type MatchMeta = {
  hasLineupHeader: boolean;
  lineupPlayersCount: number;
  hasMeaningfulLineups: boolean;
  statsRowsCount: number;
  hasMeaningfulStats: boolean;
  lastAttemptAt: string | null;
};

type Candidate = {
  match: MatchRow;
  meta: MatchMeta;
  eligible: boolean;
  reason: string;
  priority: number;
  minutesToKickoff: number | null;
};

type ResultState = "processed" | "deferred" | "skipped";

type ProcessedResult = {
  state: ResultState;
  matchId: number;
  status: string;
  utcDate: string;
  homeTeam: string;
  awayTeam: string;
  competitionId: string | null;
  eligible: boolean;
  reason: string;
  candidateReason: string | null;
  priority: number;
  minutesToKickoff: number | null;
  hasLineupHeader: boolean;
  lineupPlayersCount: number;
  hasMeaningfulLineups: boolean;
  statsRowsCount: number;
  hasMeaningfulStats: boolean;
  lastAttemptAt: string | null;
  imported: boolean;
  ok: boolean;
  responseStatus: number | null;
  importResult: unknown;
  error: string | null;
};

function clampInt(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function safeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(v)) return true;
    if (["0", "false", "no", "n", "off"].includes(v)) return false;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  return null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueNumbers(values: number[]) {
  return Array.from(new Set(values));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function parseCsvString(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseStatuses(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(
      value.map((item) => safeString(item).trim().toUpperCase())
    );
  }

  if (typeof value === "string") {
    return uniqueStrings(
      parseCsvString(value).map((item) => item.toUpperCase())
    );
  }

  return [];
}

function parseCompetitionIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(
      value.map((item) => safeString(item).trim().toUpperCase())
    );
  }

  if (typeof value === "string") {
    return uniqueStrings(
      parseCsvString(value).map((item) => item.toUpperCase())
    );
  }

  return [];
}

function parseMatchIds(singleValue: unknown, multiValue: unknown): number[] {
  const values: number[] = [];

  const pushNumber = (input: unknown) => {
    const n = safeNumber(input);
    if (n !== null) values.push(n);
  };

  pushNumber(singleValue);

  if (Array.isArray(multiValue)) {
    for (const item of multiValue) pushNumber(item);
  } else if (typeof multiValue === "string") {
    for (const item of parseCsvString(multiValue)) pushNumber(item);
  }

  return uniqueNumbers(values);
}

function pickValue(
  queryValue: string | null,
  bodyValue: unknown
): string | unknown | null {
  if (bodyValue !== undefined) return bodyValue;
  return queryValue;
}

async function readOptions(request: NextRequest): Promise<BatchOptions> {
  const sp = request.nextUrl.searchParams;

  let body: Record<string, unknown> = {};
  if (request.method !== "GET") {
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = {};
    }
  }

  const limitRaw = pickValue(sp.get("limit"), body.limit);
  const poolSizeRaw = pickValue(sp.get("poolSize"), body.poolSize);
  const concurrencyRaw = pickValue(sp.get("concurrency"), body.concurrency);

  const forceRaw = pickValue(sp.get("force"), body.force);
  const dryRunRaw = pickValue(sp.get("dryRun"), body.dryRun);

  const preKickoffRaw = pickValue(
    sp.get("preKickoffMinutes"),
    body.preKickoffMinutes
  );
  const postKickoffRaw = pickValue(
    sp.get("postKickoffGraceMinutes"),
    body.postKickoffGraceMinutes
  );
  const finishedLookbackRaw = pickValue(
    sp.get("finishedLookbackHours"),
    body.finishedLookbackHours
  );
  const refreshCooldownRaw = pickValue(
    sp.get("refreshCooldownMinutes"),
    body.refreshCooldownMinutes
  );

  const statusesRaw = pickValue(sp.get("statuses"), body.statuses);
  const competitionIdsRaw = pickValue(
    sp.get("competitionIds"),
    body.competitionIds
  );

  const matchIdRaw = pickValue(sp.get("matchId"), body.matchId);
  const matchIdsRaw = pickValue(sp.get("matchIds"), body.matchIds);

  const onlyMissingLineupsRaw = pickValue(
    sp.get("onlyMissingLineups"),
    body.onlyMissingLineups
  );
  const onlyMissingStatsRaw = pickValue(
    sp.get("onlyMissingStats"),
    body.onlyMissingStats
  );

  const parsedLimit = safeNumber(limitRaw);
  const parsedPoolSize = safeNumber(poolSizeRaw);
  const parsedConcurrency = safeNumber(concurrencyRaw);

  const parsedPreKickoff = safeNumber(preKickoffRaw);
  const parsedPostKickoff = safeNumber(postKickoffRaw);
  const parsedFinishedLookback = safeNumber(finishedLookbackRaw);
  const parsedRefreshCooldown = safeNumber(refreshCooldownRaw);

  const parsedForce = safeBoolean(forceRaw);
  const parsedDryRun = safeBoolean(dryRunRaw);
  const parsedOnlyMissingLineups = safeBoolean(onlyMissingLineupsRaw);
  const parsedOnlyMissingStats = safeBoolean(onlyMissingStatsRaw);

  const matchIds = parseMatchIds(matchIdRaw, matchIdsRaw);
  const statuses = parseStatuses(statusesRaw);
  const competitionIds = parseCompetitionIds(competitionIdsRaw);

  const limit = clampInt(parsedLimit ?? DEFAULT_LIMIT, 1, 100);
  const poolSize = clampInt(
    parsedPoolSize ?? Math.max(DEFAULT_POOL_SIZE, limit * 5),
    limit,
    300
  );
  const concurrency = clampInt(parsedConcurrency ?? DEFAULT_CONCURRENCY, 1, 5);

  return {
    limit,
    poolSize,
    concurrency,
    force: parsedForce ?? false,
    dryRun: parsedDryRun ?? false,
    matchIds,
    statuses: statuses.length ? statuses : [...DEFAULT_STATUSES],
    competitionIds,
    preKickoffMinutes: clampInt(
      parsedPreKickoff ?? DEFAULT_PRE_KICKOFF_MINUTES,
      0,
      1440
    ),
    postKickoffGraceMinutes: clampInt(
      parsedPostKickoff ?? DEFAULT_POST_KICKOFF_GRACE_MINUTES,
      0,
      1440
    ),
    finishedLookbackHours: clampInt(
      parsedFinishedLookback ?? DEFAULT_FINISHED_LOOKBACK_HOURS,
      1,
      168
    ),
    refreshCooldownMinutes: clampInt(
      parsedRefreshCooldown ?? DEFAULT_REFRESH_COOLDOWN_MINUTES,
      0,
      1440
    ),
    onlyMissingLineups: parsedOnlyMissingLineups ?? false,
    onlyMissingStats: parsedOnlyMissingStats ?? false,
  };
}

function resolveBaseUrl(request: NextRequest): string {
  const origin = request.nextUrl?.origin;
  if (origin && origin !== "null") return origin;

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.APP_URL;

  if (siteUrl && siteUrl.trim()) {
    return siteUrl.replace(/\/+$/, "");
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

function resolveInternalCronSecret(request: NextRequest): string | null {
  const fromHeader = request.headers.get("x-cron-secret");
  if (fromHeader && fromHeader.trim()) return fromHeader.trim();

  const fromEnv =
    process.env.CRON_SECRET ||
    process.env.CRON_SECRET_HEADER ||
    process.env.MATCH_CENTER_CRON_SECRET;

  return fromEnv && fromEnv.trim() ? fromEnv.trim() : null;
}

function isLiveStatus(status: string) {
  return ["IN_PLAY", "PAUSED", "LIVE"].includes(status);
}

function isScheduledStatus(status: string) {
  return ["SCHEDULED", "TIMED"].includes(status);
}

function isFinishedStatus(status: string) {
  return status === "FINISHED";
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function hasMeaningfulLineupHeader(row: MatchLineupRow | undefined): boolean {
  if (!row) return false;

  return [
    row.home_formation,
    row.away_formation,
    row.home_status,
    row.away_status,
    row.home_coach,
    row.away_coach,
  ].some((value) => isNonEmptyString(value));
}

function hasMeaningfulStatsRows(rows: MatchTeamStatsRow[]): boolean {
  return rows.some((row) =>
    [
      row.shots,
      row.shots_on_target,
      row.possession,
      row.corners,
      row.fouls,
      row.yellow_cards,
      row.red_cards,
    ].some((value) => value !== null)
  );
}

function maxIsoDate(values: Array<string | null | undefined>): string | null {
  let max: number | null = null;

  for (const value of values) {
    const t = parseDateMs(value ?? null);
    if (t === null) continue;
    if (max === null || t > max) max = t;
  }

  return max === null ? null : new Date(max).toISOString();
}

function minutesBetween(fromIso: string | null, toMs: number): number | null {
  const fromMs = parseDateMs(fromIso);
  if (fromMs === null) return null;
  return Math.floor((toMs - fromMs) / 60000);
}

function buildMeta(
  matchId: number,
  lineupMap: Map<number, MatchLineupRow>,
  playerCountMap: Map<number, number>,
  statsMap: Map<number, MatchTeamStatsRow[]>
): MatchMeta {
  const lineup = lineupMap.get(matchId);
  const statsRows = statsMap.get(matchId) ?? [];
  const statsCreatedAtValues = statsRows.map((row) => row.created_at);

  const lineupPlayersCount = playerCountMap.get(matchId) ?? 0;
  const hasLineupHeader = Boolean(lineup);
  const hasMeaningfulLineups =
    lineupPlayersCount > 0 || hasMeaningfulLineupHeader(lineup);
  const hasMeaningfulStats = hasMeaningfulStatsRows(statsRows);

  return {
    hasLineupHeader,
    lineupPlayersCount,
    hasMeaningfulLineups,
    statsRowsCount: statsRows.length,
    hasMeaningfulStats,
    lastAttemptAt: maxIsoDate([lineup?.updated_at ?? null, ...statsCreatedAtValues]),
  };
}

function buildCandidate(
  match: MatchRow,
  meta: MatchMeta,
  options: BatchOptions,
  nowMs: number
): Candidate {
  const status = safeString(match.status).trim().toUpperCase();
  const kickoffMs = parseDateMs(match.utc_date);
  const minutesToKickoff =
    kickoffMs === null ? null : Math.floor((kickoffMs - nowMs) / 60000);

  const cooldownAgeMinutes = minutesBetween(meta.lastAttemptAt, nowMs);
  const isCoolingDown =
    cooldownAgeMinutes !== null &&
    cooldownAgeMinutes < options.refreshCooldownMinutes;

  const isExplicitMatchSelection = options.matchIds.length > 0;

  if (!options.statuses.includes(status)) {
    return {
      match,
      meta,
      eligible: false,
      reason: "status_not_included",
      priority: 999999,
      minutesToKickoff,
    };
  }

  if (options.force || isExplicitMatchSelection) {
    return {
      match,
      meta,
      eligible: true,
      reason: options.force ? "forced_match" : "explicit_match",
      priority: 0,
      minutesToKickoff,
    };
  }

  if (options.onlyMissingLineups && meta.hasMeaningfulLineups) {
    return {
      match,
      meta,
      eligible: false,
      reason: "lineups_already_present",
      priority: 999999,
      minutesToKickoff,
    };
  }

  if (options.onlyMissingStats && meta.hasMeaningfulStats) {
    return {
      match,
      meta,
      eligible: false,
      reason: "stats_already_present",
      priority: 999999,
      minutesToKickoff,
    };
  }

  if (isScheduledStatus(status)) {
    if (minutesToKickoff === null) {
      return {
        match,
        meta,
        eligible: false,
        reason: "invalid_kickoff_time",
        priority: 999999,
        minutesToKickoff,
      };
    }

    if (minutesToKickoff > options.preKickoffMinutes) {
      return {
        match,
        meta,
        eligible: false,
        reason: "too_early_before_kickoff",
        priority: 999999,
        minutesToKickoff,
      };
    }

    if (minutesToKickoff < -options.postKickoffGraceMinutes) {
      return {
        match,
        meta,
        eligible: false,
        reason: "scheduled_window_expired",
        priority: 999999,
        minutesToKickoff,
      };
    }

    if (!options.onlyMissingLineups && meta.hasMeaningfulLineups) {
      return {
        match,
        meta,
        eligible: false,
        reason: "lineups_already_present",
        priority: 999999,
        minutesToKickoff,
      };
    }

    if (isCoolingDown) {
      return {
        match,
        meta,
        eligible: false,
        reason: "cooldown_active",
        priority: 999999,
        minutesToKickoff,
      };
    }

    return {
      match,
      meta,
      eligible: true,
      reason: "scheduled_candidate",
      priority: Math.max(0, Math.abs(minutesToKickoff)),
      minutesToKickoff,
    };
  }

  if (isLiveStatus(status)) {
    if (isCoolingDown) {
      return {
        match,
        meta,
        eligible: false,
        reason: "cooldown_active",
        priority: 999999,
        minutesToKickoff,
      };
    }

    return {
      match,
      meta,
      eligible: true,
      reason: "live_candidate",
      priority: 0,
      minutesToKickoff,
    };
  }

  if (isFinishedStatus(status)) {
    if (minutesToKickoff === null) {
      return {
        match,
        meta,
        eligible: false,
        reason: "invalid_kickoff_time",
        priority: 999999,
        minutesToKickoff,
      };
    }

    const minutesSinceKickoff = Math.abs(minutesToKickoff);

    if (minutesSinceKickoff > options.finishedLookbackHours * 60) {
      return {
        match,
        meta,
        eligible: false,
        reason: "finished_match_too_old",
        priority: 999999,
        minutesToKickoff,
      };
    }

    if (!options.onlyMissingLineups && !options.onlyMissingStats) {
      if (meta.hasMeaningfulLineups && meta.hasMeaningfulStats) {
        return {
          match,
          meta,
          eligible: false,
          reason: "finished_data_already_complete",
          priority: 999999,
          minutesToKickoff,
        };
      }
    }

    if (isCoolingDown) {
      return {
        match,
        meta,
        eligible: false,
        reason: "cooldown_active",
        priority: 999999,
        minutesToKickoff,
      };
    }

    return {
      match,
      meta,
      eligible: true,
      reason: "finished_candidate",
      priority: 10 + minutesSinceKickoff,
      minutesToKickoff,
    };
  }

  return {
    match,
    meta,
    eligible: false,
    reason: "unsupported_status",
    priority: 999999,
    minutesToKickoff,
  };
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runner() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length || 1) },
    () => runner()
  );

  await Promise.all(workers);
  return results;
}

async function callSingleMatchImport(
  request: NextRequest,
  matchId: number
): Promise<{
  ok: boolean;
  responseStatus: number;
  importResult: unknown;
  error: string | null;
}> {
  const baseUrl = resolveBaseUrl(request);
  const secret = resolveInternalCronSecret(request);

  if (!secret) {
    return {
      ok: false,
      responseStatus: 500,
      importResult: null,
      error: "Missing CRON secret for internal import call.",
    };
  }

  try {
    const response = await fetch(`${baseUrl}${MATCH_CENTER_IMPORT_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": secret,
      },
      body: JSON.stringify({ matchId }),
      cache: "no-store",
    });

    const rawText = await response.text();

    let parsed: unknown = rawText;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = rawText;
    }

    return {
      ok: response.ok,
      responseStatus: response.status,
      importResult: parsed,
      error: response.ok ? null : safeString((parsed as any)?.error, rawText),
    };
  } catch (error) {
    return {
      ok: false,
      responseStatus: 500,
      importResult: null,
      error:
        error instanceof Error ? error.message : "Unknown internal fetch error",
    };
  }
}

async function fetchMatches(
  options: BatchOptions,
  nowMs: number
): Promise<MatchRow[]> {
  const sb = supabaseAdmin();

  if (options.matchIds.length > 0) {
    let query = sb
      .from("matches")
      .select(
        "id, utc_date, status, competition_id, competition_name, home_team, away_team"
      )
      .in("id", options.matchIds)
      .order("utc_date", { ascending: true });

    if (options.competitionIds.length > 0) {
      query = query.in("competition_id", options.competitionIds);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to load matches by ids: ${error.message}`);
    }

    return (data ?? []) as MatchRow[];
  }

  const lookbackMinutes = Math.max(
    options.finishedLookbackHours * 60,
    options.postKickoffGraceMinutes
  );

  const windowStart = new Date(nowMs - lookbackMinutes * 60000).toISOString();
  const windowEnd = new Date(
    nowMs + options.preKickoffMinutes * 60000
  ).toISOString();

  let query = sb
    .from("matches")
    .select(
      "id, utc_date, status, competition_id, competition_name, home_team, away_team"
    )
    .in("status", options.statuses)
    .gte("utc_date", windowStart)
    .lte("utc_date", windowEnd)
    .order("utc_date", { ascending: true })
    .limit(options.poolSize);

  if (options.competitionIds.length > 0) {
    query = query.in("competition_id", options.competitionIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load recent matches: ${error.message}`);
  }

  return (data ?? []) as MatchRow[];
}

async function fetchMetaForMatches(matchIds: number[]) {
  const sb = supabaseAdmin();

  if (!matchIds.length) {
    return {
      lineupMap: new Map<number, MatchLineupRow>(),
      playerCountMap: new Map<number, number>(),
      statsMap: new Map<number, MatchTeamStatsRow[]>(),
    };
  }

  const [
    { data: lineupData, error: lineupError },
    { data: playerData, error: playerError },
    { data: statsData, error: statsError },
  ] = await Promise.all([
    sb
      .from("match_lineups")
      .select(
        "match_id, home_formation, away_formation, home_status, away_status, home_coach, away_coach, updated_at"
      )
      .in("match_id", matchIds),

    sb
      .from("match_lineup_players")
      .select("match_id")
      .in("match_id", matchIds),

    sb
      .from("match_team_stats")
      .select(
        "match_id, created_at, shots, shots_on_target, possession, corners, fouls, yellow_cards, red_cards"
      )
      .in("match_id", matchIds),
  ]);

  if (lineupError) {
    throw new Error(`Failed to load match_lineups: ${lineupError.message}`);
  }

  if (playerError) {
    throw new Error(
      `Failed to load match_lineup_players: ${playerError.message}`
    );
  }

  if (statsError) {
    throw new Error(`Failed to load match_team_stats: ${statsError.message}`);
  }

  const lineupMap = new Map<number, MatchLineupRow>();
  for (const row of (lineupData ?? []) as MatchLineupRow[]) {
    lineupMap.set(row.match_id, row);
  }

  const playerCountMap = new Map<number, number>();
  for (const row of (playerData ?? []) as MatchLineupPlayerRow[]) {
    playerCountMap.set(row.match_id, (playerCountMap.get(row.match_id) ?? 0) + 1);
  }

  const statsMap = new Map<number, MatchTeamStatsRow[]>();
  for (const row of (statsData ?? []) as MatchTeamStatsRow[]) {
    const list = statsMap.get(row.match_id) ?? [];
    list.push(row);
    statsMap.set(row.match_id, list);
  }

  return { lineupMap, playerCountMap, statsMap };
}

function summarizeByReason(results: ProcessedResult[]) {
  const summary: Record<string, number> = {};

  for (const row of results) {
    summary[row.reason] = (summary[row.reason] ?? 0) + 1;
  }

  return summary;
}

function summarizeByState(results: ProcessedResult[]) {
  const summary: Record<string, number> = {};

  for (const row of results) {
    summary[row.state] = (summary[row.state] ?? 0) + 1;
  }

  return summary;
}

async function handleRequest(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  try {
    const options = await readOptions(request);
    const nowMs = Date.now();

    const matches = await fetchMatches(options, nowMs);
    const matchIds = matches.map((match) => match.id);

    const { lineupMap, playerCountMap, statsMap } = await fetchMetaForMatches(
      matchIds
    );

    const candidates = matches
      .map((match) => {
        const meta = buildMeta(match.id, lineupMap, playerCountMap, statsMap);
        return buildCandidate(match, meta, options, nowMs);
      })
      .sort((a, b) => a.priority - b.priority);

    const eligibleAll = candidates.filter((item) => item.eligible);
    const toProcess = eligibleAll.slice(0, options.limit);
    const deferred = eligibleAll.slice(options.limit);
    const skipped = candidates.filter((item) => !item.eligible);

    const processed = await runWithConcurrency(
      toProcess,
      options.concurrency,
      async (candidate): Promise<ProcessedResult> => {
        const base: ProcessedResult = {
          state: "processed",
          matchId: candidate.match.id,
          status: safeString(candidate.match.status).toUpperCase(),
          utcDate: candidate.match.utc_date,
          homeTeam: candidate.match.home_team,
          awayTeam: candidate.match.away_team,
          competitionId: candidate.match.competition_id,
          eligible: true,
          reason: candidate.reason,
          candidateReason: candidate.reason,
          priority: candidate.priority,
          minutesToKickoff: candidate.minutesToKickoff,
          hasLineupHeader: candidate.meta.hasLineupHeader,
          lineupPlayersCount: candidate.meta.lineupPlayersCount,
          hasMeaningfulLineups: candidate.meta.hasMeaningfulLineups,
          statsRowsCount: candidate.meta.statsRowsCount,
          hasMeaningfulStats: candidate.meta.hasMeaningfulStats,
          lastAttemptAt: candidate.meta.lastAttemptAt,
          imported: false,
          ok: false,
          responseStatus: null,
          importResult: null,
          error: null,
        };

        if (options.dryRun) {
          return {
            ...base,
            imported: false,
            ok: true,
            responseStatus: 200,
            importResult: { dryRun: true },
          };
        }

        const call = await callSingleMatchImport(request, candidate.match.id);

        return {
          ...base,
          imported: call.ok,
          ok: call.ok,
          responseStatus: call.responseStatus,
          importResult: call.importResult,
          error: call.error,
        };
      }
    );

    const deferredResults: ProcessedResult[] = deferred.map((candidate) => ({
      state: "deferred",
      matchId: candidate.match.id,
      status: safeString(candidate.match.status).toUpperCase(),
      utcDate: candidate.match.utc_date,
      homeTeam: candidate.match.home_team,
      awayTeam: candidate.match.away_team,
      competitionId: candidate.match.competition_id,
      eligible: true,
      reason: "deferred_by_limit",
      candidateReason: candidate.reason,
      priority: candidate.priority,
      minutesToKickoff: candidate.minutesToKickoff,
      hasLineupHeader: candidate.meta.hasLineupHeader,
      lineupPlayersCount: candidate.meta.lineupPlayersCount,
      hasMeaningfulLineups: candidate.meta.hasMeaningfulLineups,
      statsRowsCount: candidate.meta.statsRowsCount,
      hasMeaningfulStats: candidate.meta.hasMeaningfulStats,
      lastAttemptAt: candidate.meta.lastAttemptAt,
      imported: false,
      ok: false,
      responseStatus: null,
      importResult: null,
      error: null,
    }));

    const skippedResults: ProcessedResult[] = skipped.map((candidate) => ({
      state: "skipped",
      matchId: candidate.match.id,
      status: safeString(candidate.match.status).toUpperCase(),
      utcDate: candidate.match.utc_date,
      homeTeam: candidate.match.home_team,
      awayTeam: candidate.match.away_team,
      competitionId: candidate.match.competition_id,
      eligible: false,
      reason: candidate.reason,
      candidateReason: candidate.reason,
      priority: candidate.priority,
      minutesToKickoff: candidate.minutesToKickoff,
      hasLineupHeader: candidate.meta.hasLineupHeader,
      lineupPlayersCount: candidate.meta.lineupPlayersCount,
      hasMeaningfulLineups: candidate.meta.hasMeaningfulLineups,
      statsRowsCount: candidate.meta.statsRowsCount,
      hasMeaningfulStats: candidate.meta.hasMeaningfulStats,
      lastAttemptAt: candidate.meta.lastAttemptAt,
      imported: false,
      ok: false,
      responseStatus: null,
      importResult: null,
      error: null,
    }));

    const allResults = [...processed, ...deferredResults, ...skippedResults];

    const importedCount = processed.filter((row) => row.imported).length;
    const failedCount = processed.filter((row) => !row.ok).length;

    return NextResponse.json(
      {
        ok: true,
        nowUtc: new Date(nowMs).toISOString(),
        options,
        totals: {
          fetchedMatches: matches.length,
          eligibleMatches: eligibleAll.length,
          processedMatches: processed.length,
          deferredMatches: deferredResults.length,
          skippedMatches: skippedResults.length,
          importedMatches: importedCount,
          failedMatches: failedCount,
          dryRun: options.dryRun,
        },
        summaryByState: summarizeByState(allResults),
        summaryByReason: summarizeByReason(allResults),
        results: allResults,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handleRequest(request);
}

export async function POST(request: NextRequest) {
  return handleRequest(request);
}
