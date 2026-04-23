import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  mapping_method?: string | null;
  confidence?: number | null;
  notes?: string | null;
  widget_src?: string | null;
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

type MappingResponse = {
  matchId: number;
  mapped: boolean;
  sofascoreEventId?: number;
  confidence?: number;
  mappingMethod?: "manual" | "auto";
  notes?: string;
  error?: string;
};

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Brak konfiguracji SUPABASE dla route mapping.");
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

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function safeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMatchRow(input: unknown): MatchRow {
  const row =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  return {
    id: safeNumber(row.id) ?? 0,
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
    mapping_method: safeNullableString(row.mapping_method),
    confidence: safeNumber(row.confidence),
    notes: safeNullableString(row.notes),
    widget_src: safeNullableString(row.widget_src),
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
  const stop = new Set([
    "fc",
    "cf",
    "sc",
    "afc",
    "club",
    "de",
    "the",
  ]);

  return normalizeText(value)
    .split(" ")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !stop.has(item));
}

function similarityScore(a: string | null | undefined, b: string | null | undefined) {
  const na = normalizeText(a);
  const nb = normalizeText(b);

  if (!na || !nb) return 0;
  if (na === nb) return 1;

  if (na.includes(nb) || nb.includes(na)) {
    return 0.9;
  }

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

function kickoffScore(currentUtcDate: string | null, candidateStartTimestamp: number | null) {
  if (!currentUtcDate || candidateStartTimestamp === null) return 0.35;

  const currentTs = Date.parse(currentUtcDate);
  const candidateTs = candidateStartTimestamp * 1000;

  if (!Number.isFinite(currentTs) || !Number.isFinite(candidateTs)) return 0.35;

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

async function fetchScheduledEvents(dateOnly: string): Promise<SofaScoreScheduledEvent[]> {
  const url = `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${dateOnly}`;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      "user-agent": "VirtualBook/1.0",
      accept: "application/json",
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

  const total =
    teamScore * 0.72 +
    dateScore * 0.23 +
    compScore * 0.05;

  return {
    eventId,
    homeName,
    awayName,
    tournamentName,
    startTimestamp,
    isReversed,
    confidence: Number((total * 100).toFixed(3)),
    notes: `team=${teamScore.toFixed(3)} date=${dateScore.toFixed(3)} comp=${compScore.toFixed(3)} reversed=${isReversed}`,
  };
}

export async function GET(request: NextRequest) {
  try {
    const matchIdParam = request.nextUrl.searchParams.get("matchId");
    const force = request.nextUrl.searchParams.get("force") === "1";
    const matchId = safeNumber(matchIdParam);

    if (matchId === null) {
      return NextResponse.json(
        { error: "Nieprawidłowy matchId." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    if (!force) {
      const { data: existingRaw, error: existingError } = await supabase
        .from("match_sofascore_map")
        .select(
          "match_id, sofascore_event_id, mapping_method, confidence, notes, widget_src"
        )
        .eq("match_id", matchId)
        .maybeSingle();

      if (existingError) {
        return NextResponse.json(
          { error: `Błąd odczytu mapowania: ${existingError.message}` },
          { status: 500 }
        );
      }

      const existing = normalizeMappingRow(existingRaw);

      if (existing) {
        return NextResponse.json(
          {
            matchId,
            mapped: true,
            sofascoreEventId: existing.sofascore_event_id,
            confidence: existing.confidence ?? undefined,
            mappingMethod:
              existing.mapping_method === "manual" ? "manual" : "auto",
            notes: existing.notes ?? undefined,
          } satisfies MappingResponse,
          { status: 200 }
        );
      }
    }

    const { data: matchRaw, error: matchError } = await supabase
      .from("matches")
      .select("id, utc_date, competition_name, home_team, away_team")
      .eq("id", matchId)
      .maybeSingle();

    if (matchError) {
      return NextResponse.json(
        { error: `Nie udało się pobrać meczu: ${matchError.message}` },
        { status: 500 }
      );
    }

    if (!matchRaw) {
      return NextResponse.json(
        { error: "Nie znaleziono meczu." },
        { status: 404 }
      );
    }

    const matchRow = normalizeMatchRow(matchRaw);

    const baseDate =
      (matchRow.utc_date && toUtcDateOnly(matchRow.utc_date)) ??
      toUtcDateOnly(new Date().toISOString());

    if (!baseDate) {
      return NextResponse.json(
        {
          matchId,
          mapped: false,
          error: "Nie udało się ustalić daty meczu do auto-mapowania.",
        } satisfies MappingResponse,
        { status: 404 }
      );
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
        if (!current || (candidate.confidence ?? 0) > (current?.confidence ?? 0)) {
          candidatesMap.set(candidate.eventId, candidate);
        }
      }
    }

    const candidates = Array.from(candidatesMap.values())
      .filter((item): item is NonNullable<typeof item> => !!item)
      .sort((a, b) => b.confidence - a.confidence);

    const best = candidates[0] ?? null;

    if (!best || best.confidence < 58) {
      return NextResponse.json(
        {
          matchId,
          mapped: false,
          error: "Nie znaleziono wiarygodnego mapowania SofaScore dla tego meczu.",
          notes: best ? `best_confidence=${best.confidence}` : "no_candidates",
        } satisfies MappingResponse,
        { status: 404 }
      );
    }

    const { error: upsertError } = await supabase
      .from("match_sofascore_map")
      .upsert(
        {
          match_id: matchId,
          sofascore_event_id: best.eventId,
          mapping_method: "auto",
          confidence: best.confidence,
          notes: best.notes,
          widget_src: "scheduled-events",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "match_id" }
      );

    if (upsertError) {
      return NextResponse.json(
        { error: `Nie udało się zapisać mapowania: ${upsertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        matchId,
        mapped: true,
        sofascoreEventId: best.eventId,
        confidence: best.confidence,
        mappingMethod: "auto",
        notes: best.notes,
      } satisfies MappingResponse,
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Nie udało się wykonać auto-mapowania SofaScore.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}