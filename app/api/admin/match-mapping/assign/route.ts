import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AssignBody = {
  matchId?: number | string;
  sofascoreEventId?: number | string;
  confidence?: number | string;
  notes?: string;
  mappingMethod?: string;
};

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Brak konfiguracji SUPABASE dla assign route.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getAdminSecret() {
  return process.env.ADMIN_SECRET ?? process.env.CRON_SECRET ?? null;
}

function isAuthorized(request: NextRequest) {
  const expected = getAdminSecret();

  if (!expected) {
    return true;
  }

  const headerSecret = request.headers.get("x-admin-secret");
  const cronSecret = request.headers.get("x-cron-secret");
  const querySecret = request.nextUrl.searchParams.get("secret");

  return (
    headerSecret === expected ||
    cronSecret === expected ||
    querySecret === expected
  );
}

function safeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
    }

    const body = (await request.json()) as AssignBody;

    const matchId = safeNumber(body.matchId);
    const sofascoreEventId = safeNumber(body.sofascoreEventId);
    const confidence = safeNumber(body.confidence) ?? 1;
    const notes = safeString(body.notes, "manual admin assignment");
    const mappingMethod = safeString(body.mappingMethod, "manual");

    if (matchId === null || sofascoreEventId === null) {
      return NextResponse.json(
        { error: "Wymagane: matchId i sofascoreEventId." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    const { error: upsertError } = await supabase
      .from("match_sofascore_map")
      .upsert(
        {
          match_id: matchId,
          sofascore_event_id: sofascoreEventId,
          mapping_method: mappingMethod,
          confidence,
          notes,
          widget_src: "admin-assign",
          updated_at: nowIso,
        },
        { onConflict: "match_id" }
      );

    if (upsertError) {
      return NextResponse.json(
        { error: `Nie udało się zapisać mapowania: ${upsertError.message}` },
        { status: 500 }
      );
    }

    const { error: queueError } = await supabase
      .from("match_mapping_queue")
      .update({
        status: "mapped",
        mapped_at: nowIso,
        locked_at: null,
        locked_by: null,
        last_error: null,
        updated_at: nowIso,
      })
      .eq("match_id", matchId);

    if (queueError) {
      return NextResponse.json(
        { error: `Mapowanie zapisane, ale kolejka nie została zaktualizowana: ${queueError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        matchId,
        sofascoreEventId,
        mappingMethod,
        confidence,
        notes,
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udało się przypisać mapowania.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  return NextResponse.json(
    {
      ok: true,
      message: "Użyj POST z matchId i sofascoreEventId.",
    },
    { status: 200 }
  );
}