// app/api/admin/match-mapping/search-sofascore/route.ts
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

type RawMatchDetails = {
  utc_date?: unknown;
  competition_name?: unknown;
  home_team?: unknown;
  away_team?: unknown;
};

type RawQueueRow = {
  match_id: unknown;
  match?: RawMatchDetails | RawMatchDetails[] | null;
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

function safeNumber(value: unknown): number | null {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeMatchDetails(input: unknown): MatchDetails | null {
  const row = asRecord(input);
  if (!row) return null;

  return {
    utc_date: safeNullableString(row.utc_date),
    competition_name: safeNullableString(row.competition_name),
    home_team: safeString(row.home_team, "Home"),
    away_team: safeString(row.away_team, "Away"),
  };
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ąćęłńóśźż\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactTeamName(value: string) {
  const stopWords = new Set([
    "fc",
    "cf",
    "cd",
    "ud",
    "rcd",
    "rc",
    "ac",
    "as",
    "ss",
    "sc",
    "club",
    "de",
    "la",
    "el",
    "the",
    "calcio",
    "football",
  ]);

  return normalizeText(value)
    .split(" ")
    .filter((part) => part.length > 1 && !stopWords.has(part))
    .join(" ")
    .trim();
}

function tokenScore(expected: string, actual: string) {
  const expectedTokens = compactTeamName(expected).split(" ").filter(Boolean);
  const actualTokens = compactTeamName(actual).split(" ").filter(Boolean);

  if (expectedTokens.length === 0 || actualTokens.length === 0) return 0;

  const matched = expectedTokens.filter((token) =>
    actualTokens.some(
      (actualToken) =>
        actualToken === token ||
        actualToken.includes(token) ||
        token.includes(actualToken)
    )
  ).length;

  return matched / expectedTokens.length;
}

function dateScore(matchDate: string | null, candidateStartTimestamp: number | null) {
  if (!matchDate || !candidateStartTimestamp) return 0;

  const matchMs = Date.parse(matchDate);
  const candidateMs = candidateStartTimestamp * 1000;

  if (!Number.isFinite(matchMs) || !Number.isFinite(candidateMs)) return 0;

  const diffHours = Math.abs(matchMs - candidateMs) / (1000 * 60 * 60);

  if (diffHours <= 3) return 1;
  if (diffHours <= 8) return 0.9;
  if (diffHours <= 24) return 0.7;
  if (diffHours <= 72) return 0.45;

  return 0.1;
}

function candidateScore(match: MatchDetails, candidate: Omit<SofaCandidate, "score">) {
  const normal =
    (tokenScore(match.home_team, candidate.homeTeam) +
      tokenScore(match.away_team, candidate.awayTeam)) /
    2;

  const swapped =
    (tokenScore(match.home_team, candidate.awayTeam) +
      tokenScore(match.away_team, candidate.homeTeam)) /
    2;

  const teamScore = Math.max(normal, swapped * 0.92);
  const timeScore = dateScore(match.utc_date, candidate.startTimestamp);

  return Math.round((teamScore * 0.78 + timeScore * 0.22) * 100);
}

function formatStartTime(startTimestamp: number | null) {
  if (!startTimestamp) return null;

  return new Date(startTimestamp * 1000).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readTeamName(value: unknown) {
  const row = asRecord(value);
  if (!row) return "";

  return (
    safeString(row.name) ||
    safeString(row.shortName) ||
    safeString(row.slug) ||
    ""
  );
}

function normalizeSofaEvent(
  input: unknown,
  match: MatchDetails,
  sourceQuery: string
): SofaCandidate | null {
  const raw = asRecord(input);
  if (!raw) return null;

  const type = safeNullableString(raw.type);
  if (type && type !== "event") return null;

  const entity = asRecord(raw.entity) ?? raw;
  const eventId = safeNumber(entity.id);

  if (!eventId || eventId <= 0) return null;

  const homeTeam = readTeamName(entity.homeTeam);
  const awayTeam = readTeamName(entity.awayTeam);

  if (!homeTeam || !awayTeam) return null;

  const tournament = asRecord(entity.tournament);
  const category = asRecord(tournament?.category);
  const status = asRecord(entity.status);

  const startTimestamp = safeNumber(entity.startTimestamp);

  const baseCandidate: Omit<SofaCandidate, "score"> = {
    eventId,
    homeTeam,
    awayTeam,
    tournament: safeNullableString(tournament?.name),
    category: safeNullableString(category?.name),
    startTimestamp,
    startTime: formatStartTime(startTimestamp),
    status:
      safeNullableString(status?.description) ??
      safeNullableString(status?.type),
    sourceQuery,
    url: `https://www.sofascore.com/event/${eventId}`,
  };

  return {
    ...baseCandidate,
    score: candidateScore(match, baseCandidate),
  };
}

function extractResults(data: unknown): unknown[] {
  const row = asRecord(data);
  if (!row) return [];

  if (Array.isArray(row.results)) return row.results;
  if (Array.isArray(row.events)) return row.events;

  const nested = asRecord(row.data);
  if (Array.isArray(nested?.results)) return nested.results;
  if (Array.isArray(nested?.events)) return nested.events;

  return [];
}

function buildQueries(match: MatchDetails) {
  const full = `${match.home_team} ${match.away_team}`.trim();
  const compact = `${compactTeamName(match.home_team)} ${compactTeamName(
    match.away_team
  )}`.trim();

  const queries = [
    full,
    compact,
    `${match.home_team} vs ${match.away_team}`,
    match.home_team,
    match.away_team,
  ]
    .map((q) => q.trim())
    .filter(Boolean);

  return Array.from(new Set(queries)).slice(0, 5);
}

async function fetchSofaSearch(query: string) {
  const url = new URL("https://www.sofascore.com/api/v1/search/events/");
  url.searchParams.set("q", query);
  url.searchParams.set("page", "0");

  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (compatible; VirtualBookAdmin/1.0; +https://virtualbook-sable.vercel.app)",
      referer: "https://www.sofascore.com/",
    },
  });

  if (!res.ok) {
    throw new Error(`SofaScore search failed: HTTP ${res.status}`);
  }

  return res.json();
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
    const matchId = safeNumber(url.searchParams.get("matchId"));

    if (!matchId || matchId <= 0) {
      return json(400, {
        ok: false,
        error: "Nieprawidłowy matchId.",
        candidates: [],
      });
    }

    const supabase = supabaseAdmin();

    const { data: queueRow, error: queueError } = await supabase
      .from("match_mapping_queue")
      .select(
        `
        match_id,
        match:matches!inner (
          utc_date,
          competition_name,
          home_team,
          away_team
        )
      `
      )
      .eq("match_id", matchId)
      .maybeSingle();

    if (queueError) {
      return json(500, {
        ok: false,
        error: queueError.message,
        candidates: [],
      });
    }

    const rawQueue = queueRow as unknown as RawQueueRow | null;
    const rawMatch = Array.isArray(rawQueue?.match)
      ? rawQueue?.match[0] ?? null
      : rawQueue?.match ?? null;

    const match = normalizeMatchDetails(rawMatch);

    if (!match) {
      return json(404, {
        ok: false,
        error: "Nie znaleziono meczu dla tego matchId.",
        candidates: [],
      });
    }

    const queries = buildQueries(match);
    const candidatesById = new Map<number, SofaCandidate>();
    const errors: string[] = [];

    for (const query of queries) {
      try {
        const data = await fetchSofaSearch(query);
        const results = extractResults(data);

        for (const result of results) {
          const candidate = normalizeSofaEvent(result, match, query);

          if (!candidate) continue;

          const current = candidatesById.get(candidate.eventId);

          if (!current || candidate.score > current.score) {
            candidatesById.set(candidate.eventId, candidate);
          }
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : "SofaScore search error");
      }
    }

    const candidates = Array.from(candidatesById.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    if (candidates.length === 0 && errors.length === queries.length) {
      return json(502, {
        ok: false,
        error: errors[0] ?? "Nie udało się pobrać kandydatów SofaScore.",
        candidates: [],
      });
    }

    return json(200, {
      ok: true,
      matchId,
      match,
      queries,
      candidates,
    });
  } catch (e) {
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