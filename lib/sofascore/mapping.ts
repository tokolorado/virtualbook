import { supabaseAdmin } from "@/lib/supabaseServer";

export async function getMappedSofascoreEventId(
  matchId: number | string
): Promise<number | null> {
  const numericMatchId =
    typeof matchId === "number" ? matchId : Number(matchId);

  if (!Number.isInteger(numericMatchId) || numericMatchId <= 0) {
    return null;
  }

  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("match_sofascore_map")
    .select("sofascore_event_id")
    .eq("match_id", numericMatchId)
    .maybeSingle<{ sofascore_event_id: number }>();

  if (error || !data?.sofascore_event_id) {
    return null;
  }

  const eventId = Number(data.sofascore_event_id);
  return Number.isInteger(eventId) && eventId > 0 ? eventId : null;
}