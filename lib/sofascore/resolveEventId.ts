// lib/sofascore/resolveEventId.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export async function resolveSofaScoreEventId(
  supabase: SupabaseClient,
  matchId: number
): Promise<number | null> {
  const { data, error } = await supabase
    .from("match_sofascore_map")
    .select("sofascore_event_id")
    .eq("match_id", matchId)
    .maybeSingle();

  if (error) {
    throw new Error(`Nie udało się pobrać mapowania SofaScore: ${error.message}`);
  }

  const eventId = Number(data?.sofascore_event_id);

  return Number.isFinite(eventId) ? eventId : null;
}