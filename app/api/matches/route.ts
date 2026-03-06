import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { ensureMatchesCached } from "@/lib/matchSync";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const competition = url.searchParams.get("competition");

  if (!date) return NextResponse.json({ error: "Missing date" }, { status: 400 });

  await ensureMatchesCached(date, 10);

  const sb = supabaseAdmin();
  const start = new Date(date + "T00:00:00.000Z").toISOString();
  const end = new Date(date + "T23:59:59.999Z").toISOString();

  let q = sb.from("matches").select("*").gte("utc_date", start).lte("utc_date", end);
  if (competition) q = q.eq("competition_id", Number(competition));

  const { data, error } = await q.order("utc_date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ matches: data });
}