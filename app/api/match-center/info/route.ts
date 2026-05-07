import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

type MatchInfoRow = {
  id: number;
  competition_id: string | null;
  competition_name: string | null;
  season: string | null;
  matchday: number | null;
  source_event_id: string | null;
  source_league_id: string | null;
  source_season_id: string | null;
  source_round_name: string | null;
  group_name: string | null;
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
  raw_bsd: unknown | null;
  last_sync_at: string | null;
};

function safeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(obj: UnknownRecord | null, key: string) {
  const value = obj?.[key];
  return isRecord(value) ? value : null;
}

function readString(obj: UnknownRecord | null, key: string) {
  return safeString(obj?.[key]);
}

function readNumber(obj: UnknownRecord | null, key: string) {
  return safeNumber(obj?.[key]);
}

function readBool(obj: UnknownRecord | null, key: string) {
  const value = obj?.[key];
  return typeof value === "boolean" ? value : null;
}

function personName(value: unknown) {
  if (typeof value === "string" || typeof value === "number") {
    return safeString(value);
  }

  if (!isRecord(value)) return null;

  return (
    readString(value, "name") ??
    readString(value, "full_name") ??
    readString(value, "display_name") ??
    readString(value, "short_name")
  );
}

function venueFromRaw(raw: UnknownRecord | null) {
  const direct = readRecord(raw, "venue");
  if (direct) return direct;

  const homeTeam = readRecord(raw, "home_team_obj");
  return readRecord(homeTeam, "venue");
}

function hasAnyValue(value: Record<string, unknown>) {
  return Object.values(value).some(
    (item) => item !== null && item !== undefined && item !== ""
  );
}

export async function GET(request: NextRequest) {
  const matchId = safeNumber(request.nextUrl.searchParams.get("matchId"));

  if (matchId === null) {
    return NextResponse.json(
      { ok: false, error: "Invalid matchId" },
      { status: 400 }
    );
  }

  try {
    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("matches")
      .select(
        "id, competition_id, competition_name, season, matchday, source_event_id, source_league_id, source_season_id, source_round_name, group_name, venue_id, venue_name, venue_city, venue_country, venue_capacity, venue_latitude, venue_longitude, home_coach_name, away_coach_name, referee, is_neutral_ground, is_local_derby, travel_distance_km, weather_code, wind_speed, temperature_c, pitch_condition, attendance, raw_bsd, last_sync_at"
      )
      .eq("source", "bsd")
      .eq("id", Math.trunc(matchId))
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: `Match info read failed: ${error.message}` },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Match not found" },
        { status: 404 }
      );
    }

    const row = data as MatchInfoRow;
    const raw = isRecord(row.raw_bsd) ? row.raw_bsd : null;
    const venue = venueFromRaw(raw);
    const refereeRaw = readRecord(raw, "referee");
    const homeCoachRaw = readRecord(raw, "home_coach");
    const awayCoachRaw = readRecord(raw, "away_coach");

    const payload = {
      ok: true,
      matchId: row.id,
      available: true,
      competition: {
        id: row.competition_id,
        name: row.competition_name,
        season: row.season,
        round: row.source_round_name,
        matchday: row.matchday,
        group: row.group_name,
      },
      venue: {
        id: row.venue_id ?? readNumber(venue, "id"),
        name: row.venue_name ?? readString(venue, "name"),
        city: row.venue_city ?? readString(venue, "city"),
        country: row.venue_country ?? readString(venue, "country"),
        capacity: row.venue_capacity ?? readNumber(venue, "capacity"),
        latitude: row.venue_latitude ?? readNumber(venue, "latitude"),
        longitude: row.venue_longitude ?? readNumber(venue, "longitude"),
      },
      officials: {
        referee: row.referee ?? personName(refereeRaw),
      },
      coaches: {
        home: row.home_coach_name ?? personName(homeCoachRaw),
        away: row.away_coach_name ?? personName(awayCoachRaw),
      },
      context: {
        neutralGround:
          row.is_neutral_ground ?? readBool(raw, "is_neutral_ground"),
        localDerby: row.is_local_derby ?? readBool(raw, "is_local_derby"),
        travelDistanceKm:
          row.travel_distance_km ?? readNumber(raw, "travel_distance_km"),
        attendance: row.attendance ?? readNumber(raw, "attendance"),
      },
      conditions: {
        weatherCode: row.weather_code ?? readString(raw, "weather_code"),
        temperatureC: row.temperature_c ?? readNumber(raw, "temperature_c"),
        windSpeed: row.wind_speed ?? readNumber(raw, "wind_speed"),
        pitchCondition:
          row.pitch_condition ?? readString(raw, "pitch_condition"),
      },
      source: {
        provider: "bsd",
        eventId: row.source_event_id,
        leagueId: row.source_league_id,
        seasonId: row.source_season_id,
      },
      updatedAt: row.last_sync_at,
    };

    const displayableCompetition = {
      season: payload.competition.season,
      round: payload.competition.round,
      matchday: payload.competition.matchday,
      group: payload.competition.group,
    };

    const displayableConditions = {
      weatherCode: payload.conditions.weatherCode,
      pitchCondition: payload.conditions.pitchCondition,
    };

    return NextResponse.json({
      ...payload,
      available:
        hasAnyValue(payload.venue) ||
        hasAnyValue(payload.officials) ||
        hasAnyValue(payload.context) ||
        hasAnyValue(displayableCompetition) ||
        hasAnyValue(displayableConditions),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Match info endpoint failed",
      },
      { status: 500 }
    );
  }
}
