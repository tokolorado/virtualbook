import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCronSecret } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MatchCandidate = {
  id: number;
  utc_date: string | null;
  status: string | null;
};

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Brak konfiguracji SUPABASE dla enqueue-match-mapping.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function safeNumber(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeMatchCandidate(input: unknown): MatchCandidate {
  const row =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  return {
    id: safeNumber(row.id, 0),
    utc_date: typeof row.utc_date === "string" ? row.utc_date : null,
    status: typeof row.status === "string" ? row.status : null,
  };
}

function hoursFromNow(offsetHours: number) {
  const dt = new Date();
  dt.setHours(dt.getHours() + offsetHours);
  return dt.toISOString();
}

export async function POST(request: NextRequest) {
  try {
    const unauthorized = requireCronSecret(request);
    if (unauthorized) return unauthorized;

    const lookbackHours = safeNumber(
      request.nextUrl.searchParams.get("lookbackHours"),
      12
    );
    const lookaheadHours = safeNumber(
      request.nextUrl.searchParams.get("lookaheadHours"),
      96
    );
    const limit = safeNumber(request.nextUrl.searchParams.get("limit"), 300);

    const fromIso = hoursFromNow(-lookbackHours);
    const toIso = hoursFromNow(lookaheadHours);

    const supabase = getSupabaseAdmin();

    const { data: matchesRaw, error: matchesError } = await supabase
      .from("matches")
      .select("id, utc_date, status")
      .gte("utc_date", fromIso)
      .lte("utc_date", toIso)
      .order("utc_date", { ascending: true })
      .limit(limit);

    if (matchesError) {
      return NextResponse.json(
        { error: `Nie udało się pobrać meczów: ${matchesError.message}` },
        { status: 500 }
      );
    }

    const matches = ((matchesRaw ?? []) as unknown[])
      .map(normalizeMatchCandidate)
      .filter((row) => row.id > 0);

    if (matches.length === 0) {
      return NextResponse.json(
        {
          ok: true,
          scanned: 0,
          enqueued: 0,
          message: "Brak meczów w oknie czasowym.",
        },
        { status: 200 }
      );
    }

    const matchIds = matches.map((m) => m.id);

    const [{ data: mappedRaw, error: mappedError }, { data: queuedRaw, error: queuedError }] =
      await Promise.all([
        supabase
          .from("match_sofascore_map")
          .select("match_id")
          .in("match_id", matchIds),

        supabase
          .from("match_mapping_queue")
          .select("match_id")
          .in("match_id", matchIds),
      ]);

    if (mappedError) {
      return NextResponse.json(
        { error: `Nie udało się pobrać mapowań: ${mappedError.message}` },
        { status: 500 }
      );
    }

    if (queuedError) {
      return NextResponse.json(
        { error: `Nie udało się pobrać kolejki: ${queuedError.message}` },
        { status: 500 }
      );
    }

    const mappedSet = new Set(
      ((mappedRaw ?? []) as Array<{ match_id?: number | null }>)
        .map((row) => row.match_id)
        .filter((id): id is number => Number.isFinite(id))
    );

    const queuedSet = new Set(
      ((queuedRaw ?? []) as Array<{ match_id?: number | null }>)
        .map((row) => row.match_id)
        .filter((id): id is number => Number.isFinite(id))
    );

    const toInsert = matches
      .filter((match) => !mappedSet.has(match.id) && !queuedSet.has(match.id))
      .map((match) => ({
        match_id: match.id,
        status: "pending",
      }));

    if (toInsert.length === 0) {
      return NextResponse.json(
        {
          ok: true,
          scanned: matches.length,
          enqueued: 0,
          message: "Brak nowych rekordów do dodania do kolejki.",
        },
        { status: 200 }
      );
    }

    const { error: insertError } = await supabase
      .from("match_mapping_queue")
      .insert(toInsert);

    if (insertError) {
      return NextResponse.json(
        { error: `Nie udało się dodać do kolejki: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        scanned: matches.length,
        enqueued: toInsert.length,
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Nie udało się uruchomić enqueue-match-mapping.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
