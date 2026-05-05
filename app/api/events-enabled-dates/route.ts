// app/api/events-enabled-dates/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { addDaysLocal, todayLocalYYYYMMDD } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEAGUES = ["CL", "PL", "BL1", "FL1", "SA", "PD", "WC"];
const ENABLED_DATES_TTL_MS = 5 * 60 * 1000;

function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

function isoStartOfUtcDay(dateYYYYMMDD: string) {
  return new Date(`${dateYYYYMMDD}T00:00:00.000Z`).toISOString();
}

function isoStartOfNextUtcDay(dateYYYYMMDD: string) {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10) + "T00:00:00.000Z";
}

function localDateKeyFromISO(iso: string) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type DbMatchRow = {
  id: number;
  utc_date: string;
  competition_id: string;
};

export async function GET(req: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) return jsonError("Missing SUPABASE_URL in env", 500);
  if (!serviceKey) return jsonError("Missing SUPABASE_SERVICE_ROLE_KEY in env", 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || todayLocalYYYYMMDD();
  const daysParam = Number(searchParams.get("days") || 14);
  const days = Number.isFinite(daysParam)
    ? Math.min(Math.max(daysParam, 1), 31)
    : 14;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return jsonError("Invalid from. Use YYYY-MM-DD", 400);
  }

  const to = addDaysLocal(from, days - 1);
  const cacheKey = `events_enabled_dates:${from}:${days}`;

  // cache read
  const { data: cacheRow } = await supabase
    .from("api_cache")
    .select("payload, updated_at")
    .eq("key", cacheKey)
    .maybeSingle();

  if (cacheRow?.updated_at) {
    const age = Date.now() - new Date(cacheRow.updated_at).getTime();

    if (age < ENABLED_DATES_TTL_MS && cacheRow.payload) {
      return NextResponse.json({
        ...(cacheRow.payload as object),
        cached: true,
      });
    }
  }

const rangeStart = isoStartOfUtcDay(from);
const rangeEnd = isoStartOfNextUtcDay(to);

const { data, error } = await supabase
  .from("matches")
  .select("id, utc_date, competition_id")
  .eq("source", "bsd")
  .in("competition_id", LEAGUES)
  .gte("utc_date", rangeStart)
  .lt("utc_date", rangeEnd)
  .order("utc_date", { ascending: true });

if (error) {
  const origin = new URL(req.url).origin;
  const enabledSet = new Set<string>();

  for (let i = 0; i < days; i += 1) {
    const d = addDaysLocal(from, i);
    const r = await fetch(`${origin}/api/events?date=${encodeURIComponent(d)}`, {
      cache: "no-store",
    });

    if (!r.ok) {
      return jsonError(`DB matches read error: ${error.message}`, 500);
    }

    const j = await r.json();
    const hasMatches = Array.isArray(j?.results)
      ? j.results.some((x: any) => Array.isArray(x?.fixtures?.matches) && x.fixtures.matches.length > 0)
      : false;

    if (hasMatches) {
      enabledSet.add(d);
    }
  }

  const enabledDates = Array.from(enabledSet).sort();

  return NextResponse.json({
    from,
    days,
    enabledDates,
    source: "events-fallback",
  });
}

const rows = (data ?? []) as DbMatchRow[];
const enabledSet = new Set<string>();

for (const row of rows) {
    if (!row.utc_date) continue;
    enabledSet.add(localDateKeyFromISO(row.utc_date));
  }

  const enabledDates = Array.from(enabledSet).sort();

  const payload = {
    from,
    to,
    days,
    enabledDates,
    cached: false,
  };

  // cache write
  await supabase.from("api_cache").upsert({
    key: cacheKey,
    payload,
    updated_at: new Date().toISOString(),
  });

  return NextResponse.json(payload);
}