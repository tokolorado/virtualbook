// app/api/sofascore/live-score/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MappingRow = {
  match_id: number;
  sofascore_event_id: number;
  widget_src?: string | null;
};

function toMatchId(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function safeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractScore(event: any) {
  return {
    homeScore:
      safeNumber(event?.homeScore?.current) ??
      safeNumber(event?.homeScore?.display) ??
      safeNumber(event?.homeScore) ??
      null,
    awayScore:
      safeNumber(event?.awayScore?.current) ??
      safeNumber(event?.awayScore?.display) ??
      safeNumber(event?.awayScore) ??
      null,
  };
}

function extractStatus(event: any) {
  const description =
    typeof event?.status?.description === "string"
      ? event.status.description
      : null;

  const type =
    typeof event?.status?.type === "string" ? event.status.type : null;

  const live =
    event?.status?.type === "inprogress" ||
    event?.status?.type === "live" ||
    event?.status?.description === "LIVE";

  const finished =
    event?.status?.type === "finished" ||
    event?.status?.description === "FT";

  return {
    description,
    type,
    isLive: Boolean(live),
    isFinished: Boolean(finished),
  };
}

function buildBrowserLikeHeaders() {
  return {
    "accept": "application/json, text/plain, */*",
    "accept-language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
    "cache-control": "no-cache",
    "pragma": "no-cache",
    "referer": "https://www.sofascore.com/",
    "origin": "https://www.sofascore.com",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  };
}

async function fetchJsonWithDebug(url: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: buildBrowserLikeHeaders(),
    cache: "no-store",
  });

  const text = await response.text();
  let json: any = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    text,
    json,
    contentType: response.headers.get("content-type"),
  };
}


type SofaIncident = {
  isLive?: boolean;
  incidentType?: string;
  text?: string | null;
  homeScore?: number | string | null;
  awayScore?: number | string | null;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const matchId = toMatchId(url.searchParams.get("matchId"));

    if (!matchId) {
      return NextResponse.json(
        { error: "Missing or invalid matchId" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    const { data: mapping, error: mappingError } = await sb
      .from("match_sofascore_map")
      .select("match_id, sofascore_event_id, widget_src")
      .eq("match_id", matchId)
      .maybeSingle<MappingRow>();

    if (mappingError) {
      return NextResponse.json(
        { error: `Mapping query failed: ${mappingError.message}` },
        { status: 500 }
      );
    }

    if (!mapping?.sofascore_event_id) {
      return NextResponse.json(
        { error: "No SofaScore mapping for this match" },
        { status: 404 }
      );
    }

    const eventId = Number(mapping.sofascore_event_id);

    // Główny strzał: publiczny event endpoint
    const primaryUrl = `https://api.sofascore.com/api/v1/event/${eventId}`;
    const primary = await fetchJsonWithDebug(primaryUrl);

    if (primary.ok && primary.json) {
      const event = primary.json?.event ?? primary.json;
      const score = extractScore(event);
      const status = extractStatus(event);

      return NextResponse.json(
        {
          matchId,
          sofascoreEventId: eventId,
          source: "api_v1_event",
          status: status.description,
          statusType: status.type,
          isLive: status.isLive,
          isFinished: status.isFinished,
          homeScore: score.homeScore,
          awayScore: score.awayScore,
          raw: event,
        },
        { status: 200 }
      );
    }

    // Fallback debugowy: incidents endpoint często szybciej pokazuje stan meczu
    const incidentsUrl = `https://api.sofascore.com/api/v1/event/${eventId}/incidents`;
    const incidents = await fetchJsonWithDebug(incidentsUrl);

    if (incidents.ok && incidents.json) {
      const incidentsList: SofaIncident[] = Array.isArray(incidents.json?.incidents)
            ? (incidents.json.incidents as SofaIncident[])
            : [];

      const lastScoreIncident = [...incidentsList]
        .reverse()
        .find(
          (item) =>
            typeof item?.homeScore !== "undefined" ||
            typeof item?.awayScore !== "undefined"
        );

      const homeScore = safeNumber(lastScoreIncident?.homeScore);
      const awayScore = safeNumber(lastScoreIncident?.awayScore);

      const periodIncident = [...incidentsList]
        .reverse()
        .find((item) => item?.incidentType === "period");

      const statusText =
        typeof periodIncident?.text === "string" ? periodIncident.text : null;

      const isFinished = statusText === "FT";
      const isLive = !isFinished && incidentsList.some((x) => x?.isLive === true);

      return NextResponse.json(
        {
          matchId,
          sofascoreEventId: eventId,
          source: "api_v1_event_incidents",
          status: statusText,
          statusType: null,
          isLive,
          isFinished,
          homeScore,
          awayScore,
          raw: {
            incidentsCount: incidentsList.length,
            lastScoreIncident: lastScoreIncident ?? null,
          },
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        error: "SofaScore upstream blocked or unavailable",
        matchId,
        sofascoreEventId: eventId,
        tried: [
          {
            url: primaryUrl,
            status: primary.status,
            contentType: primary.contentType,
            bodyPreview: primary.text?.slice(0, 300) ?? "",
          },
          {
            url: incidentsUrl,
            status: incidents.status,
            contentType: incidents.contentType,
            bodyPreview: incidents.text?.slice(0, 300) ?? "",
          },
        ],
      },
      { status: 502 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown live-score endpoint error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}