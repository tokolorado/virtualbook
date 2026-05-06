import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PurgeBody = {
  from?: string;
  to?: string;
  source?: "internal_model" | "bsd" | "all";
  pricingMethod?: string;
  dryRun?: boolean | string | number;
  confirm?: string;
  confirmRealBsd?: string;
};

type MatchIdRow = {
  id: number | string;
};

type OddsPreviewRow = {
  match_id: number | string | null;
  market_id: string | null;
  selection: string | null;
  source: string | null;
  pricing_method: string | null;
  book_odds: number | string | null;
  updated_at: string | null;
};

const DEFAULT_SOURCE = "internal_model";
const DEFAULT_PRICING_METHOD = "internal_model_fallback";
const DELETE_CONFIRMATION = "DELETE_FUTURE_ODDS";
const REAL_BSD_CONFIRMATION = "YES_DELETE_REAL_BSD_ODDS";
const MAX_MATCH_IDS = 5000;
const DELETE_CHUNK_SIZE = 500;

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

function isYmd(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

async function readBody(req: Request): Promise<PurgeBody> {
  try {
    const text = await req.text();
    if (!text.trim()) return {};

    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? (parsed as PurgeBody) : {};
  } catch {
    return {};
  }
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

function addDaysYmd(dateYYYYMMDD: string, days: number) {
  const [year, month, day] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function todayWarsawYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isoStartOfUtcDay(dateYYYYMMDD: string) {
  return `${dateYYYYMMDD}T00:00:00.000Z`;
}

function scopeFromInput(value: unknown) {
  const raw = readString(value);
  if (raw === "internal_model" || raw === "bsd" || raw === "all") return raw;
  return DEFAULT_SOURCE;
}

function chunks<T>(values: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

export async function POST(req: Request) {
  const unauthorized = await authorize(req);
  if (unauthorized) return unauthorized;

  const body = await readBody(req);
  const { searchParams } = new URL(req.url);

  const from =
    readString(body.from) ??
    searchParams.get("from") ??
    todayWarsawYmd();
  const to =
    readString(body.to) ??
    searchParams.get("to") ??
    addDaysYmd(from, 21);

  if (!isYmd(from) || !isYmd(to)) {
    return jsonError("Invalid from/to. Use YYYY-MM-DD.", 400, { from, to });
  }

  const source = scopeFromInput(body.source ?? searchParams.get("source"));
  const pricingMethod =
    readString(body.pricingMethod) ??
    searchParams.get("pricingMethod") ??
    DEFAULT_PRICING_METHOD;
  const dryRun = readBool(body.dryRun ?? searchParams.get("dryRun"), true);
  const confirm =
    readString(body.confirm) ?? searchParams.get("confirm") ?? "";
  const confirmRealBsd =
    readString(body.confirmRealBsd) ??
    searchParams.get("confirmRealBsd") ??
    "";

  if (!dryRun && confirm !== DELETE_CONFIRMATION) {
    return jsonError("Missing delete confirmation.", 400, {
      requiredConfirm: DELETE_CONFIRMATION,
      dryRun,
    });
  }

  if (!dryRun && source !== "internal_model" && confirmRealBsd !== REAL_BSD_CONFIRMATION) {
    return jsonError("Deleting real BSD odds needs a second confirmation.", 400, {
      requiredConfirmRealBsd: REAL_BSD_CONFIRMATION,
      source,
    });
  }

  const supabase = supabaseAdmin();

  const { data: matchesData, error: matchesError } = await supabase
    .from("matches")
    .select("id")
    .eq("source", "bsd")
    .gte("utc_date", isoStartOfUtcDay(from))
    .lt("utc_date", isoStartOfUtcDay(to))
    .order("utc_date", { ascending: true })
    .limit(MAX_MATCH_IDS);

  if (matchesError) {
    return jsonError(`matches read failed: ${matchesError.message}`, 500);
  }

  const matchIds = ((matchesData ?? []) as MatchIdRow[])
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id));

  if (!matchIds.length) {
    return NextResponse.json({
      ok: true,
      endpoint: "/api/admin/odds/purge-future",
      dryRun,
      from,
      to,
      source,
      pricingMethod,
      matchedFutureMatches: 0,
      previewRows: [],
      previewLimitedTo: 25,
      candidateOddsRowsKnownFromPreview: 0,
      deletedRows: 0,
      requiredConfirm: DELETE_CONFIRMATION,
      requiredConfirmRealBsd:
        source === "internal_model" ? undefined : REAL_BSD_CONFIRMATION,
    });
  }

  let previewQuery = supabase
    .from("odds")
    .select(
      "match_id, market_id, selection, source, pricing_method, book_odds, updated_at",
      { count: "exact" }
    )
    .in("match_id", matchIds)
    .limit(25);

  if (source !== "all") {
    previewQuery = previewQuery.eq("source", source);
  }

  if (pricingMethod !== "all") {
    previewQuery = previewQuery.eq("pricing_method", pricingMethod);
  }

  const { data: previewData, error: previewError, count } = await previewQuery;

  if (previewError) {
    return jsonError(`odds preview read failed: ${previewError.message}`, 500);
  }

  let deletedRows = 0;

  if (!dryRun && matchIds.length) {
    for (const chunk of chunks(matchIds, DELETE_CHUNK_SIZE)) {
      let deleteQuery = supabase
        .from("odds")
        .delete({ count: "exact" })
        .in("match_id", chunk);

      if (source !== "all") {
        deleteQuery = deleteQuery.eq("source", source);
      }

      if (pricingMethod !== "all") {
        deleteQuery = deleteQuery.eq("pricing_method", pricingMethod);
      }

      const { error: deleteError, count: chunkCount } = await deleteQuery;

      if (deleteError) {
        return jsonError(`odds delete failed: ${deleteError.message}`, 500, {
          deletedRows,
        });
      }

      deletedRows += chunkCount ?? 0;
    }
  }

  return NextResponse.json({
    ok: true,
    endpoint: "/api/admin/odds/purge-future",
    dryRun,
    from,
    to,
    source,
    pricingMethod,
    matchedFutureMatches: matchIds.length,
    previewRows: (previewData ?? []) as OddsPreviewRow[],
    previewLimitedTo: 25,
    candidateOddsRowsKnownFromPreview:
      typeof count === "number" ? count : undefined,
    deletedRows,
    requiredConfirm: DELETE_CONFIRMATION,
    requiredConfirmRealBsd:
      source === "internal_model" ? undefined : REAL_BSD_CONFIRMATION,
  });
}

export async function GET() {
  return jsonError("Use POST.", 405, {
    endpoint: "/api/admin/odds/purge-future",
  });
}
