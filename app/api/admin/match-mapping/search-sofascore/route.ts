//app/api/admin/match-mapping/search-sofascore/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MatchRow = {
  id: number;
  utc_date: string | null;
  competition_name: string | null;
  home_team: string | null;
  away_team: string | null;
};

type SofaCandidate = {
  eventId: number;
  homeTeam: string;
  awayTeam: string;
  tournament: string | null;
  category: string | null;
  startTimestamp: number | null;
  startTime: string | null;
  status: string | null;
  score: number;
  sourceQuery: string;
  url: string;
};

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function readNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNullableNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(fc|cf|sc|afc|club|de|la|the|calcio|ud|cd|rcd|ss)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string) {
  return normalizeName(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function tokenScore(expected: string, actual: string) {
  const expectedNorm = normalizeName(expected);
  const actualNorm = normalizeName(actual);

  if (!expectedNorm || !actualNorm) return 0;
  if (expectedNorm === actualNorm) return 100;
  if (actualNorm.includes(expectedNorm) || expectedNorm.includes(actualNorm)) {
    return 88;
  }

  const expectedTokens = tokens(expected);
  const actualTokens = new Set(tokens(actual));

  if (expectedTokens.length === 0) return 0;

  const matched = expectedTokens.filter((token) => actualTokens.has(token)).length;
  const coverage = matched / expectedTokens.length;

  return Math.round(coverage * 80);
}

function teamPairScore(args: {
  expectedHome: string;
  expectedAway: string;
  actualHome: string;
  actualAway: string;
}) {
  const direct =
    (tokenScore(args.expectedHome, args.actualHome) +
      tokenScore(args.expectedAway, args.actualAway)) /
    2;

  const reversed =
    (tokenScore(args.expectedHome, args.actualAway) +
      tokenScore(args.expectedAway, args.actualHome)) /
    2;

  return Math.round(Math.max(direct, reversed));
}

function dateScore(matchUtcDate: string | null, eventStartTimestamp: number | null) {
  if (!matchUtcDate || eventStartTimestamp === null) return 0;

  const matchTs = Date.parse(matchUtcDate);
  const eventTs = eventStartTimestamp * 1000;

  if (!Number.isFinite(matchTs) || !Number.isFinite(eventTs)) return 0;

  const diffMinutes = Math.abs(matchTs - eventTs) / 60_000;

  if (diffMinutes <= 30) return 20;
  if (diffMinutes <= 90) return 15;
  if (diffMinutes <= 180) return 10;
  if (diffMinutes <= 360) return 5;

  return 0;
}

function formatStartTime(startTimestamp: number | null) {
  if (startTimestamp === null) return null;

  return new Date(startTimestamp * 1000).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dateKeyFromIso(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function getCandidateDates(matchUtcDate: string | null) {
  const base = matchUtcDate ? new Date(matchUtcDate) : new Date();

  if (Number.isNaN(base.getTime())) {
    return [dateKeyFromIso(new Date().toISOString())];
  }

  const dates = new Set<string>();

  for (const offset of [-1, 0, 1]) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + offset);
    dates.add(dateKeyFromIso(d.toISOString()));
  }

  return Array.from(dates);
}

function buildManualSearchUrls(match: MatchRow) {
  const home = match.home_team ?? "";
  const away = match.away_team ?? "";
  const date = match.utc_date ? dateKeyFromIso(match.utc_date) : "";
  const query = [home, away, date].filter(Boolean).join(" ");

  return {
    query,
    google: `https://www.google.com/search?q=${encodeURIComponent(
      `site:sofascore.com ${query}`
    )}`,
    sofascore: `https://www.sofascore.com/search?q=${encodeURIComponent(query)}`,
  };
}

async function fetchSofaJson(path: string) {
  const url = `https://www.sofascore.com/api/v1${path}`;

  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
      origin: "https://www.sofascore.com",
      referer: "https://www.sofascore.com/",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`SofaScore scheduled-events failed: HTTP ${res.status}`);
  }

  return res.json();
}

function normalizeSofaEvent(
  raw: unknown,
  match: MatchRow,
  sourceQuery: string
): SofaCandidate | null {
  if (typeof raw !== "object" || raw === null) return null;

  const event = raw as Record<string, any>;

  const eventId = asNullableNumber(event.id);
  if (eventId === null) return null;

  const homeTeam = asString(event.homeTeam?.name ?? event.homeTeam?.shortName);
  const awayTeam = asString(event.awayTeam?.name ?? event.awayTeam?.shortName);

  if (!homeTeam || !awayTeam) return null;

  const startTimestamp = asNullableNumber(event.startTimestamp);
  const tournament = asNullableString(event.tournament?.name);
  const category = asNullableString(event.tournament?.category?.name);
  const status =
    asNullableString(event.status?.description) ??
    asNullableString(event.status?.type);

  const baseScore = teamPairScore({
    expectedHome: match.home_team ?? "",
    expectedAway: match.away_team ?? "",
    actualHome: homeTeam,
    actualAway: awayTeam,
  });

  const finalScore = Math.min(
    100,
    baseScore + dateScore(match.utc_date, startTimestamp)
  );

  return {
    eventId,
    homeTeam,
    awayTeam,
    tournament,
    category,
    startTimestamp,
    startTime: formatStartTime(startTimestamp),
    status,
    score: finalScore,
    sourceQuery,
    url: `https://www.sofascore.com/event/${eventId}`,
  };
}

export async function GET(req: Request) {
  const guard = await requireAdmin(req);

  if (!guard.ok) {
    return json(guard.status, {
      ok: false,
      error: guard.error,
      candidates: [],
    });
  }

  try {
    const url = new URL(req.url);
    const matchId = readNumber(url.searchParams.get("matchId"));

    if (!matchId || matchId <= 0) {
      return json(400, {
        ok: false,
        error: "Nieprawidłowy matchId.",
        candidates: [],
      });
    }

    const supabase = supabaseAdmin();

    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select("id, utc_date, competition_name, home_team, away_team")
      .eq("id", matchId)
      .maybeSingle();

    if (matchError) {
      return json(500, {
        ok: false,
        error: matchError.message,
        candidates: [],
      });
    }

    if (!match) {
      return json(404, {
        ok: false,
        error: "Nie znaleziono meczu.",
        candidates: [],
      });
    }

    const matchRow = match as MatchRow;
    const candidateDates = getCandidateDates(matchRow.utc_date);
    const manualSearch = buildManualSearchUrls(matchRow);

    const candidatesByEventId = new Map<number, SofaCandidate>();
    const errors: string[] = [];

    for (const dateKey of candidateDates) {
      try {
        const data = await fetchSofaJson(
          `/sport/football/scheduled-events/${dateKey}`
        );

        const events = Array.isArray(data?.events) ? data.events : [];

        for (const rawEvent of events) {
          const candidate = normalizeSofaEvent(
            rawEvent,
            matchRow,
            `scheduled-events:${dateKey}`
          );

          if (!candidate) continue;

          const existing = candidatesByEventId.get(candidate.eventId);

          if (!existing || candidate.score > existing.score) {
            candidatesByEventId.set(candidate.eventId, candidate);
          }
        }
      } catch (e: unknown) {
        errors.push(e instanceof Error ? e.message : `Błąd dla daty ${dateKey}`);
      }
    }

    const candidates = Array.from(candidatesByEventId.values())
      .filter((candidate) => candidate.score >= 35)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;

        const aTs = a.startTimestamp ?? 0;
        const bTs = b.startTimestamp ?? 0;

        return aTs - bTs;
      })
      .slice(0, 8);

    const blockedBySofaScore =
      candidates.length === 0 &&
      errors.some((error) => error.includes("HTTP 403"));

    return json(200, {
      ok: true,
      matchId,
      match: {
        homeTeam: matchRow.home_team,
        awayTeam: matchRow.away_team,
        utcDate: matchRow.utc_date,
        competitionName: matchRow.competition_name,
      },
      dates: candidateDates,
      candidates,
      manualSearch,
      blockedBySofaScore,
      warning: blockedBySofaScore
        ? "SofaScore blokuje automatyczne wyszukiwanie z serwera HTTP 403. Wpisz event ID ręcznie albo użyj wyszukiwarki."
        : candidates.length === 0 && errors.length > 0
          ? errors.join(" | ")
          : null,
    });
  } catch (e: unknown) {
    return json(500, {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : "Nie udało się wyszukać kandydatów SofaScore.",
      candidates: [],
    });
  }
}