// app/api/fixtures/route.ts
import { NextResponse } from "next/server";
import { addDaysLocal } from "@/lib/date";

const BASE = "https://api.football-data.org/v4";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date"); // YYYY-MM-DD (lokalnie)
  const competition = searchParams.get("competition");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid or missing date (YYYY-MM-DD)." }, { status: 400 });
  }
  if (!competition) {
    return NextResponse.json({ error: "Missing competition code." }, { status: 400 });
  }

  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing FOOTBALL_DATA_API_KEY in env." }, { status: 500 });
  }

  // ✅ szersze okno dla UTC/local mismatch
  const dateFrom = addDaysLocal(date, -1);
  const dateTo = addDaysLocal(date, +1);

  const url = new URL(`${BASE}/competitions/${competition}/matches`);
  url.searchParams.set("dateFrom", dateFrom);
  url.searchParams.set("dateTo", dateTo);

  const r = await fetch(url.toString(), {
    headers: { "X-Auth-Token": apiKey },
    cache: "no-store",
  });

  const text = await r.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return NextResponse.json(data, { status: r.status });
}