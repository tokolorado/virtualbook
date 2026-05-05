// app/api/admin/bsd/matches/sync/route.ts

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { bsdFetchPaginated, normalizeBsdText } from "@/lib/bsd/client";
import {
  buildBsdEventFeaturesSnapshot,
  buildModelOddsInputs,
  buildPricingFeatureSnapshot,
  BSD_PRICING_MODEL_VERSION,
} from "@/lib/bsd/pricingModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYNTHETIC_ID_OFFSET = 900_000_000;
const DEFAULT_TIMEZONE = "Europe/Warsaw";
const NON_EXCLUSIVE_MARKET_IDS = new Set(["dc", "ht_dc"]);

type UnknownRecord = Record<string, unknown>;

type AuthResult = { ok: true } | { ok: false; response: Response };

type ProviderLeagueRow = {
  app_code: string;
  name: string | null;
  provider_league_id: number | string | null;
  provider_season_id: number | string | null;
  enabled: boolean | null;
  sort_order: number | null;
};

type ExistingMatchRow = {
  id: number;
  utc_date: string;
  competition_id: string;
  home_team: string;
  away_team: string;
  home_team_id: number | null;
  away_team_id: number | null;
  source: string | null;
  source_event_id: string | null;
};

type ExistingMatchCandidate = {
  existingMatchId: number;
  confidence: "source_event" | "exact" | "strong" | "weak";
  score: number;
  timeDiffMinutes: number;
  homeSimilarity: number;
  awaySimilarity: number;
  existingHome: string;
  existingAway: string;
};

type MatchUpsertRow = {
  id: number;
  competition_id: string;
  competition_name: string | null;
  utc_date: string;
  status: string;
  matchday: number | null;
  season: string | null;
  home_team: string;
  away_team: string;
  home_team_id: number | null;
  away_team_id: number | null;
  home_score: number | null;
  away_score: number | null;
  minute: number | null;
  injury_time: number | null;
  last_sync_at: string;

  source: string;
  source_event_id: string;
  source_league_id: string | null;
  source_season_id: string | null;
  source_status: string | null;
  source_round_name: string | null;
  group_name: string | null;

  home_short_name: string | null;
  away_short_name: string | null;
  home_country: string | null;
  away_country: string | null;

  venue_id: number | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_country: string | null;
  venue_capacity: number | null;
  venue_latitude: number | null;
  venue_longitude: number | null;

  home_coach_name: string | null;
  away_coach_name: string | null;
  referee: string | null;

  is_neutral_ground: boolean | null;
  is_local_derby: boolean | null;
  travel_distance_km: number | null;
  weather_code: string | null;
  wind_speed: number | null;
  temperature_c: number | null;
  pitch_condition: string | null;
  attendance: number | null;

  raw_bsd: UnknownRecord;
};

type OddsInput = {
  marketId: string;
  selection: string;
  field: string;
  bookOdds: number;
  fairProbability?: number;
  pricingMargin?: number;
};

type OddsUpsertRow = {
  match_id: number;
  market_id: string;
  selection: string;

  fair_prob: number;
  fair_odds: number;
  book_odds: number;
  book_prob: number;
  is_model: boolean;

  margin: number;
  risk_adjustment: number;
  implied_probability: number;

  home_team: string | null;
  away_team: string | null;

  source: string;
  source_event_id: string;
  pricing_method: string;
  raw_count: number;

  updated_at: string;
  provider_fetched_at: string;
  raw_source: UnknownRecord;
};

type MatchResultSyncRow = {
  match_id: number;
  status: "FINISHED";
  home_score: number;
  away_score: number;
  ht_home_score: number | null;
  ht_away_score: number | null;
  sh_home_score: number | null;
  sh_away_score: number | null;
  started_at: string | null;
  finished_at: string;
  updated_at: string;
};

type ExistingMatchResultRow = {
  match_id: number | string;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  ht_home_score: number | null;
  ht_away_score: number | null;
  sh_home_score: number | null;
  sh_away_score: number | null;
};

type MatchResultsSyncStats = {
  attempted: number;
  inserted: number;
  updated: number;
  unchanged: number;
};

function jsonError(
  message: string,
  status = 500,
  extra?: Record<string, unknown>
): Response {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

function requireCronSecret(req: Request): AuthResult {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return {
      ok: false,
      response: jsonError("Missing CRON_SECRET in env", 500),
    };
  }

  const provided = req.headers.get("x-cron-secret");

  if (provided !== expected) {
    return {
      ok: false,
      response: jsonError("Unauthorized", 401),
    };
  }

  return { ok: true };
}

function getSupabaseAdmin() {
  return supabaseAdmin();
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(obj: UnknownRecord, key: string): UnknownRecord | null {
  const value = obj[key];
  return isRecord(value) ? value : null;
}

function readString(obj: UnknownRecord, key: string): string | null {
  const value = obj[key];

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function readNumber(obj: UnknownRecord, key: string): number | null {
  const value = obj[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readPositiveOdd(obj: UnknownRecord, key: string): number | null {
  const value = readNumber(obj, key);

  if (value === null) return null;
  if (!Number.isFinite(value) || value <= 1) return null;

  return value;
}

function readInt(obj: UnknownRecord, key: string): number | null {
  const value = readNumber(obj, key);
  return value === null ? null : Math.trunc(value);
}

function readBool(obj: UnknownRecord, key: string): boolean | null {
  const value = obj[key];

  if (typeof value === "boolean") return value;
  return null;
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const map = new Map<string, T>();

  for (const item of items) {
    map.set(keyFn(item), item);
  }

  return Array.from(map.values());
}

function dedupeEventsByBsdId(events: UnknownRecord[]): {
  events: UnknownRecord[];
  duplicateEventIds: string[];
} {
  const byId = new Map<string, UnknownRecord>();
  const duplicateEventIds = new Set<string>();

  for (const event of events) {
    const id = readString(event, "id");

    if (!id) {
      continue;
    }

    if (byId.has(id)) {
      duplicateEventIds.add(id);
    }

    byId.set(id, event);
  }

  return {
    events: Array.from(byId.values()),
    duplicateEventIds: Array.from(duplicateEventIds).sort(),
  };
}

function normalizeStatus(status: string | null): string {
  const raw = status ?? "";
  const s = normalizeBsdText(raw);
  const compact = s.replace(/[\s_-]+/g, "");

  if (!s) return "TIMED";

  if (
    [
      "notstarted",
      "not_started",
      "not started",
      "scheduled",
      "timed",
      "fixture",
      "pre match",
      "pre_match",
      "prematch",
    ].includes(s) ||
    ["notstarted", "scheduled", "timed", "fixture", "prematch"].includes(compact)
  ) {
    return "TIMED";
  }

  if (
    [
      "live",
      "inplay",
      "in_play",
      "in play",
      "1sthalf",
      "1st half",
      "firsthalf",
      "first half",
      "2ndhalf",
      "2nd half",
      "secondhalf",
      "second half",
    ].includes(s) ||
    [
      "live",
      "inplay",
      "1sthalf",
      "firsthalf",
      "2ndhalf",
      "secondhalf",
    ].includes(compact)
  ) {
    return "IN_PLAY";
  }

  if (
    [
      "halftime",
      "half_time",
      "half time",
      "ht",
      "paused",
      "break",
      "interval",
    ].includes(s) ||
    ["halftime", "ht", "paused", "break", "interval"].includes(compact)
  ) {
    return "PAUSED";
  }

  if (
    ["finished", "ended", "ft", "fulltime", "full_time", "full time"].includes(
      s
    ) ||
    ["finished", "ended", "ft", "fulltime"].includes(compact)
  ) {
    return "FINISHED";
  }

  if (["cancelled", "canceled"].includes(s)) return "CANCELLED";
  if (s === "postponed") return "POSTPONED";
  if (s === "suspended") return "SUSPENDED";
  if (s === "awarded") return "AWARDED";

  return "TIMED";
}

function isFinishedStatus(status: string): boolean {
  return status === "FINISHED";
}

function isLiveStatus(status: string): boolean {
  return status === "IN_PLAY" || status === "PAUSED";
}

function addDaysYmd(dateYYYYMMDD: string, days: number): string {
  const [year, month, day] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));

  dt.setUTCDate(dt.getUTCDate() + days);

  return dt.toISOString().slice(0, 10);
}

function parseEventUtcDate(eventDate: string | null): string | null {
  if (!eventDate) return null;

  const dt = new Date(eventDate);
  if (!Number.isFinite(dt.getTime())) return null;

  return dt.toISOString();
}

function normalizeTeamName(name: string): string {
  const base = normalizeBsdText(name)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      (part) =>
        !["fc", "cf", "afc", "sc", "club", "de", "da", "do", "the"].includes(
          part
        )
    )
    .join(" ");

  return base.trim();
}

function diceSimilarity(aRaw: string, bRaw: string): number {
  const a = normalizeTeamName(aRaw);
  const b = normalizeTeamName(bRaw);

  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.95;

  const bigrams = (value: string) => {
    const compact = value.replace(/\s+/g, "");
    const result: string[] = [];

    for (let i = 0; i < compact.length - 1; i += 1) {
      result.push(compact.slice(i, i + 2));
    }

    return result;
  };

  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);

  if (!aBigrams.length || !bBigrams.length) return 0;

  const counts = new Map<string, number>();

  for (const bg of aBigrams) {
    counts.set(bg, (counts.get(bg) ?? 0) + 1);
  }

  let matches = 0;

  for (const bg of bBigrams) {
    const current = counts.get(bg) ?? 0;

    if (current > 0) {
      matches += 1;
      counts.set(bg, current - 1);
    }
  }

  return (2 * matches) / (aBigrams.length + bBigrams.length);
}

function findExistingMatch(args: {
  eventId: string;
  appCode: string;
  utcDate: string;
  homeTeam: string;
  awayTeam: string;
  existingMatches: ExistingMatchRow[];
}): ExistingMatchCandidate | null {
  const bySource = args.existingMatches.find(
    (match) => match.source === "bsd" && match.source_event_id === args.eventId
  );

  if (bySource) {
    return {
      existingMatchId: bySource.id,
      confidence: "source_event",
      score: 1,
      timeDiffMinutes: 0,
      homeSimilarity: 1,
      awaySimilarity: 1,
      existingHome: bySource.home_team,
      existingAway: bySource.away_team,
    };
  }

  const eventMs = Date.parse(args.utcDate);
  if (!Number.isFinite(eventMs)) return null;

  let best: ExistingMatchCandidate | null = null;

  for (const match of args.existingMatches) {
    if (match.competition_id !== args.appCode) continue;

    const matchMs = Date.parse(match.utc_date);
    if (!Number.isFinite(matchMs)) continue;

    const timeDiffMinutes = Math.abs(eventMs - matchMs) / 60_000;
    if (timeDiffMinutes > 180) continue;

    const homeSimilarity = diceSimilarity(args.homeTeam, match.home_team);
    const awaySimilarity = diceSimilarity(args.awayTeam, match.away_team);

    if (homeSimilarity < 0.72 || awaySimilarity < 0.72) continue;

    const timeScore = Math.max(0, 1 - timeDiffMinutes / 180);
    const score = homeSimilarity * 0.4 + awaySimilarity * 0.4 + timeScore * 0.2;

    const confidence: ExistingMatchCandidate["confidence"] =
      timeDiffMinutes <= 5 && homeSimilarity >= 0.9 && awaySimilarity >= 0.9
        ? "exact"
        : score >= 0.86
          ? "strong"
          : "weak";

    const candidate: ExistingMatchCandidate = {
      existingMatchId: match.id,
      confidence,
      score,
      timeDiffMinutes,
      homeSimilarity,
      awaySimilarity,
      existingHome: match.home_team,
      existingAway: match.away_team,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  if (!best) return null;
  if (best.confidence === "weak") return null;

  return best;
}

function readProviderLeagueId(event: UnknownRecord): number | null {
  const league = readRecord(event, "league");
  if (!league) return null;

  return readInt(league, "id");
}

function readProviderSeasonId(event: UnknownRecord): string | null {
  const season = readRecord(event, "season");

  if (season) {
    const seasonId = readString(season, "id");
    if (seasonId) return seasonId;
  }

  const league = readRecord(event, "league");
  const currentSeason = league ? readRecord(league, "current_season") : null;

  if (currentSeason) {
    return readString(currentSeason, "id");
  }

  return null;
}

function readSeasonYear(event: UnknownRecord): string | null {
  const season = readRecord(event, "season");

  if (season) {
    const year = readString(season, "year");
    if (year) return year;
  }

  const league = readRecord(event, "league");
  const currentSeason = league ? readRecord(league, "current_season") : null;

  if (currentSeason) {
    const year = readString(currentSeason, "year");
    if (year) return year;
  }

  return null;
}

function readTeamObject(
  event: UnknownRecord,
  side: "home" | "away"
): UnknownRecord | null {
  return readRecord(event, `${side}_team_obj`);
}

function readTeamName(event: UnknownRecord, side: "home" | "away"): string | null {
  const direct = readString(event, `${side}_team`);
  if (direct) return direct;

  const teamObj = readTeamObject(event, side);
  return teamObj ? readString(teamObj, "name") : null;
}

function readTeamId(event: UnknownRecord, side: "home" | "away"): number | null {
  const teamObj = readTeamObject(event, side);
  return teamObj ? readInt(teamObj, "id") : null;
}

function readCoachName(
  event: UnknownRecord,
  side: "home" | "away"
): string | null {
  const directCoach = readRecord(event, `${side}_coach`);

  if (directCoach) {
    const directName = readString(directCoach, "name");
    if (directName) return directName;
  }

  const teamObj = readTeamObject(event, side);
  const nestedCoach = teamObj ? readRecord(teamObj, "coach") : null;

  if (!nestedCoach) return null;

  return readString(nestedCoach, "name") ?? readString(nestedCoach, "shortName");
}

function readVenue(event: UnknownRecord): UnknownRecord | null {
  const venue = readRecord(event, "venue");
  if (venue) return venue;

  const homeTeamObj = readTeamObject(event, "home");
  return homeTeamObj ? readRecord(homeTeamObj, "venue") : null;
}

function syntheticMatchId(eventId: number): number {
  return SYNTHETIC_ID_OFFSET + eventId;
}

function buildMatchRow(args: {
  event: UnknownRecord;
  league: ProviderLeagueRow;
  existingMatch: ExistingMatchCandidate | null;
  fetchedAt: string;
}): MatchUpsertRow | null {
  const eventIdNumber = readInt(args.event, "id");
  if (eventIdNumber === null) return null;

  const sourceEventId = String(eventIdNumber);
  const utcDate = parseEventUtcDate(readString(args.event, "event_date"));
  if (!utcDate) return null;

  const homeTeam = readTeamName(args.event, "home");
  const awayTeam = readTeamName(args.event, "away");
  if (!homeTeam || !awayTeam) return null;

  const rawStatus = readString(args.event, "status");
  const status = normalizeStatus(rawStatus);

  const venue = readVenue(args.event);
  const homeTeamObj = readTeamObject(args.event, "home");
  const awayTeamObj = readTeamObject(args.event, "away");

  const scoreAllowed = isFinishedStatus(status) || isLiveStatus(status);

  return {
    id: args.existingMatch?.existingMatchId ?? syntheticMatchId(eventIdNumber),

    competition_id: args.league.app_code,
    competition_name: args.league.name,
    utc_date: utcDate,
    status,
    matchday: readInt(args.event, "round_number"),
    season: readSeasonYear(args.event),

    home_team: homeTeam,
    away_team: awayTeam,
    home_team_id: readTeamId(args.event, "home"),
    away_team_id: readTeamId(args.event, "away"),

    home_score: scoreAllowed ? readInt(args.event, "home_score") : null,
    away_score: scoreAllowed ? readInt(args.event, "away_score") : null,
    minute: isLiveStatus(status) ? readInt(args.event, "current_minute") : null,
    injury_time: null,
    last_sync_at: args.fetchedAt,

    source: "bsd",
    source_event_id: sourceEventId,
    source_league_id: readProviderLeagueId(args.event)?.toString() ?? null,
    source_season_id: readProviderSeasonId(args.event),
    source_status: rawStatus,
    source_round_name: readString(args.event, "round_name"),
    group_name: readString(args.event, "group_name"),

    home_short_name: homeTeamObj ? readString(homeTeamObj, "short_name") : null,
    away_short_name: awayTeamObj ? readString(awayTeamObj, "short_name") : null,
    home_country: homeTeamObj ? readString(homeTeamObj, "country") : null,
    away_country: awayTeamObj ? readString(awayTeamObj, "country") : null,

    venue_id: venue ? readInt(venue, "id") : null,
    venue_name: venue ? readString(venue, "name") : null,
    venue_city: venue ? readString(venue, "city") : null,
    venue_country: venue ? readString(venue, "country") : null,
    venue_capacity: venue ? readInt(venue, "capacity") : null,
    venue_latitude: venue ? readNumber(venue, "latitude") : null,
    venue_longitude: venue ? readNumber(venue, "longitude") : null,

    home_coach_name: readCoachName(args.event, "home"),
    away_coach_name: readCoachName(args.event, "away"),
    referee: readString(args.event, "referee"),

    is_neutral_ground: readBool(args.event, "is_neutral_ground"),
    is_local_derby: readBool(args.event, "is_local_derby"),
    travel_distance_km: readNumber(args.event, "travel_distance_km"),
    weather_code: readString(args.event, "weather_code"),
    wind_speed: readNumber(args.event, "wind_speed"),
    temperature_c: readNumber(args.event, "temperature_c"),
    pitch_condition: readString(args.event, "pitch_condition"),
    attendance: readInt(args.event, "attendance"),

    raw_bsd: args.event,
  };
}


function collectOddsInputs(event: UnknownRecord): OddsInput[] {
  const directSpecs = [
    { marketId: "1x2", selection: "1", field: "odds_home" },
    { marketId: "1x2", selection: "X", field: "odds_draw" },
    { marketId: "1x2", selection: "2", field: "odds_away" },

    { marketId: "ou_1_5", selection: "over", field: "odds_over_15" },
    { marketId: "ou_1_5", selection: "under", field: "odds_under_15" },

    { marketId: "ou_2_5", selection: "over", field: "odds_over_25" },
    { marketId: "ou_2_5", selection: "under", field: "odds_under_25" },

    { marketId: "ou_3_5", selection: "over", field: "odds_over_35" },
    { marketId: "ou_3_5", selection: "under", field: "odds_under_35" },

    { marketId: "btts", selection: "yes", field: "odds_btts_yes" },
    { marketId: "btts", selection: "no", field: "odds_btts_no" },
  ];

  const inputs: OddsInput[] = [];

  for (const spec of directSpecs) {
    const bookOdds = readPositiveOdd(event, spec.field);
    if (bookOdds === null) continue;

    inputs.push({
      ...spec,
      bookOdds,
    });
  }

  const directKeys = new Set(
    inputs.map((input) => `${input.marketId}__${input.selection}`)
  );

  for (const modelInput of buildModelOddsInputs(event)) {
    const key = `${modelInput.marketId}__${modelInput.selection}`;
    if (directKeys.has(key)) continue;
    inputs.push(modelInput);
  }

  return inputs;
}

function buildOddsRows(args: {
  event: UnknownRecord;
  matchId: number;
  homeTeam: string | null;
  awayTeam: string | null;
  fetchedAt: string;
}): OddsUpsertRow[] {
  const eventIdNumber = readInt(args.event, "id");
  if (eventIdNumber === null) return [];

  const sourceEventId = String(eventIdNumber);
  const inputs = collectOddsInputs(args.event);

  const groups = new Map<string, OddsInput[]>();

  for (const input of inputs) {
    const current = groups.get(input.marketId) ?? [];
    current.push(input);
    groups.set(input.marketId, current);
  }

  const rows: OddsUpsertRow[] = [];

  for (const [marketId, marketInputs] of groups.entries()) {
    if (marketInputs.length < 2) continue;

    const isNonExclusiveMarket = NON_EXCLUSIVE_MARKET_IDS.has(marketId);

    const impliedSum = marketInputs.reduce((sum, input) => {
      return sum + 1 / input.bookOdds;
    }, 0);

    if (!Number.isFinite(impliedSum) || impliedSum <= 0) continue;

    const exclusiveMarketMargin = impliedSum - 1;

    for (const input of marketInputs) {
      const impliedProbability = 1 / input.bookOdds;
      const isModel = input.field.startsWith("model_");

      const modelFairProbability =
        isModel &&
        typeof input.fairProbability === "number" &&
        Number.isFinite(input.fairProbability) &&
        input.fairProbability > 0
          ? Math.min(Math.max(input.fairProbability, 0.001), 0.999)
          : null;

      const fairProb =
        modelFairProbability ??
        (isNonExclusiveMarket
          ? impliedProbability
          : impliedProbability / impliedSum);

      const fairOdds = 1 / fairProb;

      const margin =
        modelFairProbability !== null
          ? input.pricingMargin ?? 0
          : isNonExclusiveMarket
            ? input.pricingMargin ?? 0
            : exclusiveMarketMargin;

      if (!Number.isFinite(impliedProbability) || impliedProbability <= 0) {
        continue;
      }

      if (!Number.isFinite(fairProb) || fairProb <= 0) {
        continue;
      }

      if (!Number.isFinite(fairOdds) || fairOdds <= 1) {
        continue;
      }

      rows.push({
        match_id: args.matchId,
        market_id: marketId,
        selection: input.selection,

        fair_prob: fairProb,
        fair_odds: fairOdds,
        book_odds: input.bookOdds,
        book_prob: impliedProbability,
        is_model: isModel,

        margin,
        risk_adjustment: 0,
        implied_probability: impliedProbability,

        home_team: args.homeTeam,
        away_team: args.awayTeam,

        source: "bsd",
        source_event_id: sourceEventId,
        pricing_method: isModel
          ? "bsd_model_derived"
          : "bsd_market_normalized",
        raw_count: marketInputs.length,

        updated_at: args.fetchedAt,
        provider_fetched_at: args.fetchedAt,

        raw_source: {
          event_id: sourceEventId,
          market_id: marketId,
          selection: input.selection,
          field: input.field,
          book_odds: input.bookOdds,
          fair_probability_source: input.fairProbability ?? null,
          fair_probability_strategy:
            modelFairProbability !== null
              ? "model_input_probability"
              : isNonExclusiveMarket
                ? "raw_implied_probability"
                : "normalized_market_implied_probability",
          implied_probability: impliedProbability,
          implied_sum: impliedSum,
          market_is_exclusive: !isNonExclusiveMarket,
          fair_prob: fairProb,
          fair_odds: fairOdds,
          margin,
          is_model: isModel,
          pricing_method: isModel
            ? "bsd_model_derived"
            : "bsd_market_normalized",
        },
      });
    }
  }

  return rows;
}


function buildMatchResultRows(matchRows: MatchUpsertRow[]): MatchResultSyncRow[] {
  const rows = matchRows
    .filter((row) => {
      return (
        row.status === "FINISHED" &&
        row.home_score !== null &&
        row.away_score !== null
      );
    })
    .map((row) => {
      const htHomeScore = readInt(row.raw_bsd, "home_score_ht");
      const htAwayScore = readInt(row.raw_bsd, "away_score_ht");

      const hasHalfTimeScore = htHomeScore !== null && htAwayScore !== null;

      const shHomeScore = hasHalfTimeScore
        ? Math.max(0, Number(row.home_score) - htHomeScore)
        : null;

      const shAwayScore = hasHalfTimeScore
        ? Math.max(0, Number(row.away_score) - htAwayScore)
        : null;

      return {
        match_id: row.id,
        status: "FINISHED" as const,
        home_score: row.home_score as number,
        away_score: row.away_score as number,
        ht_home_score: htHomeScore,
        ht_away_score: htAwayScore,
        sh_home_score: shHomeScore,
        sh_away_score: shAwayScore,
        started_at: row.utc_date,
        finished_at: row.last_sync_at,
        updated_at: row.last_sync_at,
      };
    });

  return uniqueBy(rows, (row) => String(row.match_id));
}

async function syncFinishedMatchResults(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  rows: MatchResultSyncRow[]
): Promise<MatchResultsSyncStats> {
  if (!rows.length) {
    return {
      attempted: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
    };
  }

  const matchIds = rows.map((row) => row.match_id);

  const { data: existingData, error: existingError } = await supabase
    .from("match_results")
    .select(
      "match_id,status,home_score,away_score,ht_home_score,ht_away_score,sh_home_score,sh_away_score"
    )
    .in("match_id", matchIds);

  if (existingError) {
    throw new Error(`match_results read failed: ${existingError.message}`);
  }

  const existingByMatchId = new Map<number, ExistingMatchResultRow>();

  for (const row of (existingData ?? []) as ExistingMatchResultRow[]) {
    existingByMatchId.set(Number(row.match_id), row);
  }

  const rowsToInsert = rows.filter(
    (row) => !existingByMatchId.has(row.match_id)
  );

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await supabase
      .from("match_results")
      .insert(rowsToInsert);

    if (insertError) {
      throw new Error(`match_results insert failed: ${insertError.message}`);
    }
  }

  let updated = 0;
  let unchanged = 0;

  for (const row of rows) {
    const existing = existingByMatchId.get(row.match_id);

    if (!existing) continue;

    const existingHomeScore =
      existing.home_score === null ? null : Number(existing.home_score);

    const existingAwayScore =
      existing.away_score === null ? null : Number(existing.away_score);

    const existingHtHomeScore =
      existing.ht_home_score === null ? null : Number(existing.ht_home_score);

    const existingHtAwayScore =
      existing.ht_away_score === null ? null : Number(existing.ht_away_score);

    const existingShHomeScore =
      existing.sh_home_score === null ? null : Number(existing.sh_home_score);

    const existingShAwayScore =
      existing.sh_away_score === null ? null : Number(existing.sh_away_score);

    const isSame =
      existing.status === row.status &&
      existingHomeScore === row.home_score &&
      existingAwayScore === row.away_score &&
      existingHtHomeScore === row.ht_home_score &&
      existingHtAwayScore === row.ht_away_score &&
      existingShHomeScore === row.sh_home_score &&
      existingShAwayScore === row.sh_away_score;

    if (isSame) {
      unchanged += 1;
      continue;
    }

    const { error: updateError } = await supabase
      .from("match_results")
      .update({
        status: row.status,
        home_score: row.home_score,
        away_score: row.away_score,
        ht_home_score: row.ht_home_score,
        ht_away_score: row.ht_away_score,
        sh_home_score: row.sh_home_score,
        sh_away_score: row.sh_away_score,
        started_at: row.started_at,
        finished_at: row.finished_at,
        updated_at: row.updated_at,
      })
      .eq("match_id", row.match_id);

    if (updateError) {
      throw new Error(
        `match_results update failed for match ${row.match_id}: ${updateError.message}`
      );
    }

    updated += 1;
  }

  return {
    attempted: rows.length,
    inserted: rowsToInsert.length,
    updated,
    unchanged,
  };
}


function roundOdds(value: number) {
  if (!Number.isFinite(value)) return null;
  return Math.round(Math.min(50, Math.max(1.01, value)) * 1000) / 1000;
}

function appendMissingFullTime1x2FromDc(oddsRows: OddsUpsertRow[]) {
  const has1x2 = new Set<number>();

  for (const row of oddsRows) {
    if (row.market_id === "1x2") {
      has1x2.add(Number(row.match_id));
    }
  }

  const byMatch = new Map<number, Record<string, number>>();

  for (const row of oddsRows) {
    if (row.market_id !== "dc") continue;

    const matchId = Number(row.match_id);
    const selection = String(row.selection);
    const odd = Number(row.book_odds);

    if (!Number.isFinite(matchId) || !Number.isFinite(odd) || odd <= 1) {
      continue;
    }

    const map = byMatch.get(matchId) ?? {};
    map[selection] = odd;
    byMatch.set(matchId, map);
  }

  const updatedAt = new Date().toISOString();

  for (const [matchId, dc] of byMatch.entries()) {
    if (has1x2.has(matchId)) continue;

    const odd1x = dc["1X"];
    const odd12 = dc["12"];
    const oddx2 = dc["X2"];

    if (!odd1x || !odd12 || !oddx2) continue;

    const p1x = 1 / odd1x;
    const p12 = 1 / odd12;
    const px2 = 1 / oddx2;

    const p1 = (p1x + p12 - px2) / 2;
    const px = (p1x + px2 - p12) / 2;
    const p2 = (p12 + px2 - p1x) / 2;

    const odd1 = roundOdds(1 / p1);
    const oddX = roundOdds(1 / px);
    const odd2 = roundOdds(1 / p2);

    if (!odd1 || !oddX || !odd2) continue;

    oddsRows.push(
      {
        match_id: matchId,
        market_id: "1x2",
        selection: "1",
        book_odds: odd1,
        source: "bsd",
        pricing_method: "bsd_model_derived",
        updated_at: updatedAt,
      } as OddsUpsertRow,
      {
        match_id: matchId,
        market_id: "1x2",
        selection: "X",
        book_odds: oddX,
        source: "bsd",
        pricing_method: "bsd_model_derived",
        updated_at: updatedAt,
      } as OddsUpsertRow,
      {
        match_id: matchId,
        market_id: "1x2",
        selection: "2",
        book_odds: odd2,
        source: "bsd",
        pricing_method: "bsd_model_derived",
        updated_at: updatedAt,
      } as OddsUpsertRow
    );

    has1x2.add(matchId);
  }
}



export async function GET(req: Request): Promise<Response> {
  const auth = requireCronSecret(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);

  const date = searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonError("Invalid date. Use YYYY-MM-DD", 400);
  }

  const dryRun = searchParams.get("dryRun") === "1";
  const timezone = searchParams.get("tz") || DEFAULT_TIMEZONE;

  try {
    const supabase = getSupabaseAdmin();
    const fetchedAt = new Date().toISOString();

    const { data: leaguesData, error: leaguesError } = await supabase
      .from("provider_leagues")
      .select(
        "app_code,name,provider_league_id,provider_season_id,enabled,sort_order"
      )
      .eq("provider", "bsd")
      .eq("enabled", true)
      .order("sort_order", { ascending: true });

    if (leaguesError) {
      return jsonError("provider_leagues read failed", 500, {
        details: leaguesError.message,
      });
    }

    const leagues = ((leaguesData ?? []) as ProviderLeagueRow[]).filter(
      (league) => league.provider_league_id !== null
    );

    const leagueByProviderId = new Map<number, ProviderLeagueRow>();

    for (const league of leagues) {
      const providerLeagueId = Number(league.provider_league_id);
      if (!Number.isFinite(providerLeagueId)) continue;

      leagueByProviderId.set(providerLeagueId, league);
    }

    const { results: rawEvents, pages } =
      await bsdFetchPaginated<UnknownRecord>(
        "/events/",
        {
          date_from: date,
          date_to: date,
          tz: timezone,
          page_size: 500,
        },
        { maxPages: 20 }
      );

    const fetchedEvents = rawEvents.filter(isRecord);
    const { events, duplicateEventIds } = dedupeEventsByBsdId(fetchedEvents);

    const eligibleEvents = events.filter((event) => {
      const providerLeagueId = readProviderLeagueId(event);
      return providerLeagueId !== null && leagueByProviderId.has(providerLeagueId);
    });

    const appCodes = Array.from(
      new Set(leagues.map((league) => league.app_code).filter(Boolean))
    );

    const rangeStart = `${addDaysYmd(date, -1)}T00:00:00.000Z`;
    const rangeEnd = `${addDaysYmd(date, 2)}T00:00:00.000Z`;

    const { data: existingData, error: existingError } = await supabase
      .from("matches")
      .select(
        "id,utc_date,competition_id,home_team,away_team,home_team_id,away_team_id,source,source_event_id"
      )
      .eq("source", "bsd")
      .in("competition_id", appCodes)
      .gte("utc_date", rangeStart)
      .lt("utc_date", rangeEnd);

    if (existingError) {
      return jsonError("matches read failed", 500, {
        details: existingError.message,
      });
    }

    const existingMatches = (existingData ?? []) as ExistingMatchRow[];

    const matchRows: MatchUpsertRow[] = [];
    const oddsRows: OddsUpsertRow[] = [];
    const skipped: Array<{ eventId: unknown; reason: string }> = [];

    const previewRows: Array<{
      id: number;
      appCode: string;
      competitionName: string | null;
      source: string;
      sourceEventId: string;
      sourceLeagueId: string | null;
      sourceSeasonId: string | null;
      utcDate: string;
      status: string;
      homeTeam: string;
      awayTeam: string;
      homeTeamId: number | null;
      awayTeamId: number | null;
      matchday: number | null;
      existingMatch: ExistingMatchCandidate | null;
      oddsCount: number;
    }> = [];

    for (const event of eligibleEvents) {
      const providerLeagueId = readProviderLeagueId(event);
      const league =
        providerLeagueId === null ? null : leagueByProviderId.get(providerLeagueId);

      if (!league) {
        skipped.push({
          eventId: event.id,
          reason: "provider league not enabled",
        });
        continue;
      }

      const eventIdNumber = readInt(event, "id");
      const sourceEventId = eventIdNumber === null ? null : String(eventIdNumber);
      const utcDate = parseEventUtcDate(readString(event, "event_date"));
      const homeTeam = readTeamName(event, "home");
      const awayTeam = readTeamName(event, "away");

      if (
        eventIdNumber === null ||
        !sourceEventId ||
        !utcDate ||
        !homeTeam ||
        !awayTeam
      ) {
        skipped.push({
          eventId: event.id,
          reason: "missing required event fields",
        });
        continue;
      }

      const existingMatch = findExistingMatch({
        eventId: sourceEventId,
        appCode: league.app_code,
        utcDate,
        homeTeam,
        awayTeam,
        existingMatches,
      });

      const matchRow = buildMatchRow({
        event,
        league,
        existingMatch,
        fetchedAt,
      });

      if (!matchRow) {
        skipped.push({
          eventId: event.id,
          reason: "failed to build match row",
        });
        continue;
      }

      const eventOddsRows = buildOddsRows({
        event,
        matchId: matchRow.id,
        homeTeam: matchRow.home_team,
        awayTeam: matchRow.away_team,
        fetchedAt,
      });

      matchRows.push(matchRow);
      //oddsRows.push(...eventOddsRows);

      previewRows.push({
        id: matchRow.id,
        appCode: matchRow.competition_id,
        competitionName: matchRow.competition_name,
        source: matchRow.source,
        sourceEventId: matchRow.source_event_id,
        sourceLeagueId: matchRow.source_league_id,
        sourceSeasonId: matchRow.source_season_id,
        utcDate: matchRow.utc_date,
        status: matchRow.status,
        homeTeam: matchRow.home_team,
        awayTeam: matchRow.away_team,
        homeTeamId: matchRow.home_team_id,
        awayTeamId: matchRow.away_team_id,
        matchday: matchRow.matchday,
        existingMatch,
        oddsCount: eventOddsRows.length,
      });
    }

    const uniqueMatchRows = uniqueBy(matchRows, (row) => String(row.id));

    appendMissingFullTime1x2FromDc(oddsRows);

    const uniqueOddsRows = uniqueBy(
      oddsRows,
      (row) => `${row.match_id}__${row.market_id}__${row.selection}`
    );

    

    const oddsCountByMatch = new Map<number, number>();

    for (const row of uniqueOddsRows) {
      oddsCountByMatch.set(
        row.match_id,
        (oddsCountByMatch.get(row.match_id) ?? 0) + 1
      );
    }

    const bsdEventFeatureRows = uniqueMatchRows.map((match) => {
      const snapshot = buildBsdEventFeaturesSnapshot(match.raw_bsd);

      return {
        match_id: match.id,
        source_event_id: match.source_event_id,
        source_league_id: match.source_league_id,
        source_season_id: match.source_season_id,
        event_date: match.utc_date,

        home_team: match.home_team,
        away_team: match.away_team,

        home_xg: snapshot.home_xg,
        away_xg: snapshot.away_xg,
        total_xg: snapshot.total_xg,

        home_win_prob: snapshot.home_win_prob,
        draw_prob: snapshot.draw_prob,
        away_win_prob: snapshot.away_win_prob,
        over25_prob: snapshot.over25_prob,
        btts_prob: snapshot.btts_prob,

        unavailable_home_count: snapshot.unavailable_home_count,
        unavailable_away_count: snapshot.unavailable_away_count,
        injured_home_count: snapshot.injured_home_count,
        injured_away_count: snapshot.injured_away_count,
        doubtful_home_count: snapshot.doubtful_home_count,
        doubtful_away_count: snapshot.doubtful_away_count,

        live_home_xg: snapshot.live_home_xg,
        live_away_xg: snapshot.live_away_xg,
        live_home_shots: snapshot.live_home_shots,
        live_away_shots: snapshot.live_away_shots,
        live_home_shots_on_target: snapshot.live_home_shots_on_target,
        live_away_shots_on_target: snapshot.live_away_shots_on_target,
        live_home_possession: snapshot.live_home_possession,
        live_away_possession: snapshot.live_away_possession,

        model_version: snapshot.model_version,
        features: snapshot.features,
        raw_unavailable_players: snapshot.raw_unavailable_players,
        raw_live_stats: snapshot.raw_live_stats,

        fetched_at: fetchedAt,
        updated_at: fetchedAt,
      };
    });

    const pricingFeatureRows = uniqueMatchRows.map((match) => {
      const snapshot = buildPricingFeatureSnapshot(match.raw_bsd);
      const rawFeatures = snapshot.raw_features;

      return {
        match_id: match.id,
        source: match.source,
        source_event_id: match.source_event_id,
        competition_id: match.competition_id,
        competition_name: match.competition_name,
        utc_date: match.utc_date,
        status: match.status,
        home_team: match.home_team,
        away_team: match.away_team,
        home_team_id: match.home_team_id,
        away_team_id: match.away_team_id,
        home_score: match.home_score,
        away_score: match.away_score,
        expected_home_goals: snapshot.home_xg,
        expected_away_goals: snapshot.away_xg,
        probability_home_win: readNumber(rawFeatures, "probability_home_win"),
        probability_draw: readNumber(rawFeatures, "probability_draw"),
        probability_away_win: readNumber(rawFeatures, "probability_away_win"),
        probability_over_15: readNumber(rawFeatures, "probability_over_15"),
        probability_over_25: readNumber(rawFeatures, "probability_over_25"),
        probability_over_35: readNumber(rawFeatures, "probability_over_35"),
        probability_btts_yes: readNumber(rawFeatures, "probability_btts_yes"),
        is_neutral_ground: match.is_neutral_ground,
        is_local_derby: match.is_local_derby,
        travel_distance_km: match.travel_distance_km,
        weather_code: match.weather_code,
        wind_speed: match.wind_speed,
        temperature_c: match.temperature_c,
        pitch_condition: match.pitch_condition,
        attendance: match.attendance,
        generated_odds_count: oddsCountByMatch.get(match.id) ?? 0,
        model_version: BSD_PRICING_MODEL_VERSION,
        last_priced_at: fetchedAt,
        last_sync_at: fetchedAt,
        raw_features: snapshot.raw_features,
      };
    });

    const matchResultRows = buildMatchResultRows(uniqueMatchRows);

    let upsertedMatchesCount = 0;
    let upsertedOddsCount = 0;
    let upsertedPricingFeaturesCount = 0;
    let upsertedBsdEventFeaturesCount = 0;

    let matchResultsSync: MatchResultsSyncStats = {
      attempted: matchResultRows.length,
      inserted: 0,
      updated: 0,
      unchanged: 0,
    };

    if (!dryRun && uniqueMatchRows.length > 0) {
      const { error: matchesUpsertError } = await supabase
        .from("matches")
        .upsert(uniqueMatchRows, { onConflict: "id" });

      if (matchesUpsertError) {
        return jsonError("matches upsert failed", 500, {
          details: matchesUpsertError.message,
        });
      }

      upsertedMatchesCount = uniqueMatchRows.length;
    }

    if (!dryRun && uniqueOddsRows.length > 0) {
      const { error: oddsUpsertError } = await supabase
        .from("odds")
        .upsert(uniqueOddsRows, {
          onConflict: "match_id,market_id,selection",
        });

      if (oddsUpsertError) {
        return jsonError("odds upsert failed", 500, {
          details: oddsUpsertError.message,
        });
      }

      upsertedOddsCount = uniqueOddsRows.length;
    }

    if (!dryRun && pricingFeatureRows.length > 0) {
      const { error: pricingFeaturesUpsertError } = await supabase
        .from("match_pricing_features")
        .upsert(pricingFeatureRows, { onConflict: "match_id" });

      if (pricingFeaturesUpsertError) {
        return jsonError("match_pricing_features upsert failed", 500, {
          details: pricingFeaturesUpsertError.message,
        });
      }

      upsertedPricingFeaturesCount = pricingFeatureRows.length;
    }

    if (!dryRun && bsdEventFeatureRows.length > 0) {
      const { error: bsdEventFeaturesUpsertError } = await supabase
        .from("bsd_event_features")
        .upsert(bsdEventFeatureRows, { onConflict: "match_id" });

      if (bsdEventFeaturesUpsertError) {
        return jsonError("bsd_event_features upsert failed", 500, {
          details: bsdEventFeaturesUpsertError.message,
        });
      }

      upsertedBsdEventFeaturesCount = bsdEventFeatureRows.length;
    }

    if (!dryRun && matchResultRows.length > 0) {
      matchResultsSync = await syncFinishedMatchResults(
        supabase,
        matchResultRows
      );
    }

    const createdNewCount = previewRows.filter(
      (row) => row.existingMatch === null
    ).length;

    const updatedExistingCount = previewRows.filter(
      (row) => row.existingMatch !== null
    ).length;

    return NextResponse.json({
      ok: true,
      provider: "bsd",
      dryRun,
      date,
      timezone,
      fetchedAt,

      enabledLeaguesCount: leagues.length,
      enabledProviderLeagueIds: Array.from(leagueByProviderId.keys()).sort(
        (a, b) => a - b
      ),

      fetchedEventsCount: fetchedEvents.length,
      uniqueEventsCount: events.length,
      duplicateEventIds,
      eligibleEventsCount: eligibleEvents.length,

      builtMatchRowsCount: matchRows.length,
      uniqueMatchRowsCount: uniqueMatchRows.length,
      builtOddsRowsCount: oddsRows.length,
      uniqueOddsRowsCount: uniqueOddsRows.length,
      builtPricingFeatureRowsCount: pricingFeatureRows.length,
      upsertedPricingFeaturesCount,
      builtBsdEventFeatureRowsCount: bsdEventFeatureRows.length,
      upsertedBsdEventFeaturesCount,
      modelVersion: BSD_PRICING_MODEL_VERSION,

      builtMatchResultRowsCount: matchResultRows.length,
      syncedMatchResultsCount:
        matchResultsSync.inserted + matchResultsSync.updated,
      insertedMatchResultsCount: matchResultsSync.inserted,
      updatedMatchResultsCount: matchResultsSync.updated,
      unchangedMatchResultsCount: matchResultsSync.unchanged,

      upsertedMatchesCount,
      upsertedOddsCount,

      dryRunRowsCount: dryRun ? previewRows.length : 0,
      createdNewCount,
      updatedExistingCount,
      skippedCount: skipped.length,

      rows: previewRows,
      skipped,
      pages,

      meta: {
        note:
          "BSD /events/ appears to ignore league_id, so this endpoint fetches the day once and filters by event.league.id locally.",
        syntheticIdOffset: SYNTHETIC_ID_OFFSET,
      },
    });


  } catch (e: unknown) {
    const err = e as {
      message?: string;
      status?: number;
      payload?: unknown;
    };

    return jsonError(err?.message || "BSD matches sync failed", 500, {
      status: err?.status ?? null,
      details: err?.payload ?? null,
    });
  }
}
