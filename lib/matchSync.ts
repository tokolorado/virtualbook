import { supabaseAdmin } from "./supabaseServer";
import { fetchMatchesByDate } from "./footballData";

export async function ensureMatchesCached(dateISO: string, maxAgeMinutes = 10) {
  const sb = supabaseAdmin();

  // sprawdź czy mamy coś świeżego w cache na ten dzień
  const start = new Date(dateISO + "T00:00:00.000Z");
  const end = new Date(dateISO + "T23:59:59.999Z");

  const { data: existing } = await sb
    .from("matches")
    .select("id,last_sync_at")
    .gte("utc_date", start.toISOString())
    .lte("utc_date", end.toISOString());

  const now = Date.now();
  const isFresh =
    existing &&
    existing.length > 0 &&
    existing.every((m) => (now - new Date(m.last_sync_at).getTime()) / 60000 <= maxAgeMinutes);

  if (isFresh) return;

  // pobierz z football-data
  const payload = await fetchMatchesByDate(dateISO);
  const matches = payload.matches ?? [];

  const rows = matches.map((m: any) => ({
    id: m.id,
    competition_id: m.competition?.id ?? null,
    competition_name: m.competition?.name ?? null,
    utc_date: m.utcDate,
    status: m.status,
    matchday: m.matchday ?? null,
    season: m.season?.id ? String(m.season.id) : null,
    home_team: m.homeTeam?.name ?? "Home",
    away_team: m.awayTeam?.name ?? "Away",
    home_score: m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? null,
    away_score: m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? null,
    last_sync_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error } = await sb.from("matches").upsert(rows, { onConflict: "id" });
    if (error) throw error;
  }
}