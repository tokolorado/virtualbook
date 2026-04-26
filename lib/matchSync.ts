// lib/matchSync.ts
import { supabaseAdmin } from "./supabaseServer";
import { fetchMatchesByDate } from "./footballData";

type CachedMatchRow = {
  id: number;
  last_sync_at: string | null;
};

type FootballDataMatch = {
  id: number;
  utcDate: string;
  status: string;
  matchday?: number | null;
  competition?: {
    id?: number | null;
    name?: string | null;
  } | null;
  season?: {
    id?: number | string | null;
  } | null;
  homeTeam?: {
    name?: string | null;
  } | null;
  awayTeam?: {
    name?: string | null;
  } | null;
  score?: {
    fullTime?: {
      home?: number | null;
      away?: number | null;
    } | null;
    halfTime?: {
      home?: number | null;
      away?: number | null;
    } | null;
  } | null;
};

type FootballDataMatchesPayload = {
  matches?: FootballDataMatch[];
};

function canPersistScore(status: string | null | undefined) {
  return String(status ?? "").toUpperCase() === "FINISHED";
}

export async function ensureMatchesCached(dateISO: string, maxAgeMinutes = 10) {
  const sb = supabaseAdmin();

  const start = new Date(`${dateISO}T00:00:00.000Z`);
  const end = new Date(`${dateISO}T23:59:59.999Z`);

  const { data: existing } = await sb
    .from("matches")
    .select("id,last_sync_at")
    .gte("utc_date", start.toISOString())
    .lte("utc_date", end.toISOString());

  const cachedRows = (existing ?? []) as CachedMatchRow[];

  const now = Date.now();
  const isFresh =
    cachedRows.length > 0 &&
    cachedRows.every((match) => {
      if (!match.last_sync_at) return false;
      const lastSyncMs = new Date(match.last_sync_at).getTime();
      return (now - lastSyncMs) / 60000 <= maxAgeMinutes;
    });

  if (isFresh) return;

  const payload = (await fetchMatchesByDate(dateISO)) as FootballDataMatchesPayload;
  const matches = payload.matches ?? [];

  const rows = matches.map((match) => ({
    id: match.id,
    competition_id: match.competition?.id ?? null,
    competition_name: match.competition?.name ?? null,
    utc_date: match.utcDate,
    status: match.status,
    matchday: match.matchday ?? null,
    season: match.season?.id != null ? String(match.season.id) : null,
    home_team: match.homeTeam?.name ?? "Home",
    away_team: match.awayTeam?.name ?? "Away",
    home_score: canPersistScore(match.status)
      ? match.score?.fullTime?.home ?? match.score?.halfTime?.home ?? null
      : null,
    away_score: canPersistScore(match.status)
      ? match.score?.fullTime?.away ?? match.score?.halfTime?.away ?? null
      : null,
    last_sync_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error } = await sb.from("matches").upsert(rows, { onConflict: "id" });
    if (error) throw error;
  }
}
