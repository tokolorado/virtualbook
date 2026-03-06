// app/api/markets/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildHalfMarkets, buildMarkets } from "@/lib/odds/markets";
import { calcLambdas, splitHalfLambdas, type StandingRow } from "@/lib/odds/model";

const BASE = "https://api.football-data.org/v4";

function jsonError(message: string, status = 500, extra?: any) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function fetchFD(url: string, apiKey: string) {
  const r = await fetch(url, {
    headers: { "X-Auth-Token": apiKey },
    cache: "no-store",
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, data: safeJson(text) };
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

export async function GET(req: Request) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey) return jsonError("Missing FOOTBALL_DATA_API_KEY in env", 500);
  if (!supabaseUrl) return jsonError("Missing SUPABASE_URL in env", 500);
  if (!serviceKey) return jsonError("Missing SUPABASE_SERVICE_ROLE_KEY in env", 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  const { searchParams } = new URL(req.url);

  const matchId = searchParams.get("matchId") || "";
  const competitionCode = searchParams.get("competitionCode") || "";
  const homeId = Number(searchParams.get("homeId"));
  const awayId = Number(searchParams.get("awayId"));
  const kickoffUtc = searchParams.get("kickoffUtc") || "";

  if (
    !isNonEmptyString(matchId) ||
    !isNonEmptyString(competitionCode) ||
    !Number.isFinite(homeId) ||
    !Number.isFinite(awayId)
  ) {
    return jsonError("Invalid query params", 400, {
      expected: ["matchId", "competitionCode", "homeId", "awayId", "kickoffUtc?"],
      got: Object.fromEntries(searchParams.entries()),
    });
  }

  // --- Cache helpers (api_cache) ---
  const readCache = async (key: string) => {
    const { data, error } = await supabase.from("api_cache").select("*").eq("key", key).single();
    if (error) return null;
    return data?.payload ?? null;
  };

  const writeCache = async (key: string, payload: any) => {
    await supabase.from("api_cache").upsert({
      key,
      payload,
      updated_at: new Date().toISOString(),
    });
  };

  // 1) match details (opcjonalnie, dla nazw)
  // cachujemy na krótko po matchId (żeby nie spamować API)
  const matchCacheKey = `match:${matchId}`;
  let match: any = await readCache(matchCacheKey);

  if (!match) {
    const matchRes = await fetchFD(`${BASE}/matches/${encodeURIComponent(matchId)}`, apiKey);
    if (matchRes.ok) {
      match = matchRes.data?.match ?? null;
      if (match) await writeCache(matchCacheKey, match);
    } else {
      match = null;
    }
  }

  // 2) standings from cache (or fetch+cache)
  const stKey = `st:${competitionCode}`;
  let standingsPayload: any = await readCache(stKey);

  if (!standingsPayload) {
    const stRes = await fetchFD(`${BASE}/competitions/${competitionCode}/standings`, apiKey);
    if (stRes.ok) {
      standingsPayload = stRes.data;
      await writeCache(stKey, standingsPayload);
    } else {
      standingsPayload = null;
    }
  }

  // 3) parse standings rows
  const table =
    standingsPayload?.standings?.find((x: any) => x.type === "TOTAL")?.table ??
    standingsPayload?.standings?.[0]?.table ??
    [];

  const rows: StandingRow[] = [];
  for (const r of table) {
    const teamId = r?.team?.id;
    const position = r?.position;
    if (typeof teamId !== "number" || typeof position !== "number") continue;

    rows.push({
      teamId,
      position,
      playedGames: Number(r?.playedGames ?? 0),
      points: Number(r?.points ?? 0),
      goalsFor: Number(r?.goalsFor ?? 0),
      goalsAgainst: Number(r?.goalsAgainst ?? 0),
    });
  }

  const homeRow = rows.find((x) => x.teamId === homeId) ?? null;
  const awayRow = rows.find((x) => x.teamId === awayId) ?? null;

  // 4) lambdas + markets
  const { lambdaHome, lambdaAway } = calcLambdas({
    home: homeRow,
    away: awayRow,
    leagueRows: rows,
  });

  const halves = splitHalfLambdas(lambdaHome, lambdaAway);

  const groups = [
    ...buildMarkets({ lambdaHome, lambdaAway }),
    buildHalfMarkets({
      lambdaHome: halves.ht.lambdaHome,
      lambdaAway: halves.ht.lambdaAway,
      prefix: "ht",
    }),
    buildHalfMarkets({
      lambdaHome: halves.sh.lambdaHome,
      lambdaAway: halves.sh.lambdaAway,
      prefix: "sh",
    }),
  ];

  return NextResponse.json({
    match: {
      id: String(matchId),
      utcDate: match?.utcDate ?? kickoffUtc ?? null,
      competitionCode,
      competitionName: match?.competition?.name ?? competitionCode,
      home: match?.homeTeam?.name ?? null,
      away: match?.awayTeam?.name ?? null,
    },
    groups,
    meta: {
      lambdaHome,
      lambdaAway,
      ht: halves.ht,
      sh: halves.sh,
    },
  });
}