// app/api/sofascore/mapping/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MappingRow = {
  match_id: number;
  sofascore_event_id: number;
  mapping_method?: string | null;
  confidence?: number | null;
  notes?: string | null;
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

function safeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  };
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

    const { data, error } = await supabase
      .from("match_sofascore_map")
      .select("match_id, sofascore_event_id, mapping_method, confidence, notes")
      .eq("match_id", matchId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: `Błąd odczytu mapowania: ${error.message}` },
        { status: 500 }
      );
    }

    const mapping = normalizeMappingRow(data);

    if (!mapping) {
      return NextResponse.json(
        {
          matchId,
          mapped: false,
          error: "Brak mapowania SofaScore dla tego meczu.",
        } satisfies MappingResponse,
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        matchId,
        mapped: true,
        sofascoreEventId: mapping.sofascore_event_id,
        confidence: mapping.confidence ?? undefined,
        mappingMethod:
          mapping.mapping_method === "manual" ? "manual" : "auto",
        notes: mapping.notes ?? undefined,
      } satisfies MappingResponse,
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Nie udało się odczytać mapowania SofaScore.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}