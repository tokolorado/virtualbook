import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { addDaysLocal, todayLocalYYYYMMDD } from "@/lib/date";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TTL_MS = 10 * 60 * 1000; // cache fixtures min 10 min (możesz zostawić)
const MAX_AHEAD_DAYS = 30;

async function readCache(key: string) {
  const { data } = await supabase.from("api_cache").select("*").eq("key", key).single();
  return data ?? null;
}

async function writeCache(key: string, payload: any) {
  await supabase.from("api_cache").upsert({
    key,
    payload,
    updated_at: new Date().toISOString(),
  });
}

export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!secret || secret !== process.env.PREFETCH_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // znajdź “najbliższy nieuzupełniony dzień” w zakresie 0..30
  const base = todayLocalYYYYMMDD();
  let target: string | null = null;

  for (let i = 0; i <= MAX_AHEAD_DAYS; i++) {
    const d = addDaysLocal(base, i);
    const key = `events:${d}`;

    const cached = await readCache(key);
    if (!cached) {
      target = d;
      break;
    }

    const age = Date.now() - new Date(cached.updated_at).getTime();
    if (age > TTL_MS) {
      target = d;
      break;
    }
  }

  if (!target) {
    return NextResponse.json({ ok: true, message: "Cache filled up to +30 days" });
  }

  // wywołaj Twój /api/events i zapisze się do DB cache (bo events route już to robi)
  const url = new URL(`${process.env.NEXT_PUBLIC_BASE_URL}/api/events`);
  url.searchParams.set("date", target);

  const r = await fetch(url.toString(), { cache: "no-store" });
  const payload = await r.json();

  // (opcjonalnie) zapisz też bezpośrednio tu jako "events:date"
  await writeCache(`events:${target}`, payload);

  return NextResponse.json({ ok: true, prefetched: target });
}