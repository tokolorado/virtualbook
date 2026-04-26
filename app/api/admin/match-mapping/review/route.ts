//app/api/admin/match-mapping/review/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MatchDetails = {
  utc_date: string | null;
  competition_name: string | null;
  home_team: string;
  away_team: string;
};

type MappingDetails = {
  sofascore_event_id: number;
  mapping_method: string | null;
  confidence: number | null;
};

type ReviewRow = {
  match_id: number;
  status: string;
  attempts: number;
  last_error: string | null;
  next_retry_at: string | null;
  updated_at: string | null;
  mapped_at: string | null;
  match: MatchDetails | null;
  mapping: MappingDetails | null;
};

type RawMatchDetails = {
  utc_date?: unknown;
  competition_name?: unknown;
  home_team?: unknown;
  away_team?: unknown;
};

type RawQueueRow = {
  match_id: unknown;
  status: unknown;
  attempts: unknown;
  last_error: unknown;
  next_retry_at: unknown;
  updated_at: unknown;
  mapped_at: unknown;
  match?: RawMatchDetails | RawMatchDetails[] | null;
};

type RawMappingRow = {
  match_id?: unknown;
  sofascore_event_id?: unknown;
  mapping_method?: unknown;
  confidence?: unknown;
};

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function safeNumber(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeNullableNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function safeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMatchDetails(input: unknown): MatchDetails | null {
  if (typeof input !== "object" || input === null) return null;

  const row = input as Record<string, unknown>;

  return {
    utc_date: safeNullableString(row.utc_date),
    competition_name: safeNullableString(row.competition_name),
    home_team: safeString(row.home_team, "Home"),
    away_team: safeString(row.away_team, "Away"),
  };
}

function normalizeMappingDetails(input: unknown): MappingDetails | null {
  if (typeof input !== "object" || input === null) return null;

  const row = input as Record<string, unknown>;
  const eventId = safeNullableNumber(row.sofascore_event_id);

  if (eventId === null) return null;

  return {
    sofascore_event_id: eventId,
    mapping_method: safeNullableString(row.mapping_method),
    confidence: safeNullableNumber(row.confidence),
  };
}

function normalizeQueueRow(input: RawQueueRow): Omit<ReviewRow, "mapping"> {
  const rawMatch = Array.isArray(input.match)
    ? input.match[0] ?? null
    : input.match ?? null;

  return {
    match_id: safeNumber(input.match_id),
    status: safeString(input.status, "needs_review"),
    attempts: safeNumber(input.attempts),
    last_error: safeNullableString(input.last_error),
    next_retry_at: safeNullableString(input.next_retry_at),
    updated_at: safeNullableString(input.updated_at),
    mapped_at: safeNullableString(input.mapped_at),
    match: normalizeMatchDetails(rawMatch),
  };
}

export async function GET(req: Request) {
  const guard = await requireAdmin(req);

  if (!guard.ok) {
    return json(guard.status, {
      ok: false,
      error: guard.error,
      items: [],
    });
  }

  try {
    const supabase = supabaseAdmin();

    const nowIso = new Date().toISOString();
    const next24hIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { data: queueData, error: queueError } = await supabase
      .from("match_mapping_queue")
      .select(
        `
        match_id,
        status,
        attempts,
        last_error,
        next_retry_at,
        updated_at,
        mapped_at,
        match:matches!inner (
          utc_date,
          competition_name,
          home_team,
          away_team
        )
      `
      )
      .in("status", ["needs_review", "failed"])
      .gte("match.utc_date", nowIso)
      .lte("match.utc_date", next24hIso)
      .order("utc_date", {
        referencedTable: "match",
        ascending: true,
      })
      .limit(100);

    if (queueError) {
      return json(500, {
        ok: false,
        error: queueError.message,
        items: [],
      });
    }

    const queueRows = ((queueData ?? []) as unknown as RawQueueRow[])
      .map(normalizeQueueRow)
      .filter((row) => row.match_id > 0);

    if (queueRows.length === 0) {
      return json(200, {
        ok: true,
        items: [],
        count: 0,
        window: "next_24h",
      });
    }

    const matchIds = queueRows.map((row) => row.match_id);

    const { data: mappingData, error: mappingError } = await supabase
      .from("match_sofascore_map")
      .select(
        `
        match_id,
        sofascore_event_id,
        mapping_method,
        confidence
      `
      )
      .in("match_id", matchIds);

    if (mappingError) {
      return json(500, {
        ok: false,
        error: mappingError.message,
        items: [],
      });
    }

    const mappingByMatchId = new Map<number, MappingDetails>();

    for (const rawMapping of (mappingData ?? []) as unknown as RawMappingRow[]) {
      const matchId = safeNullableNumber(rawMapping.match_id);
      const mapping = normalizeMappingDetails(rawMapping);

      if (matchId !== null && mapping) {
        mappingByMatchId.set(matchId, mapping);
      }
    }

    const items: ReviewRow[] = queueRows.map((row) => ({
      ...row,
      mapping: mappingByMatchId.get(row.match_id) ?? null,
    }));

    return json(200, {
      ok: true,
      items,
      count: items.length,
      window: "next_24h",
    });
  } catch (e: unknown) {
    return json(500, {
      ok: false,
      error: e instanceof Error ? e.message : "Nie udało się pobrać review items.",
      items: [],
    });
  }
}