// app/api/results/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function mapFdStatusToLocal(fdStatus: string | null | undefined): string {
  // football-data: SCHEDULED | TIMED | IN_PLAY | PAUSED | FINISHED | POSTPONED | SUSPENDED | CANCELED | ...
  const s = (fdStatus ?? "").toUpperCase();
  if (s === "FINISHED") return "FINISHED";
  if (s === "CANCELED") return "CANCELED";
  if (s === "POSTPONED") return "POSTPONED";
  if (s === "SUSPENDED") return "SUSPENDED";
  if (s === "SCHEDULED" || s === "TIMED") return "SCHEDULED";
  if (s === "IN_PLAY" || s === "PAUSED") return "LIVE";
  return "SCHEDULED";
}

function toIntOrNull(x: any): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  return null;
}

function canPersistScore(status: string) {
  return status.toUpperCase() === "FINISHED";
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

  if (!matchId.trim()) {
    return jsonError("Missing matchId", 400);
  }

  // 1) Fetch match details
  const matchRes = await fetchFD(`${BASE}/matches/${encodeURIComponent(matchId)}`, apiKey);
  if (!matchRes.ok) {
    return jsonError("football-data request failed", matchRes.status, {
      upstream: matchRes.data,
    });
  }

  const match = matchRes.data?.match ?? null;
  if (!match) {
    return jsonError("Missing match in upstream response", 502, { upstream: matchRes.data });
  }

  // 2) Extract status + scores
  const localStatus = mapFdStatusToLocal(match?.status);

  // football-data typical shape:
  // match.score.fullTime.home / away
  // match.score.halfTime.home / away
  const ftHome = toIntOrNull(match?.score?.fullTime?.home);
  const ftAway = toIntOrNull(match?.score?.fullTime?.away);
  const htHome = toIntOrNull(match?.score?.halfTime?.home);
  const htAway = toIntOrNull(match?.score?.halfTime?.away);
  const scoreCanBePersisted = canPersistScore(localStatus);

  const utcDate = match?.utcDate ? String(match.utcDate) : null;

  // 3) Save into match_results via RPC
  const upsertPayload = {
    p_match_id: String(matchId),
    p_status: localStatus,
    p_home_score: scoreCanBePersisted ? ftHome : null,
    p_away_score: scoreCanBePersisted ? ftAway : null,
    p_ht_home: scoreCanBePersisted ? htHome : null,
    p_ht_away: scoreCanBePersisted ? htAway : null,
    p_started_at: utcDate, // opcjonalnie: start = utcDate
    p_finished_at: localStatus === "FINISHED" ? new Date().toISOString() : null,
  };

  const { error: upsertErr } = await supabase.rpc("upsert_match_result", upsertPayload);
  if (upsertErr) {
    return jsonError("RPC upsert_match_result failed", 500, { detail: upsertErr, payload: upsertPayload });
  }

  // 4) If finished, settle
  let settleRan = false;
  if (localStatus === "FINISHED") {
    const { error: settleErr } = await supabase.rpc("settle_match", { p_match_id: String(matchId) });
    if (settleErr) {
      return jsonError("RPC settle_match failed", 500, { detail: settleErr, matchId });
    }
    settleRan = true;
  }

  return NextResponse.json({
    ok: true,
    match: {
      id: String(matchId),
      status: match?.status ?? null,
      status_local: localStatus,
      utcDate,
      score: {
        fullTime: { home: ftHome, away: ftAway },
        halfTime: { home: htHome, away: htAway },
      },
    },
    db: {
      upserted: true,
      settled: settleRan,
    },
  });
}
