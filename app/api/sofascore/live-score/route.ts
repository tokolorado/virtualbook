import { NextResponse } from "next/server";
import { getMappedSofascoreEventId } from "@/lib/sofascore/mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOFASCORE_BASE = "https://api.sofascore.com/api/v1";

function toMatchId(value: string | null): number | null {
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

function toIsoFromSeconds(value: unknown): string | null {
  const seconds = safeNumber(value);
  if (seconds === null) return null;
  return new Date(seconds * 1000).toISOString();
}

function normalizeStatus(status: any) {
  const type = safeString(status?.type).toLowerCase();
  const description = safeString(status?.description);
  const code = safeNumber(status?.code);

  const descUpper = description.toUpperCase();

  const isFinished =
    type === "finished" ||
    descUpper === "FT" ||
    descUpper === "AET" ||
    descUpper === "PEN";

  const isLive =
    type === "inprogress" ||
    type === "live" ||
    descUpper === "LIVE" ||
    descUpper === "HT" ||
    descUpper === "1H" ||
    descUpper === "2H" ||
    descUpper === "ET";

  return {
    type: type || null,
    description: description || null,
    code,
    isLive,
    isFinished,
  };
}

function pickScore(sideScore: any): number | null {
  return (
    safeNumber(sideScore?.current) ??
    safeNumber(sideScore?.display) ??
    safeNumber(sideScore?.normaltime) ??
    safeNumber(sideScore)
  );
}

async function fetchSofascoreJson(path: string) {
  const response = await fetch(`${SOFASCORE_BASE}${path}`, {
    method: "GET",
    cache: "no-store",
    headers: {
      accept: "application/json, text/plain, */*",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      referer: "https://www.sofascore.com/",
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
    throw new Error(
      `Sofascore fetch failed (${response.status}): ${
        typeof json?.error === "string"
          ? json.error
          : typeof json?.message === "string"
            ? json.message
            : typeof json?.raw === "string"
              ? json.raw.slice(0, 300)
              : "unknown error"
      }`
    );
  }

  return json;
}

function normalizeEvent(payload: any, sofascoreEventId: number) {
  const event = payload?.event && typeof payload.event === "object"
    ? payload.event
    : payload;

  const status = normalizeStatus(event?.status);

  return {
    sofascoreEventId,
    homeTeam: {
      id: safeNumber(event?.homeTeam?.id),
      name: safeString(event?.homeTeam?.name, "Home"),
      shortName: safeString(event?.homeTeam?.shortName),
      score: pickScore(event?.homeScore),
    },
    awayTeam: {
      id: safeNumber(event?.awayTeam?.id),
      name: safeString(event?.awayTeam?.name, "Away"),
      shortName: safeString(event?.awayTeam?.shortName),
      score: pickScore(event?.awayScore),
    },
    tournament: {
      id: safeNumber(event?.tournament?.id),
      name: safeString(event?.tournament?.name),
      slug: safeString(event?.tournament?.slug),
      category: safeString(event?.tournament?.category?.name),
    },
    season: {
      id: safeNumber(event?.season?.id),
      name: safeString(event?.season?.name),
    },
    roundInfo: {
      round: safeNumber(event?.roundInfo?.round),
      name: safeString(event?.roundInfo?.name),
    },
    startTimestamp: safeNumber(event?.startTimestamp),
    kickoffUtc: toIsoFromSeconds(event?.startTimestamp),
    status,
    winnerCode: safeNumber(event?.winnerCode),
  };
}

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

    const sofascoreEventId = await getMappedSofascoreEventId(matchId);

    if (!sofascoreEventId) {
      return NextResponse.json(
        {
          error: "No SofaScore mapping for this match",
          matchId,
          mapped: false,
        },
        { status: 404 }
      );
    }

    const payload = await fetchSofascoreJson(`/event/${sofascoreEventId}`);
    const normalized = normalizeEvent(payload, sofascoreEventId);

    return NextResponse.json(
      {
        matchId,
        mapped: true,
        liveScore: normalized,
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown live-score error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}