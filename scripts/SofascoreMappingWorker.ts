import { createClient } from "@supabase/supabase-js";

type QueueRow = {
  match_id: number;
  status: string;
  attempts: number;
  next_retry_at: string;
  locked_at: string | null;
  locked_by: string | null;
};

type MatchRow = {
  id: number;
  utc_date: string | null;
  competition_name: string | null;
  home_team: string;
  away_team: string;
};

type MappingRow = {
  match_id: number;
  sofascore_event_id: number;
};

type SofaScoreScheduledEvent = {
  id?: number | null;
  startTimestamp?: number | null;
  homeTeam?: {
    name?: string | null;
  } | null;
  awayTeam?: {
    name?: string | null;
  } | null;
  tournament?: {
    name?: string | null;
    uniqueTournament?: {
      name?: string | null;
    } | null;
  } | null;
};

const WORKER_ID =
  process.env.MAPPING_WORKER_ID ?? `worker-${process.pid}-${Date.now()}`;
const BATCH_SIZE = Number(process.env.MAPPING_BATCH_SIZE ?? 10);
const MAX_ATTEMPTS = Number(process.env.MAPPING_MAX_ATTEMPTS ?? 6);
const MIN_CONFIDENCE = Number(process.env.MAPPING_MIN_CONFIDENCE ?? 58);

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Brak konfiguracji SUPABASE dla workera mapowania.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

const supabase = getSupabaseAdmin();

function safeNumber(value: unknown): number | null {
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

function normalizeQueueRow(input: unknown): QueueRow | null {
  if (typeof input !== "object" || input === null) return null;

  const row = input as Record<string, unknown>;
  const matchId = safeNumber(row.match_id);

  if (matchId === null) return null;

  return {
    match_id: matchId,
    status: safeString(row.status, "pending"),
    attempts: safeNumber(row.attempts) ?? 0,
    next_retry_at: safeString(row.next_retry_at),
    locked_at: safeNullableString(row.locked_at),
    locked_by: safeNullableString(row.locked_by),
  };
}

function normalizeMatchRow(input: unknown): MatchRow | null {
  if (typeof input !== "object" || input === null) return null;

  const row = input as Record<string, unknown>;
  const id = safeNumber(row.id);

  if (id === null) return null;

  return {
    id,
    utc_date: safeNullableString(row.utc_date),
    competition_name: safeNullableString(row.competition_name),
    home_team: safeString(row.home_team, "Home"),
    away_team: safeString(row.away_team, "Away"),
  };
}

function normalizeMappingRow(input: unknown): MappingRow | null {
  if (typeof input !== "object" || input === null) return null;

  const row = input as Record<string, unknown>;
  const matchId = safeNumber(row.match_id);
  const eventId = safeNumber(row.sofascore_event_id);

  if (matchId === null || eventId === null) return null;

  return {
    match_id: matchId,
    sofascore_event_id: eventId,
  };
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string | null | undefined): string[] {
  const stop = new Set(["fc", "cf", "sc", "afc", "club", "de", "the"]);

  return normalizeText(value)
    .split(" ")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !stop.has(item));
}

function similarityScore(
  a: string | null | undefined,
  b: string | null | undefined
) {
  const na = normalizeText(a);
  const nb = normalizeText(b);

  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));

  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }

  const union = new Set([...aTokens, ...bTokens]).size;
  return union > 0 ? intersection / union : 0;
}

function competitionScore(
  currentCompetition: string | null,
  candidateTournament: string | null
) {
  if (!currentCompetition || !candidateTournament) return 0;

  const current = normalizeText(currentCompetition);
  const candidate = normalizeText(candidateTournament);

  if (!current || !candidate) return 0;
  if (current === candidate) return 1;
  if (current.includes(candidate) || candidate.includes(current)) return 0.85;

  return similarityScore(currentCompetition, candidateTournament);
}

function kickoffScore(
  currentUtcDate: string | null,
  candidateStartTimestamp: number | null
) {
  if (!currentUtcDate || candidateStartTimestamp === null) return 0.35;

  const currentTs = Date.parse(currentUtcDate);
  const candidateTs = candidateStartTimestamp * 1000;

  if (!Number.isFinite(currentTs) || !Number.isFinite(candidateTs)) {
    return 0.35;
  }

  const diffHours = Math.abs(currentTs - candidateTs) / (1000 * 60 * 60);

  if (diffHours <= 1) return 1;
  if (diffHours <= 3) return 0.85;
  if (diffHours <= 6) return 0.7;
  if (diffHours <= 12) return 0.5;
  if (diffHours <= 24) return 0.25;
  return 0;
}

function toUtcDateOnly(value: string) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;

  const d = new Date(ts);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function shiftDate(dateOnly: string, offsetDays: number) {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);

  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isMatchTooOldForReview(utcDate: string | null) {
  if (!utcDate) return true;

  const ts = Date.parse(utcDate);
  if (!Number.isFinite(ts)) return true;

  const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
  return ts < sixHoursAgo;
}

function isSofaScore403Error(message: string | null | undefined) {
  return String(message ?? "").includes("SofaScore schedule fetch failed: 403");
}

async function fetchScheduledEvents(
  dateOnly: string
): Promise<SofaScoreScheduledEvent[]> {
  const url = `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${dateOnly}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9,pl;q=0.8",
      referer: "https://www.sofascore.com/",
      origin: "https://www.sofascore.com",
      pragma: "no-cache",
      "cache-control": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(`SofaScore schedule fetch failed: ${response.status}`);
  }

  const json: unknown = await response.json();
  const row =
    typeof json === "object" && json !== null
      ? (json as Record<string, unknown>)
      : {};

  return Array.isArray(row.events)
    ? (row.events as SofaScoreScheduledEvent[])
    : [];
}

function scoreCandidate(matchRow: MatchRow, event: SofaScoreScheduledEvent) {
  const eventId = safeNumber(event.id);
  const homeName = safeNullableString(event.homeTeam?.name);
  const awayName = safeNullableString(event.awayTeam?.name);
  const startTimestamp = safeNumber(event.startTimestamp);
  const tournamentName =
    safeNullableString(event.tournament?.uniqueTournament?.name) ??
    safeNullableString(event.tournament?.name);

  if (eventId === null || !homeName || !awayName) {
    return null;
  }

  const directHome = similarityScore(matchRow.home_team, homeName);
  const directAway = similarityScore(matchRow.away_team, awayName);
  const directTeams = (directHome + directAway) / 2;

  const reverseHome = similarityScore(matchRow.home_team, awayName);
  const reverseAway = similarityScore(matchRow.away_team, homeName);
  const reverseTeams = (reverseHome + reverseAway) / 2;

  const isReversed = reverseTeams > directTeams;
  const teamScore = Math.max(directTeams, reverseTeams);
  const dateScore = kickoffScore(matchRow.utc_date, startTimestamp);
  const compScore = competitionScore(matchRow.competition_name, tournamentName);

  const total = teamScore * 0.72 + dateScore * 0.23 + compScore * 0.05;

  return {
    eventId,
    confidence: Number((total * 100).toFixed(3)),
    notes: `team=${teamScore.toFixed(3)} date=${dateScore.toFixed(
      3
    )} comp=${compScore.toFixed(3)} reversed=${isReversed}`,
  };
}

function nextRetryAtIso(attempts: number) {
  const minutes = Math.min(5 * Math.pow(2, Math.max(0, attempts - 1)), 360);
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

async function claimBatch(): Promise<QueueRow[]> {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("match_mapping_queue")
    .select("match_id, status, attempts, next_retry_at, locked_at, locked_by")
    .in("status", ["pending", "failed"])
    .lte("next_retry_at", nowIso)
    .is("locked_at", null)
    .order("next_retry_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    throw new Error(`Nie udało się pobrać kolejki: ${error.message}`);
  }

  const rows = (data ?? [])
    .map(normalizeQueueRow)
    .filter((row): row is QueueRow => row !== null);

  const claimed: QueueRow[] = [];

  for (const row of rows) {
    const { data: updated, error: updateError } = await supabase
      .from("match_mapping_queue")
      .update({
        status: "processing",
        locked_at: nowIso,
        locked_by: WORKER_ID,
        last_attempt_at: nowIso,
        updated_at: nowIso,
      })
      .eq("match_id", row.match_id)
      .in("status", ["pending", "failed"])
      .is("locked_at", null)
      .select("match_id, status, attempts, next_retry_at, locked_at, locked_by")
      .maybeSingle();

    if (!updateError && updated) {
      const normalized = normalizeQueueRow(updated);
      if (normalized) claimed.push(normalized);
    }
  }

  return claimed;
}

async function loadMatch(matchId: number): Promise<MatchRow | null> {
  const { data, error } = await supabase
    .from("matches")
    .select("id, utc_date, competition_name, home_team, away_team")
    .eq("id", matchId)
    .maybeSingle();

  if (error) {
    throw new Error(`Nie udało się pobrać meczu ${matchId}: ${error.message}`);
  }

  return normalizeMatchRow(data);
}

async function loadExistingMapping(matchId: number): Promise<MappingRow | null> {
  const { data, error } = await supabase
    .from("match_sofascore_map")
    .select("match_id, sofascore_event_id")
    .eq("match_id", matchId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Nie udało się odczytać istniejącego mapowania ${matchId}: ${error.message}`
    );
  }

  return normalizeMappingRow(data);
}

async function markMapped(matchId: number) {
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("match_mapping_queue")
    .update({
      status: "mapped",
      mapped_at: nowIso,
      locked_at: null,
      locked_by: null,
      last_error: null,
      updated_at: nowIso,
    })
    .eq("match_id", matchId);

  if (error) {
    throw new Error(
      `Nie udało się oznaczyć mapped dla ${matchId}: ${error.message}`
    );
  }
}

async function markNeedsReview(row: QueueRow, errorMessage: string) {
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("match_mapping_queue")
    .update({
      status: "needs_review",
      attempts: row.attempts + 1,
      last_error: "SofaScore schedule fetch blocked: 403",
      locked_at: null,
      locked_by: null,
      last_attempt_at: nowIso,
      updated_at: nowIso,
    })
    .eq("match_id", row.match_id);

  if (error) {
    throw new Error(
      `Nie udało się ustawić needs_review dla ${row.match_id}: ${error.message}`
    );
  }

  console.log(`[review] ${row.match_id} -> ${errorMessage}`);
}

async function markExpired(row: QueueRow, reason: string) {
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("match_mapping_queue")
    .update({
      status: "failed",
      attempts: row.attempts,
      last_error: reason,
      locked_at: null,
      locked_by: null,
      updated_at: nowIso,
      next_retry_at: nowIso,
    })
    .eq("match_id", row.match_id);

  if (error) {
    throw new Error(
      `Nie udało się oznaczyć expired dla ${row.match_id}: ${error.message}`
    );
  }
}

async function markRetry(
  row: QueueRow,
  errorMessage: string,
  permanent = false
) {
  const attempts = row.attempts + 1;
  const status =
    permanent || attempts >= MAX_ATTEMPTS ? "needs_review" : "failed";

  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("match_mapping_queue")
    .update({
      status,
      attempts,
      last_error: errorMessage,
      next_retry_at: nextRetryAtIso(attempts),
      locked_at: null,
      locked_by: null,
      last_attempt_at: nowIso,
      updated_at: nowIso,
    })
    .eq("match_id", row.match_id);

  if (error) {
    throw new Error(
      `Nie udało się zaktualizować retry dla ${row.match_id}: ${error.message}`
    );
  }
}

async function upsertMapping(
  matchId: number,
  eventId: number,
  confidence: number,
  notes: string
) {
  const nowIso = new Date().toISOString();

  const { error } = await supabase.from("match_sofascore_map").upsert(
    {
      match_id: matchId,
      sofascore_event_id: eventId,
      mapping_method: "auto",
      confidence,
      notes,
      widget_src: "scheduled-events",
      updated_at: nowIso,
    },
    { onConflict: "match_id" }
  );

  if (error) {
    throw new Error(
      `Nie udało się zapisać mapowania ${matchId}: ${error.message}`
    );
  }
}

async function processRow(row: QueueRow) {
  const existing = await loadExistingMapping(row.match_id);

  if (existing) {
    await markMapped(row.match_id);
    console.log(
      `[mapped-existing] ${row.match_id} -> ${existing.sofascore_event_id}`
    );
    return;
  }

  const matchRow = await loadMatch(row.match_id);

  if (!matchRow) {
    await markRetry(row, "Match not found", true);
    console.log(`[needs-review] ${row.match_id} -> match not found`);
    return;
  }

  if (isMatchTooOldForReview(matchRow.utc_date)) {
    await markExpired(row, "Match too old for manual mapping review");
    console.log(`[expired] ${row.match_id} -> match too old`);
    return;
  }

  const baseDate =
    (matchRow.utc_date && toUtcDateOnly(matchRow.utc_date)) ??
    toUtcDateOnly(new Date().toISOString());

  if (!baseDate) {
    await markRetry(row, "Cannot resolve match date", true);
    console.log(`[needs-review] ${row.match_id} -> cannot resolve date`);
    return;
  }

  const datesToCheck = [
    shiftDate(baseDate, -1),
    baseDate,
    shiftDate(baseDate, 1),
  ];

  const candidatesMap = new Map<number, ReturnType<typeof scoreCandidate>>();

  for (const dateOnly of datesToCheck) {
    const events = await fetchScheduledEvents(dateOnly);

    for (const event of events) {
      const candidate = scoreCandidate(matchRow, event);
      if (!candidate) continue;

      const current = candidatesMap.get(candidate.eventId);
      if (!current || candidate.confidence > (current?.confidence ?? 0)) {
        candidatesMap.set(candidate.eventId, candidate);
      }
    }
  }

  const candidates = Array.from(candidatesMap.values())
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.confidence - a.confidence);

  const best = candidates[0] ?? null;

  if (!best) {
    await markRetry(row, "No SofaScore candidates found");
    console.log(`[retry] ${row.match_id} -> no candidates`);
    return;
  }

  if (best.confidence < MIN_CONFIDENCE) {
    await markRetry(row, `Low confidence: ${best.confidence}`);
    console.log(`[retry] ${row.match_id} -> low confidence ${best.confidence}`);
    return;
  }

  await upsertMapping(row.match_id, best.eventId, best.confidence, best.notes);
  await markMapped(row.match_id);

  console.log(
    `[mapped-auto] ${row.match_id} -> ${best.eventId} (confidence=${best.confidence})`
  );
}

async function main() {
  console.log(`[worker-start] ${WORKER_ID}`);

  const rows = await claimBatch();
  console.log(`[claimed] ${rows.length}`);

  for (const row of rows) {
    try {
      await processRow(row);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown mapping worker error";

      if (isSofaScore403Error(message)) {
        const matchRow = await loadMatch(row.match_id);

        if (matchRow && isMatchTooOldForReview(matchRow.utc_date)) {
          await markExpired(
            row,
            "SofaScore blocked and match is already too old"
          );
          console.error(`[expired] ${row.match_id} -> ${message}`);
          continue;
        }

        await markNeedsReview(row, message);
        continue;
      }

      await markRetry(row, message);
      console.error(`[retry] ${row.match_id} -> ${message}`);
    }
  }

  console.log(`[worker-end] ${WORKER_ID}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});