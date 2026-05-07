import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MatchRow = {
  id: number | string;
  utc_date: string | null;
  competition_id: string | null;
  competition_name: string | null;
  home_team: string | null;
  away_team: string | null;
};

type OddsRow = {
  match_id: number | string | null;
  market_id: string | null;
  selection: string | null;
  source: string | null;
  pricing_method: string | null;
  book_odds: number | string | null;
  is_model: boolean | null;
  raw_source: unknown;
  updated_at: string | null;
};

type ModelRunRow = {
  id: number | string;
  match_id: number | string | null;
  status: string | null;
  model_version: string | null;
  confidence: number | string | null;
  created_at: string | null;
};

const DISPLAYABLE_BSD_PRICING_METHOD = "bsd_market_normalized";
const INTERNAL_MODEL_SOURCE = "internal_model";
const INTERNAL_FALLBACK_PRICING_METHOD = "internal_model_fallback";
const KNOWN_BAD_1X2 = { "1": 2.35, X: 4.18, "2": 3.71 };
const MAX_DAYS = 60;
const DEFAULT_DAYS = 21;
const MAX_MATCH_IDS = 5000;
const READ_CHUNK_SIZE = 500;

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { ok: false, error: message, ...(extra ?? {}) },
    { status }
  );
}

function isYmd(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function safeDays(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DAYS;
  return Math.min(Math.trunc(parsed), MAX_DAYS);
}

function todayWarsawYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysYmd(dateYYYYMMDD: string, days: number) {
  const [year, month, day] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function isoStartOfUtcDay(dateYYYYMMDD: string) {
  return `${dateYYYYMMDD}T00:00:00.000Z`;
}

function chunks<T>(values: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

function cronSecretMatches(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const provided =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  return provided === expected;
}

async function authorize(req: Request) {
  if (cronSecretMatches(req)) return null;

  const admin = await requireAdmin(req);
  if (admin.ok) return null;

  return NextResponse.json(
    { ok: false, error: admin.error },
    { status: admin.status }
  );
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function pct(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return round((numerator / denominator) * 100, 1);
}

function countBy<T extends string>(values: T[]) {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

function readModelVersion(rawSource: unknown) {
  if (typeof rawSource !== "object" || rawSource === null || Array.isArray(rawSource)) {
    return "unknown";
  }

  const record = rawSource as Record<string, unknown>;
  const raw = record.modelVersion ?? record.model_version;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "unknown";
}

function readInputMode(rawSource: unknown) {
  if (typeof rawSource !== "object" || rawSource === null || Array.isArray(rawSource)) {
    return "unknown";
  }

  const record = rawSource as Record<string, unknown>;
  const raw = record.inputMode ?? record.input_mode;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "unknown";
}

function matchLabel(match?: MatchRow) {
  if (!match) return null;
  return {
    id: Number(match.id),
    utcDate: match.utc_date,
    league: match.competition_name ?? match.competition_id ?? "Liga",
    homeTeam: match.home_team,
    awayTeam: match.away_team,
  };
}

function rowKey(row: OddsRow) {
  return `${row.source ?? "unknown"}::${row.pricing_method ?? "unknown"}`;
}

function detectKnownBadFallbackMatches(rows: OddsRow[]) {
  const grouped = new Map<number, Record<string, number>>();

  for (const row of rows) {
    if (row.source !== INTERNAL_MODEL_SOURCE) continue;
    if (row.pricing_method !== INTERNAL_FALLBACK_PRICING_METHOD) continue;
    if (row.market_id !== "1x2") continue;

    const matchId = toNumber(row.match_id);
    const odds = toNumber(row.book_odds);
    const selection = row.selection;
    if (!matchId || odds === null || !selection) continue;

    const current = grouped.get(matchId) ?? {};
    current[selection] = odds;
    grouped.set(matchId, current);
  }

  const bad: number[] = [];
  for (const [matchId, selections] of grouped.entries()) {
    const allKnown = Object.entries(KNOWN_BAD_1X2).every(([selection, expected]) => {
      const actual = selections[selection];
      return typeof actual === "number" && Math.abs(actual - expected) < 0.001;
    });
    if (allKnown) bad.push(matchId);
  }

  return bad;
}

async function readOddsRows(matchIds: number[]) {
  const sb = supabaseAdmin();
  const rows: OddsRow[] = [];

  for (const chunk of chunks(matchIds, READ_CHUNK_SIZE)) {
    const { data, error } = await sb
      .from("odds")
      .select(
        "match_id, market_id, selection, source, pricing_method, book_odds, is_model, raw_source, updated_at"
      )
      .in("match_id", chunk);

    if (error) {
      throw new Error(`odds audit read failed: ${error.message}`);
    }

    rows.push(...((data ?? []) as OddsRow[]));
  }

  return rows;
}

async function readModelRuns(matchIds: number[]) {
  const sb = supabaseAdmin();
  const rows: ModelRunRow[] = [];

  for (const chunk of chunks(matchIds, READ_CHUNK_SIZE)) {
    const { data, error } = await sb
      .from("internal_odds_model_runs")
      .select("id, match_id, status, model_version, confidence, created_at")
      .in("match_id", chunk)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`model runs audit read failed: ${error.message}`);
    }

    rows.push(...((data ?? []) as ModelRunRow[]));
  }

  return rows;
}

export async function GET(req: Request) {
  const unauthorized = await authorize(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const rawFrom = url.searchParams.get("from");
  const from = isYmd(rawFrom) ? rawFrom : todayWarsawYmd();
  const days = safeDays(url.searchParams.get("days"));
  const to = addDaysYmd(from, days);

  const sb = supabaseAdmin();
  const { data: matchesData, error: matchesError } = await sb
    .from("matches")
    .select(
      "id, utc_date, competition_id, competition_name, home_team, away_team"
    )
    .eq("source", "bsd")
    .gte("utc_date", isoStartOfUtcDay(from))
    .lt("utc_date", isoStartOfUtcDay(to))
    .order("utc_date", { ascending: true })
    .limit(MAX_MATCH_IDS);

  if (matchesError) {
    return jsonError(`matches audit read failed: ${matchesError.message}`, 500);
  }

  const matches = (matchesData ?? []) as MatchRow[];
  const matchIds = matches
    .map((match) => toNumber(match.id))
    .filter((id): id is number => id !== null);
  const matchById = new Map(matches.map((match) => [Number(match.id), match]));

  try {
    const [oddsRows, modelRuns] = await Promise.all([
      readOddsRows(matchIds),
      readModelRuns(matchIds),
    ]);

    const realBsdOneXTwoMatchIds = new Set(
      oddsRows
        .filter(
          (row) =>
            row.source === "bsd" &&
            row.pricing_method === DISPLAYABLE_BSD_PRICING_METHOD &&
            row.market_id === "1x2"
        )
        .map((row) => toNumber(row.match_id))
        .filter((id): id is number => id !== null)
    );
    const internalFallbackMatchIds = new Set(
      oddsRows
        .filter(
          (row) =>
            row.source === INTERNAL_MODEL_SOURCE &&
            row.pricing_method === INTERNAL_FALLBACK_PRICING_METHOD
        )
        .map((row) => toNumber(row.match_id))
        .filter((id): id is number => id !== null)
    );
    const knownBadFallbackMatchIds = detectKnownBadFallbackMatches(oddsRows);

    const sourcePricingCounts = Object.entries(countBy(oddsRows.map(rowKey))).map(
      ([key, rows]) => {
        const [source, pricingMethod] = key.split("::");
        return { source, pricingMethod, rows };
      }
    );

    const internalFallbackRows = oddsRows.filter(
      (row) =>
        row.source === INTERNAL_MODEL_SOURCE &&
        row.pricing_method === INTERNAL_FALLBACK_PRICING_METHOD
    );
    const internalModelVersions = countBy(
      internalFallbackRows.map((row) => readModelVersion(row.raw_source))
    );
    const internalInputModes = countBy(
      internalFallbackRows.map((row) => readInputMode(row.raw_source))
    );

    const pricedRuns = modelRuns.filter((run) => run.status === "priced");
    const pricedRunsByMatch = new Map<number, ModelRunRow[]>();
    for (const run of pricedRuns) {
      const matchId = toNumber(run.match_id);
      if (!matchId) continue;
      const current = pricedRunsByMatch.get(matchId) ?? [];
      current.push(run);
      pricedRunsByMatch.set(matchId, current);
    }

    const duplicatePricedRuns = [...pricedRunsByMatch.entries()]
      .filter(([, runs]) => runs.length > 1)
      .slice(0, 10)
      .map(([matchId, runs]) => ({
        match: matchLabel(matchById.get(matchId)),
        pricedRuns: runs.length,
        runIds: runs.map((run) => Number(run.id)),
      }));

    const orphanPricedRuns = pricedRuns
      .filter((run) => {
        const matchId = toNumber(run.match_id);
        return matchId !== null && !internalFallbackMatchIds.has(matchId);
      })
      .slice(0, 10)
      .map((run) => ({
        id: Number(run.id),
        status: run.status,
        modelVersion: run.model_version,
        confidence: toNumber(run.confidence),
        createdAt: run.created_at,
        match: matchLabel(matchById.get(Number(run.match_id))),
      }));

    const modelRunStatusCounts = Object.entries(
      countBy(
        modelRuns.map(
          (run) => `${run.status ?? "unknown"}::${run.model_version ?? "unknown"}`
        )
      )
    ).map(([key, rows]) => {
      const [status, modelVersion] = key.split("::");
      return { status, modelVersion, rows };
    });

    const warnings = [
      knownBadFallbackMatchIds.length
        ? "known_bad_internal_fallback_1x2_active"
        : null,
      duplicatePricedRuns.length ? "duplicate_priced_model_runs" : null,
      orphanPricedRuns.length ? "priced_model_runs_without_active_odds" : null,
    ].filter(Boolean);

    return NextResponse.json({
      ok: true,
      endpoint: "/api/admin/odds/audit",
      from,
      to,
      days,
      generatedAt: new Date().toISOString(),
      counts: {
        matches: matches.length,
        oddsRows: oddsRows.length,
        realBsdOneXTwoMatches: realBsdOneXTwoMatchIds.size,
        internalFallbackRows: internalFallbackRows.length,
        internalFallbackMatches: internalFallbackMatchIds.size,
        modelRuns: modelRuns.length,
        pricedModelRuns: pricedRuns.length,
      },
      rates: {
        realBsdOneXTwoCoverage: pct(realBsdOneXTwoMatchIds.size, matches.length),
        internalFallbackCoverage: pct(internalFallbackMatchIds.size, matches.length),
      },
      sourcePricingCounts,
      internalFallback: {
        modelVersions: internalModelVersions,
        inputModes: internalInputModes,
        knownBadFallbackMatches: knownBadFallbackMatchIds.map((matchId) =>
          matchLabel(matchById.get(matchId))
        ),
        activeSamples: internalFallbackRows.slice(0, 20).map((row) => ({
          match: matchLabel(matchById.get(Number(row.match_id))),
          market: row.market_id,
          selection: row.selection,
          odds: toNumber(row.book_odds),
          modelVersion: readModelVersion(row.raw_source),
          inputMode: readInputMode(row.raw_source),
          updatedAt: row.updated_at,
        })),
      },
      modelRuns: {
        statusCounts: modelRunStatusCounts,
        duplicatePricedRuns,
        orphanPricedRuns,
      },
      warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(message, 500);
  }
}
