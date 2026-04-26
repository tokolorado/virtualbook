import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://api.football-data.org/v4";

function jsonError(message: string, status = 500, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;

  return Math.trunc(n);
}

function readPath(source: unknown, path: string[]): unknown {
  let current = source;

  for (const key of path) {
    if (current === null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function pickMatchScore(match: unknown, side: "home" | "away"): number | null {
  const fullTime = toIntOrNull(readPath(match, ["score", "fullTime", side]));
  if (fullTime !== null) return fullTime;

  const regularTime = toIntOrNull(readPath(match, ["score", "regularTime", side]));
  if (regularTime !== null) return regularTime;

  const halfTime = toIntOrNull(readPath(match, ["score", "halfTime", side]));
  if (halfTime !== null) return halfTime;

  return null;
}

function pickMatchMinute(match: unknown): number | null {
  const direct = toIntOrNull(readPath(match, ["minute"]));
  if (direct !== null && direct >= 0) return direct;

  const statusMinute = toIntOrNull(readPath(match, ["status", "minute"]));
  if (statusMinute !== null && statusMinute >= 0) return statusMinute;

  return null;
}

function pickInjuryTime(match: unknown): number | null {
  const direct = toIntOrNull(readPath(match, ["injuryTime"]));
  if (direct !== null && direct >= 0) return direct;

  const statusInjuryTime = toIntOrNull(readPath(match, ["status", "injuryTime"]));
  if (statusInjuryTime !== null && statusInjuryTime >= 0) return statusInjuryTime;

  return null;
}

function normalizeStatus(status: unknown) {
  const s = String(status ?? "").toUpperCase().trim();

  if (s === "LIVE") return "IN_PLAY";
  if (s === "CANCELLED") return "CANCELED";

  if (
    s === "SCHEDULED" ||
    s === "TIMED" ||
    s === "IN_PLAY" ||
    s === "PAUSED" ||
    s === "FINISHED" ||
    s === "POSTPONED" ||
    s === "SUSPENDED" ||
    s === "AWARDED" ||
    s === "CANCELED"
  ) {
    return s;
  }

  return "SCHEDULED";
}

function isLiveStatus(status: string) {
  return status === "IN_PLAY" || status === "PAUSED";
}

function canExposeDisplayScore(status: string) {
  return isLiveStatus(status) || status === "FINISHED";
}

function getMatchPayload(data: unknown): unknown {
  if (data !== null && typeof data === "object" && "match" in data) {
    return (data as { match?: unknown }).match ?? null;
  }

  return data;
}

export async function GET(req: Request) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!apiKey) {
    return jsonError("Missing FOOTBALL_DATA_API_KEY in env", 500);
  }

  const { searchParams } = new URL(req.url);
  const matchIdRaw = searchParams.get("matchId");
  const matchId = Number(matchIdRaw);

  if (!Number.isInteger(matchId) || matchId <= 0) {
    return jsonError("Missing or invalid matchId", 400);
  }

  const upstream = await fetch(`${BASE}/matches/${encodeURIComponent(String(matchId))}`, {
    headers: { "X-Auth-Token": apiKey },
    cache: "no-store",
  });

  const text = await upstream.text();
  const data = safeJson(text);

  if (!upstream.ok) {
    return jsonError("football-data live score request failed", upstream.status, {
      upstream: data,
    });
  }

  const match = getMatchPayload(data);
  if (!match || typeof match !== "object") {
    return jsonError("Missing match in upstream response", 502, { upstream: data });
  }

  const status = normalizeStatus(readPath(match, ["status"]));
  const exposeScore = canExposeDisplayScore(status);
  const homeScore = exposeScore ? pickMatchScore(match, "home") : null;
  const awayScore = exposeScore ? pickMatchScore(match, "away") : null;
  const isLive = isLiveStatus(status);

  return NextResponse.json({
    ok: true,
    matchId,
    displayOnly: true,
    persisted: false,
    source: "football-data",
    status,
    isLive,
    isFinished: status === "FINISHED",
    homeScore,
    awayScore,
    minute: isLive ? pickMatchMinute(match) : null,
    injuryTime: isLive ? pickInjuryTime(match) : null,
    updatedAt: new Date().toISOString(),
  });
}
