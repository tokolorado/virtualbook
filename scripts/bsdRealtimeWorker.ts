import { createClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, unknown>;

type MatchSubscriptionRow = {
  id: number;
  source_event_id: string;
  utc_date: string | null;
  status: string | null;
  home_team: string | null;
  away_team: string | null;
};

type LivePatch = {
  status?: string;
  minute?: number | null;
  injury_time?: number | null;
  home_score?: number | null;
  away_score?: number | null;
};

type BsdEventFeaturesPatch = {
  match_id: number;
  source: "bsd";
  source_event_id: string;
  raw_live_stats: JsonRecord;
  fetched_at: string;
  updated_at: string;
  live_home_xg?: number | null;
  live_away_xg?: number | null;
  live_home_shots?: number | null;
  live_away_shots?: number | null;
  live_home_shots_on_target?: number | null;
  live_away_shots_on_target?: number | null;
  live_home_possession?: number | null;
  live_away_possession?: number | null;
};

const WORKER_ID =
  process.env.BSD_REALTIME_WORKER_ID ?? `bsd-realtime-${process.pid}`;
const WS_URL = process.env.BSD_REALTIME_WS_URL ?? "wss://sports.bzzoiro.com/ws/live/";
const TOKEN = process.env.BSD_REALTIME_TOKEN ?? process.env.BSD_API_KEY;
const MAX_SUBSCRIPTIONS = clampInt(
  Number(process.env.BSD_REALTIME_MAX_SUBSCRIPTIONS ?? 10),
  1,
  10
);
const LOOKBACK_HOURS = clampInt(
  Number(process.env.BSD_REALTIME_LOOKBACK_HOURS ?? 3),
  0,
  72
);
const LOOKAHEAD_HOURS = clampInt(
  Number(process.env.BSD_REALTIME_LOOKAHEAD_HOURS ?? 36),
  1,
  168
);
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase config for BSD realtime worker.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

const supabase = getSupabaseAdmin();

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeInt(value: unknown): number | null {
  const n = safeNumber(value);
  return n === null ? null : Math.trunc(n);
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function buildWebSocketUrl() {
  if (!TOKEN) {
    throw new Error("Missing BSD_REALTIME_TOKEN or BSD_API_KEY.");
  }

  const url = new URL(WS_URL);
  url.searchParams.set("token", TOKEN);
  return url.toString();
}

async function loadSubscriptionMatches(): Promise<MatchSubscriptionRow[]> {
  const now = Date.now();
  const fromIso = new Date(now - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const toIso = new Date(now + LOOKAHEAD_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("matches")
    .select("id,source_event_id,utc_date,status,home_team,away_team")
    .eq("source", "bsd")
    .not("source_event_id", "is", null)
    .gte("utc_date", fromIso)
    .lte("utc_date", toIso)
    .order("utc_date", { ascending: true })
    .limit(80);

  if (error) throw new Error(`BSD realtime match read failed: ${error.message}`);

  const rows = (data ?? [])
    .map(normalizeMatchRow)
    .filter((row): row is MatchSubscriptionRow => row !== null);

  return rows
    .sort((a, b) => {
      const liveA = isLiveStatus(a.status) ? 0 : 1;
      const liveB = isLiveStatus(b.status) ? 0 : 1;
      if (liveA !== liveB) return liveA - liveB;
      return Date.parse(a.utc_date ?? "") - Date.parse(b.utc_date ?? "");
    })
    .slice(0, MAX_SUBSCRIPTIONS);
}

function normalizeMatchRow(value: unknown): MatchSubscriptionRow | null {
  if (!isRecord(value)) return null;
  const id = safeInt(value.id);
  const sourceEventId = safeString(value.source_event_id);
  if (id === null || !sourceEventId) return null;

  return {
    id,
    source_event_id: sourceEventId,
    utc_date: safeString(value.utc_date),
    status: safeString(value.status),
    home_team: safeString(value.home_team),
    away_team: safeString(value.away_team),
  };
}

function isLiveStatus(status: string | null | undefined) {
  const normalized = String(status ?? "").toUpperCase();
  return [
    "LIVE",
    "IN_PLAY",
    "INPLAY",
    "1ST_HALF",
    "2ND_HALF",
    "HALFTIME",
    "PAUSED",
  ].includes(normalized);
}

async function parseMessageData(data: unknown): Promise<JsonRecord[]> {
  let text: string | null = null;

  if (typeof data === "string") {
    text = data;
  } else if (data instanceof ArrayBuffer) {
    text = new TextDecoder().decode(data);
  } else if (ArrayBuffer.isView(data)) {
    text = new TextDecoder().decode(data);
  } else if (typeof Blob !== "undefined" && data instanceof Blob) {
    text = await data.text();
  }

  if (!text) return [];

  const parsed = JSON.parse(text) as unknown;
  return flattenFrames(parsed);
}

function flattenFrames(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenFrames(item));
  }

  if (!isRecord(value)) return [];

  for (const key of ["frames", "events", "messages"]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.flatMap((item) => flattenFrames(item));
  }

  return [value];
}

function detectFrameType(frame: JsonRecord): string | null {
  for (const key of ["type", "frame", "event", "action", "channel"]) {
    const value = safeString(frame[key]);
    if (value) return value.toLowerCase();
  }

  if (isRecord(frame.data)) {
    const nestedType = detectFrameType(frame.data);
    if (nestedType) return nestedType;
  }

  return null;
}

function findSourceEventId(value: unknown, depth = 0): string | null {
  if (depth > 5 || !isRecord(value)) return null;

  for (const key of ["source_event_id", "event_id", "eventId", "match_event_id"]) {
    const direct = safeString(value[key]);
    if (direct) return direct;
  }

  for (const key of ["event", "match", "data", "payload"]) {
    const nested = findSourceEventId(value[key], depth + 1);
    if (nested) return nested;
  }

  return null;
}

function findNumberByKeys(value: unknown, keys: string[], depth = 0): number | null {
  if (depth > 5 || !isRecord(value)) return null;
  const wanted = new Set(keys.map(normalizeKey));

  for (const [key, nested] of Object.entries(value)) {
    if (wanted.has(normalizeKey(key))) {
      const number = safeNumber(nested);
      if (number !== null) return number;
    }
  }

  for (const nested of Object.values(value)) {
    const number = findNumberByKeys(nested, keys, depth + 1);
    if (number !== null) return number;
  }

  return null;
}

function findStatus(value: unknown, depth = 0): string | null {
  if (depth > 4 || !isRecord(value)) return null;

  for (const key of ["status", "state", "match_status"]) {
    const status = safeString(value[key]);
    if (status) return normalizeLiveStatus(status);
  }

  for (const key of ["event", "match", "data", "payload"]) {
    const nested = findStatus(value[key], depth + 1);
    if (nested) return nested;
  }

  return null;
}

function normalizeLiveStatus(status: string) {
  const normalized = status.toLowerCase().replace(/[^a-z0-9]+/g, "_");

  if (["live", "in_play", "inplay", "running"].includes(normalized)) {
    return "IN_PLAY";
  }

  if (["first_half", "1st_half", "second_half", "2nd_half"].includes(normalized)) {
    return "IN_PLAY";
  }

  if (["half_time", "halftime", "paused"].includes(normalized)) {
    return "PAUSED";
  }

  if (["finished", "ft", "full_time"].includes(normalized)) {
    return "FINISHED";
  }

  if (["scheduled", "not_started", "upcoming", "timed"].includes(normalized)) {
    return "TIMED";
  }

  return status.toUpperCase();
}

function extractLivePatch(frame: JsonRecord): LivePatch {
  return {
    status: findStatus(frame) ?? undefined,
    minute: findNumberByKeys(frame, ["minute", "current_minute", "match_minute"]),
    injury_time: findNumberByKeys(frame, ["injury_time", "stoppage_time"]),
    home_score: findNumberByKeys(frame, ["home_score", "homeScore", "home_goals"]),
    away_score: findNumberByKeys(frame, ["away_score", "awayScore", "away_goals"]),
  };
}

function extractFeaturePatch(match: MatchSubscriptionRow, frame: JsonRecord) {
  const now = new Date().toISOString();
  const patch: BsdEventFeaturesPatch = {
    match_id: match.id,
    source: "bsd",
    source_event_id: match.source_event_id,
    raw_live_stats: frame,
    fetched_at: now,
    updated_at: now,
  };

  const fieldMap: Array<[keyof BsdEventFeaturesPatch, string[]]> = [
    ["live_home_xg", ["home_xg", "homeXg", "home_expected_goals"]],
    ["live_away_xg", ["away_xg", "awayXg", "away_expected_goals"]],
    ["live_home_shots", ["home_shots", "homeShots", "home_total_shots"]],
    ["live_away_shots", ["away_shots", "awayShots", "away_total_shots"]],
    ["live_home_shots_on_target", ["home_shots_on_target", "homeShotsOnTarget"]],
    ["live_away_shots_on_target", ["away_shots_on_target", "awayShotsOnTarget"]],
    ["live_home_possession", ["home_possession", "homePossession"]],
    ["live_away_possession", ["away_possession", "awayPossession"]],
  ];

  for (const [field, keys] of fieldMap) {
    const value = findNumberByKeys(frame, keys);
    if (value !== null) {
      patch[field] = value as never;
    }
  }

  return patch;
}

async function applyLiveUpdate(match: MatchSubscriptionRow, frame: JsonRecord) {
  const livePatch = extractLivePatch(frame);
  const matchPatch: LivePatch & { last_sync_at: string } = {
    last_sync_at: new Date().toISOString(),
  };

  if (livePatch.status !== undefined) matchPatch.status = livePatch.status;
  if (livePatch.minute !== undefined) matchPatch.minute = livePatch.minute;
  if (livePatch.injury_time !== undefined) matchPatch.injury_time = livePatch.injury_time;
  if (livePatch.home_score !== undefined) matchPatch.home_score = livePatch.home_score;
  if (livePatch.away_score !== undefined) matchPatch.away_score = livePatch.away_score;

  const { error: matchError } = await supabase
    .from("matches")
    .update(matchPatch)
    .eq("id", match.id);

  if (matchError) {
    throw new Error(`matches live update failed: ${matchError.message}`);
  }

  const { error: featuresError } = await supabase
    .from("bsd_event_features")
    .upsert(extractFeaturePatch(match, frame), { onConflict: "match_id" });

  if (featuresError) {
    throw new Error(`bsd_event_features live upsert failed: ${featuresError.message}`);
  }
}

async function insertFrame(
  frame: JsonRecord,
  frameType: string | null,
  sourceEventId: string | null,
  matchId: number | null,
  processedStatus: string,
  error: string | null
) {
  const { error: insertError } = await supabase.from("bsd_realtime_frames").insert({
    frame_type: frameType,
    source_event_id: sourceEventId,
    match_id: matchId,
    payload: frame,
    processed_status: processedStatus,
    error,
  });

  if (insertError) {
    console.warn(`[${WORKER_ID}] realtime frame insert failed: ${insertError.message}`);
  }
}

function subscribeToMatches(ws: WebSocket, matches: MatchSubscriptionRow[]) {
  for (const match of matches) {
    ws.send(JSON.stringify({ action: "subscribe", event_id: match.source_event_id }));
    console.log(
      `[${WORKER_ID}] subscribed BSD event ${match.source_event_id} (${match.home_team ?? "Home"} vs ${match.away_team ?? "Away"})`
    );
  }
}

async function connectOnce() {
  if (typeof WebSocket === "undefined") {
    throw new Error("Global WebSocket is unavailable. Run this worker on Node 22+.");
  }

  const matches = await loadSubscriptionMatches();

  if (matches.length === 0) {
    console.log(`[${WORKER_ID}] no BSD matches to subscribe; retrying later`);
    return;
  }

  const byEventId = new Map(matches.map((match) => [match.source_event_id, match]));
  const ws = new WebSocket(buildWebSocketUrl());

  await new Promise<void>((resolve) => {
    ws.addEventListener("open", () => {
      console.log(`[${WORKER_ID}] BSD realtime websocket opened`);
      subscribeToMatches(ws, matches);
    });

    ws.addEventListener("message", (event) => {
      void (async () => {
        try {
          const frames = await parseMessageData(event.data);

          for (const frame of frames) {
            const frameType = detectFrameType(frame);
            const sourceEventId = findSourceEventId(frame);
            const match = sourceEventId ? byEventId.get(sourceEventId) ?? null : null;
            const isOddsFrame = frameType === "odds" || frameType === "odds_book";
            const isLiveFrame = frameType === "event" || frameType === "livedata";
            let processedStatus = isOddsFrame
              ? "raw_captured_needs_odds_schema"
              : "raw_captured";
            let error: string | null = null;

            if (match && isLiveFrame) {
              try {
                await applyLiveUpdate(match, frame);
                processedStatus = "live_applied";
              } catch (err) {
                error = err instanceof Error ? err.message : String(err);
                processedStatus = "live_apply_failed";
              }
            }

            await insertFrame(
              frame,
              frameType,
              sourceEventId,
              match?.id ?? null,
              processedStatus,
              error
            );
          }
        } catch (err) {
          console.warn(
            `[${WORKER_ID}] BSD realtime message handling failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      })();
    });

    ws.addEventListener("error", () => {
      console.warn(`[${WORKER_ID}] BSD realtime websocket error`);
    });

    ws.addEventListener("close", () => {
      console.warn(`[${WORKER_ID}] BSD realtime websocket closed`);
      resolve();
    });
  });
}

async function main() {
  let backoffMs = RECONNECT_MIN_MS;

  while (true) {
    try {
      await connectOnce();
      backoffMs = RECONNECT_MIN_MS;
    } catch (err) {
      console.warn(
        `[${WORKER_ID}] BSD realtime connection failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    backoffMs = Math.min(RECONNECT_MAX_MS, backoffMs * 2);
  }
}

void main();
