import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MappingRow = {
  match_id: number;
  sofascore_event_id: number;
  mapping_method: string | null;
  confidence: number | null;
  notes: string | null;
  updated_at: string | null;
};

type ApiCacheRow = {
  payload: any;
  updated_at: string | null;
};

function toPositiveInt(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function safeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFinite(...values: Array<number | null>): number | null {
  for (const value of values) {
    if (value !== null && Number.isFinite(value)) return value;
  }
  return null;
}

function eventCacheKey(eventId: number) {
  return `sofascore:event:${eventId}:summary`;
}

function scoreFromSide(side: any): number | null {
  return firstFinite(
    safeNumber(side?.current),
    safeNumber(side?.display),
    safeNumber(side?.normaltime),
    safeNumber(side?.period1),
    safeNumber(side?.extra1),
    safeNumber(side?.extra2)
  );
}

function normalizeStatus(event: any) {
  const rawType = safeString(event?.status?.type).toUpperCase();
  const rawDescription = safeString(event?.status?.description).toUpperCase();
  const statusText = `${rawType} ${rawDescription}`.trim();

  const isFinished =
    statusText.includes("FINISHED") ||
    statusText.includes("ENDED") ||
    statusText.includes("FT");

  const isLive =
    !isFinished &&
    (
      statusText.includes("INPROGRESS") ||
      statusText.includes("LIVE") ||
      statusText.includes("1ST") ||
      statusText.includes("2ND") ||
      statusText.includes("HT") ||
      statusText.includes("ET") ||
      statusText.includes("PEN")
    );

  const label =
    safeString(event?.status?.description) ||
    safeString(event?.status?.type) ||
    "UNKNOWN";

  return {
    rawType: rawType || null,
    rawDescription: rawDescription || null,
    label,
    isLive,
    isFinished,
  };
}

function cacheTtlMs(payload: any): number {
  if (payload?.isFinished) return 5 * 60 * 1000;
  if (payload?.isLive) return 15 * 1000;
  return 60 * 1000;
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "VirtualBook/1.0",
      },
    });

    const text = await response.text();
    let json: any = null;

    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    if (!response.ok) {
      const message =
        safeString(json?.error) ||
        safeString(json?.message) ||
        `SofaScore HTTP ${response.status}`;
      throw new Error(message);
    }

    return json;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const matchId = toPositiveInt(url.searchParams.get("matchId"));
    const eventIdFromQuery = toPositiveInt(url.searchParams.get("eventId"));

    if (!matchId && !eventIdFromQuery) {
      return NextResponse.json(
        { error: "Podaj matchId albo eventId." },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    let mapping: MappingRow | null = null;
    let eventId = eventIdFromQuery;

    if (!eventId && matchId) {
      const { data, error } = await sb
        .from("match_sofascore_map")
        .select(
          "match_id, sofascore_event_id, mapping_method, confidence, notes, updated_at"
        )
        .eq("match_id", matchId)
        .maybeSingle<MappingRow>();

      if (error) {
        return NextResponse.json(
          { error: `Błąd mapowania SofaScore: ${error.message}` },
          { status: 500 }
        );
      }

      mapping = data ?? null;
      eventId = data?.sofascore_event_id ?? null;
    }

    if (!eventId) {
      return NextResponse.json(
        {
          error:
            "Brak mapowania match_id -> sofascore_event_id. Dodaj rekord do match_sofascore_map.",
          matchId,
        },
        { status: 404 }
      );
    }

    const cacheKey = eventCacheKey(eventId);

    const { data: cacheRow, error: cacheReadError } = await sb
      .from("api_cache")
      .select("payload, updated_at")
      .eq("key", cacheKey)
      .maybeSingle<ApiCacheRow>();

    if (!cacheReadError && cacheRow?.updated_at) {
      const ageMs = Date.now() - new Date(cacheRow.updated_at).getTime();
      const ttl = cacheTtlMs(cacheRow.payload);

      if (ageMs >= 0 && ageMs < ttl) {
        return NextResponse.json({
          ...cacheRow.payload,
          cached: true,
          cacheAgeMs: ageMs,
        });
      }
    }

    const json = await fetchJson(`https://api.sofascore.com/api/v1/event/${eventId}`);
    const event = typeof json?.event === "object" && json?.event !== null ? json.event : json;

    const status = normalizeStatus(event);

    const startTimestamp = safeNumber(event?.startTimestamp);
    const kickoffUtc =
      startTimestamp !== null
        ? new Date(startTimestamp * 1000).toISOString()
        : null;

    const payload = {
      provider: "sofascore",
      matchId: matchId ?? null,
      sofascoreEventId: eventId,
      homeTeam: safeString(event?.homeTeam?.name, ""),
      awayTeam: safeString(event?.awayTeam?.name, ""),
      homeScore: scoreFromSide(event?.homeScore),
      awayScore: scoreFromSide(event?.awayScore),
      status: status.label,
      statusType: status.rawType,
      statusDescription: status.rawDescription,
      isLive: status.isLive,
      isFinished: status.isFinished,
      startTimestamp,
      kickoffUtc,
      winnerCode: safeNumber(event?.winnerCode),
      slug: safeString(event?.slug, ""),
      customId: safeString(event?.customId, ""),
      cached: false,
      mappedBy: mapping?.mapping_method ?? null,
      mappingConfidence: mapping?.confidence ?? null,
      fetchedAt: new Date().toISOString(),
    };

    await sb.from("api_cache").upsert({
      key: cacheKey,
      payload,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nieznany błąd live-score route";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}