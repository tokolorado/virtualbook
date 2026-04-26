import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveSofaScoreEventId } from "@/lib/sofascore/resolveEventId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MatchEventRow = {
  id: number;
  match_id: number;
  team_id: number | null;
  player_name: string | null;
  minute: number | null;
  extra_minute: number | null;
  event_type: string;
  detail: string | null;
  created_at: string | null;
};

type TimelineItem = {
  id: string;
  minute: number | null;
  extraMinute: number | null;
  teamId: number | null;
  playerName: string | null;
  eventType: string;
  detail: string | null;
};

type TimelineResponse = {
  matchId: number | null;
  sofascoreEventId: number | null;
  externalUrl: string | null;
  items: TimelineItem[];
  updatedAt: string | null;
  source: "database";
  message: string | null;
};

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Brak konfiguracji SUPABASE dla route timeline.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function safeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizeEvent(row: MatchEventRow): TimelineItem {
  return {
    id: String(row.id),
    minute: safeNumber(row.minute),
    extraMinute: safeNumber(row.extra_minute),
    teamId: safeNumber(row.team_id),
    playerName: safeNullableString(row.player_name),
    eventType: safeString(row.event_type, "event"),
    detail: safeNullableString(row.detail),
  };
}

function maxIso(values: Array<string | null | undefined>) {
  let max: number | null = null;

  for (const value of values) {
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) continue;
    if (max === null || timestamp > max) max = timestamp;
  }

  return max === null ? null : new Date(max).toISOString();
}

export async function GET(request: NextRequest) {
  try {
    const matchIdParam = request.nextUrl.searchParams.get("matchId");
    const matchId = safeNumber(matchIdParam);

    if (matchId === null) {
      return NextResponse.json(
        { error: "Nieprawidłowy matchId." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const sofascoreEventId = await resolveSofaScoreEventId(supabase, matchId);

    const { data, error } = await supabase
      .from("match_events")
      .select(
        "id, match_id, team_id, player_name, minute, extra_minute, event_type, detail, created_at"
      )
      .eq("match_id", matchId)
      .order("minute", { ascending: true })
      .order("extra_minute", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: `Nie udało się pobrać timeline: ${error.message}` },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as MatchEventRow[];
    const items = rows.map(normalizeEvent);

    return NextResponse.json(
      {
        matchId,
        sofascoreEventId,
        externalUrl: sofascoreEventId
          ? `https://www.sofascore.com/event/${sofascoreEventId}`
          : null,
        items,
        updatedAt: maxIso(rows.map((row) => row.created_at)),
        source: "database",
        message: items.length
          ? null
          : "Brak zapisanych zdarzeń timeline w naszej bazie. Widget SofaScore może być niedostępny lub blokowany dla tego meczu.",
      } satisfies TimelineResponse,
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udało się pobrać timeline.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
