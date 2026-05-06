// app/api/odds/sync/route.ts

import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/requireCronSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SyncBody = {
  date?: string;
  dateFrom?: string;
  from?: string;
  days?: number | string;
  horizonDays?: number | string;
  dryRun?: boolean | string | number;
  tz?: string;
  timezone?: string;
  stopOnError?: boolean | string | number;
};

type BsdSyncPayload = {
  ok?: boolean;
  date?: string;
  dryRun?: boolean;

  fetchedEventsCount?: number;
  eligibleEventsCount?: number;
  uniqueMatchRowsCount?: number;
  uniqueOddsRowsCount?: number;
  upsertedMatchesCount?: number;
  upsertedOddsCount?: number;
  skippedCount?: number;
  builtPricingFeatureRowsCount?: number;
  upsertedPricingFeaturesCount?: number;
  builtBsdEventFeatureRowsCount?: number;
  upsertedBsdEventFeaturesCount?: number;
  modelVersion?: string;

  builtMatchResultRowsCount?: number;
  syncedMatchResultsCount?: number;
  insertedMatchResultsCount?: number;
  updatedMatchResultsCount?: number;
  unchangedMatchResultsCount?: number;
  bsdOddsApi?: {
    attempted?: number;
    succeeded?: number;
    failed?: number;
    sourceRows?: number;
    inputs?: number;
  };
  bsdOddsApiWarnings?: Array<{
    eventId?: string;
    message?: string;
    status?: number | null;
  }>;

  error?: string;
  details?: unknown;
};

const DEFAULT_DAYS = 14;
const MAX_DAYS = 21;
const DEFAULT_TIMEZONE = "Europe/Warsaw";

function jsonError(
  message: string,
  status = 400,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    { ok: false, error: message, ...(extra ?? {}) },
    { status }
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(req: Request): Promise<SyncBody> {
  try {
    const text = await req.text();
    if (!text.trim()) return {};

    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? (parsed as SyncBody) : {};
  } catch {
    return {};
  }
}

function readString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function readPositiveInt(value: unknown, fallback: number): number {
  const raw = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(raw)) return fallback;

  const parsed = Math.trunc(raw);
  return parsed > 0 ? parsed : fallback;
}

function readBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;

  if (typeof value === "number") return value === 1;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }

  return fallback;
}

function isYmd(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysYmd(dateYYYYMMDD: string, days: number): string {
  const [year, month, day] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));

  dt.setUTCDate(dt.getUTCDate() + days);

  return dt.toISOString().slice(0, 10);
}

function enumerateDates(dateFrom: string, days: number): string[] {
  return Array.from({ length: days }, (_, index) => addDaysYmd(dateFrom, index));
}

function getBaseUrl(req: Request): string {
  const envBase = process.env.CRON_BASE_URL?.trim();

  if (envBase) {
    return envBase.replace(/\/+$/, "");
  }

  const url = new URL(req.url);
  return url.origin;
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function runBsdDaySync(args: {
  baseUrl: string;
  cronSecret: string;
  date: string;
  dryRun: boolean;
  timezone: string;
}): Promise<{
  date: string;
  ok: boolean;
  status: number;
  payload: BsdSyncPayload;
}> {
  const url = new URL("/api/admin/bsd/matches/sync", args.baseUrl);

  url.searchParams.set("date", args.date);
  url.searchParams.set("tz", args.timezone);

  if (args.dryRun) {
    url.searchParams.set("dryRun", "1");
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    headers: {
      "x-cron-secret": args.cronSecret,
      accept: "application/json",
    },
  });

  const text = await response.text();

  let payload: BsdSyncPayload = {};
  try {
    const parsed: unknown = JSON.parse(text);
    payload = isRecord(parsed) ? (parsed as BsdSyncPayload) : {};
  } catch {
    payload = {
      ok: false,
      error: text.slice(0, 500) || "Non-JSON response",
    };
  }

  return {
    date: args.date,
    ok: response.ok && payload.ok !== false,
    status: response.status,
    payload,
  };
}

export async function POST(req: Request) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return jsonError("Missing CRON_SECRET in env", 500);
  }

  const body = await readBody(req);
  const { searchParams } = new URL(req.url);

  const requestedDate =
    readString(body.dateFrom) ??
    readString(body.from) ??
    readString(body.date) ??
    searchParams.get("dateFrom") ??
    searchParams.get("from") ??
    searchParams.get("date") ??
    todayYmd();

  if (!isYmd(requestedDate)) {
    return jsonError("Invalid date/dateFrom. Use YYYY-MM-DD.", 400, {
      received: requestedDate,
    });
  }

  const rawDays =
    body.horizonDays ??
    body.days ??
    searchParams.get("horizonDays") ??
    searchParams.get("days");

  const days = Math.min(readPositiveInt(rawDays, DEFAULT_DAYS), MAX_DAYS);

  const dryRun = readBool(body.dryRun ?? searchParams.get("dryRun"), false);

  const stopOnError = readBool(
    body.stopOnError ?? searchParams.get("stopOnError"),
    false
  );

  const timezone =
    readString(body.timezone) ??
    readString(body.tz) ??
    searchParams.get("timezone") ??
    searchParams.get("tz") ??
    DEFAULT_TIMEZONE;

  const baseUrl = getBaseUrl(req);
  const dates = enumerateDates(requestedDate, days);

  const results: Array<{
    date: string;
    ok: boolean;
    status: number;

    fetchedEventsCount: number;
    eligibleEventsCount: number;
    uniqueMatchRowsCount: number;
    uniqueOddsRowsCount: number;
    upsertedMatchesCount: number;
    upsertedOddsCount: number;
    skippedCount: number;
    builtPricingFeatureRowsCount: number;
    upsertedPricingFeaturesCount: number;
    builtBsdEventFeatureRowsCount: number;
    upsertedBsdEventFeaturesCount: number;
    modelVersion: string | null;

    builtMatchResultRowsCount: number;
    syncedMatchResultsCount: number;
    insertedMatchResultsCount: number;
    updatedMatchResultsCount: number;
    unchangedMatchResultsCount: number;
    bsdOddsApi: {
      attempted: number;
      succeeded: number;
      failed: number;
      sourceRows: number;
      inputs: number;
    };

    error: string | null;
  }> = [];

  const errors: Array<{
    date: string;
    status: number;
    error: string;
    details?: unknown;
  }> = [];

  for (const date of dates) {
    const result = await runBsdDaySync({
      baseUrl,
      cronSecret,
      date,
      dryRun,
      timezone,
    });

    const payload = result.payload;

    results.push({
      date,
      ok: result.ok,
      status: result.status,

      fetchedEventsCount: toNumber(payload.fetchedEventsCount),
      eligibleEventsCount: toNumber(payload.eligibleEventsCount),
      uniqueMatchRowsCount: toNumber(payload.uniqueMatchRowsCount),
      uniqueOddsRowsCount: toNumber(payload.uniqueOddsRowsCount),
      upsertedMatchesCount: toNumber(payload.upsertedMatchesCount),
      upsertedOddsCount: toNumber(payload.upsertedOddsCount),
      skippedCount: toNumber(payload.skippedCount),
      builtPricingFeatureRowsCount: toNumber(payload.builtPricingFeatureRowsCount),
      upsertedPricingFeaturesCount: toNumber(payload.upsertedPricingFeaturesCount),
      builtBsdEventFeatureRowsCount: toNumber(payload.builtBsdEventFeatureRowsCount),
      upsertedBsdEventFeaturesCount: toNumber(payload.upsertedBsdEventFeaturesCount),
      modelVersion:
        typeof payload.modelVersion === "string" ? payload.modelVersion : null,

      builtMatchResultRowsCount: toNumber(payload.builtMatchResultRowsCount),
      syncedMatchResultsCount: toNumber(payload.syncedMatchResultsCount),
      insertedMatchResultsCount: toNumber(payload.insertedMatchResultsCount),
      updatedMatchResultsCount: toNumber(payload.updatedMatchResultsCount),
      unchangedMatchResultsCount: toNumber(payload.unchangedMatchResultsCount),
      bsdOddsApi: {
        attempted: toNumber(payload.bsdOddsApi?.attempted),
        succeeded: toNumber(payload.bsdOddsApi?.succeeded),
        failed: toNumber(payload.bsdOddsApi?.failed),
        sourceRows: toNumber(payload.bsdOddsApi?.sourceRows),
        inputs: toNumber(payload.bsdOddsApi?.inputs),
      },

      error: payload.error ?? null,
    });

    if (!result.ok) {
      errors.push({
        date,
        status: result.status,
        error: payload.error ?? `BSD day sync failed with HTTP ${result.status}`,
        details: payload.details,
      });

      if (stopOnError) break;
    }
  }

  const totals = results.reduce(
    (acc, row) => {
      acc.fetchedEventsCount += row.fetchedEventsCount;
      acc.eligibleEventsCount += row.eligibleEventsCount;
      acc.uniqueMatchRowsCount += row.uniqueMatchRowsCount;
      acc.uniqueOddsRowsCount += row.uniqueOddsRowsCount;
      acc.upsertedMatchesCount += row.upsertedMatchesCount;
      acc.upsertedOddsCount += row.upsertedOddsCount;
      acc.skippedCount += row.skippedCount;
      acc.builtPricingFeatureRowsCount += row.builtPricingFeatureRowsCount;
      acc.upsertedPricingFeaturesCount += row.upsertedPricingFeaturesCount;
      acc.builtBsdEventFeatureRowsCount += row.builtBsdEventFeatureRowsCount;
      acc.upsertedBsdEventFeaturesCount += row.upsertedBsdEventFeaturesCount;

      acc.builtMatchResultRowsCount += row.builtMatchResultRowsCount;
      acc.syncedMatchResultsCount += row.syncedMatchResultsCount;
      acc.insertedMatchResultsCount += row.insertedMatchResultsCount;
      acc.updatedMatchResultsCount += row.updatedMatchResultsCount;
      acc.unchangedMatchResultsCount += row.unchangedMatchResultsCount;
      acc.bsdOddsApi.attempted += row.bsdOddsApi.attempted;
      acc.bsdOddsApi.succeeded += row.bsdOddsApi.succeeded;
      acc.bsdOddsApi.failed += row.bsdOddsApi.failed;
      acc.bsdOddsApi.sourceRows += row.bsdOddsApi.sourceRows;
      acc.bsdOddsApi.inputs += row.bsdOddsApi.inputs;

      return acc;
    },
    {
      fetchedEventsCount: 0,
      eligibleEventsCount: 0,
      uniqueMatchRowsCount: 0,
      uniqueOddsRowsCount: 0,
      upsertedMatchesCount: 0,
      upsertedOddsCount: 0,
      skippedCount: 0,
      builtPricingFeatureRowsCount: 0,
      upsertedPricingFeaturesCount: 0,
      builtBsdEventFeatureRowsCount: 0,
      upsertedBsdEventFeaturesCount: 0,

      builtMatchResultRowsCount: 0,
      syncedMatchResultsCount: 0,
      insertedMatchResultsCount: 0,
      updatedMatchResultsCount: 0,
      unchangedMatchResultsCount: 0,
      bsdOddsApi: {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        sourceRows: 0,
        inputs: 0,
      },
    }
  );

  return NextResponse.json(
    {
      ok: errors.length === 0,
      provider: "bsd",
      endpoint: "/api/odds/sync",
      delegatedEndpoint: "/api/admin/bsd/matches/sync",
      dryRun,
      dateFrom: requestedDate,
      days,
      timezone,
      dates,
      totals,
      results,
      errors,
      message:
        errors.length === 0
          ? "BSD odds horizon sync completed."
          : "BSD odds horizon sync completed with errors.",
    },
    { status: errors.length === 0 ? 200 : 207 }
  );
}

export async function GET() {
  return jsonError("Use POST.", 405, {
    provider: "bsd",
    endpoint: "/api/odds/sync",
  });
}
