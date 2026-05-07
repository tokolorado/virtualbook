// app/api/events/results-ticker/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { todayLocalYYYYMMDD } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MatchResultRow = {
  id: number;
  utc_date: string;
  competition_id: string | null;
  competition_name: string | null;
  home_team: string | null;
  away_team: string | null;
  home_score: number | string | null;
  away_score: number | string | null;
  status: string | null;
};

function safeInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function cleanString(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;

  const text = value.trim();
  return text.length ? text : fallback;
}

function isoStartOfUtcDay(dateYYYYMMDD: string) {
  return new Date(`${dateYYYYMMDD}T00:00:00.000Z`).toISOString();
}

function addDaysYmd(ymd: string, days: number) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function normalizeLimit(value: string | null) {
  const raw = Number(value ?? 16);

  if (!Number.isFinite(raw)) return 16;
  return Math.min(Math.max(Math.trunc(raw), 4), 30);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = normalizeLimit(searchParams.get("limit"));

  const today = todayLocalYYYYMMDD();
  const fromYmd = addDaysYmd(today, -14);
  const rangeStart = isoStartOfUtcDay(fromYmd);

  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("matches")
    .select(
      "id, utc_date, competition_id, competition_name, home_team, away_team, home_score, away_score, status"
    )
    .eq("source", "bsd")
    .in("status", ["FINISHED", "finished"])
    .gte("utc_date", rangeStart)
    .not("home_score", "is", null)
    .not("away_score", "is", null)
    .order("utc_date", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "DB results ticker read error",
        detail: error.message,
        results: [],
      },
      { status: 500 }
    );
  }

  const results = ((data ?? []) as MatchResultRow[])
    .map((row) => {
      const homeScore = safeInt(row.home_score);
      const awayScore = safeInt(row.away_score);

      if (homeScore === null || awayScore === null) return null;

      return {
        id: Number(row.id),
        utcDate: row.utc_date,
        competitionCode: row.competition_id ?? null,
        competitionName: row.competition_name ?? null,
        home: cleanString(row.home_team, "Home"),
        away: cleanString(row.away_team, "Away"),
        homeScore,
        awayScore,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return NextResponse.json(
    {
      ok: true,
      rangeFrom: fromYmd,
      limit,
      results,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    }
  );
}