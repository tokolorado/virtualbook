/*
// app/api/settle-pending/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BASE = "https://api.football-data.org/v4";

function jsonError(message: string, status = 500, extra?: any) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
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

function requireAdmin(req: Request) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    return { ok: false as const, status: 500, message: "Missing ADMIN_API_KEY in env" };
  }

  const got = req.headers.get("x-admin-key") || "";
  if (!got || got !== expected) {
    return { ok: false as const, status: 401, message: "Unauthorized" };
  }

  return { ok: true as const };
}

async function handle(req: Request) {
  // ✅ Admin guard
  const admin = requireAdmin(req);
  if (!admin.ok) return jsonError(admin.message, admin.status);

  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) return jsonError("Missing SUPABASE_URL in env", 500);
  if (!serviceKey) return jsonError("Missing SUPABASE_SERVICE_ROLE_KEY in env", 500);

  // apiKey jest wymagany tylko jeśli nie używamy skipFetch=1
  const { searchParams } = new URL(req.url);

  const matchIdParam = searchParams.get("matchId"); // np. "544470"
  const skipFetch = (searchParams.get("skipFetch") ?? "0") === "1";

  if (!skipFetch && !apiKey) {
    return jsonError("Missing FOOTBALL_DATA_API_KEY in env", 500);
  }

  const limit = Math.min(Number(searchParams.get("limit") ?? 25), 100); // max 100
  const bufferMinutes = Math.max(Number(searchParams.get("bufferMinutes") ?? 10), 0);
  const onlyFinished = (searchParams.get("onlyFinished") ?? "0") === "1";

  const supabase = createClient(supabaseUrl, serviceKey);

  // 1) Lista matchId do przetworzenia
  let uniq: string[] = [];

  if (matchIdParam) {
    uniq = [String(matchIdParam)];
  } else {
    const now = new Date();
    const cutoff = new Date(now.getTime() - bufferMinutes * 60_000).toISOString();

    const { data: rows, error: qErr } = await supabase
      .from("bet_items")
      .select("match_id, kickoff_at")
      .or("settled.is.false,settled.is.null")
      .not("match_id", "is", null)
      .lte("kickoff_at", cutoff)
      .order("kickoff_at", { ascending: true })
      .limit(5000);

    if (qErr) return jsonError("DB query failed (bet_items)", 500, { detail: qErr });

    const seen = new Set<string>();
    for (const r of rows ?? []) {
      const id = String((r as any).match_id ?? "");
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      uniq.push(id);
      if (uniq.length >= limit) break;
    }
  }

  const results: any[] = [];

  for (const matchId of uniq) {
    // A) SKIP FETCH: bierzemy status/score z match_results i ewentualnie rozliczamy
    if (skipFetch) {
      const { data: mr, error: mrErr } = await supabase
        .from("match_results")
        .select("match_id,status,home_score,away_score,ht_home_score,ht_away_score")
        .eq("match_id", String(matchId))
        .maybeSingle();

      if (mrErr) {
        results.push({ matchId, ok: false, step: "db_match_results_read", detail: mrErr });
        continue;
      }
      if (!mr) {
        results.push({
          matchId,
          ok: false,
          step: "db_match_results_read",
          error: "No row in match_results for this matchId (use INSERT first)",
        });
        continue;
      }

      const localStatus = String((mr as any).status ?? "").toUpperCase() || "SCHEDULED";

      if (onlyFinished && localStatus !== "FINISHED") {
        results.push({ matchId, ok: true, skipped: true, reason: "onlyFinished", status_local: localStatus });
        continue;
      }

      let settled = false;
      if (localStatus === "FINISHED") {
        // ⚠️ WAŻNE: w DB MUSI zostać tylko settle_match(TEXT), bez overloadu BIGINT.
        const { error: settleErr } = await supabase.rpc("settle_match", {
          p_match_id: String(matchId),
        });

        if (settleErr) {
          results.push({ matchId, ok: false, step: "rpc_settle_match", detail: settleErr });
          continue;
        }

        settled = true;
      }

      results.push({
        matchId,
        ok: true,
        status_local: localStatus,
        skipFetch: true,
        settled,
        score: {
          ft: { home: (mr as any).home_score ?? null, away: (mr as any).away_score ?? null },
          ht: { home: (mr as any).ht_home_score ?? null, away: (mr as any).ht_away_score ?? null },
        },
      });

      continue;
    }

    // B) NORMAL: fetch z football-data, upsert do match_results, potem settle jeśli FINISHED
    const matchRes = await fetchFD(`${BASE}/matches/${encodeURIComponent(matchId)}`, apiKey!);

    if (!matchRes.ok) {
      results.push({
        matchId,
        ok: false,
        step: "fetch",
        status: matchRes.status,
        upstream: matchRes.data,
      });
      continue;
    }

    const match = (matchRes.data as any)?.match ?? null;
    if (!match) {
      results.push({ matchId, ok: false, step: "parse", error: "Missing match in upstream response" });
      continue;
    }

    const localStatus = mapFdStatusToLocal(match?.status);

    if (onlyFinished && localStatus !== "FINISHED") {
      results.push({ matchId, ok: true, skipped: true, reason: "onlyFinished", status_local: localStatus });
      continue;
    }

    const ftHome = toIntOrNull(match?.score?.fullTime?.home);
    const ftAway = toIntOrNull(match?.score?.fullTime?.away);
    const htHome = toIntOrNull(match?.score?.halfTime?.home);
    const htAway = toIntOrNull(match?.score?.halfTime?.away);
    const utcDate = match?.utcDate ? String(match.utcDate) : null;

    const upsertPayload = {
      p_match_id: String(matchId),
      p_status: localStatus,
      p_home_score: ftHome,
      p_away_score: ftAway,
      p_ht_home: htHome,
      p_ht_away: htAway,
      p_started_at: utcDate,
      p_finished_at: localStatus === "FINISHED" ? new Date().toISOString() : null,
    };

    const { error: upsertErr } = await supabase.rpc("upsert_match_result", upsertPayload);
    if (upsertErr) {
      results.push({
        matchId,
        ok: false,
        step: "rpc_upsert_match_result",
        detail: upsertErr,
        payload: upsertPayload,
      });
      continue;
    }

    let settled = false;
    if (localStatus === "FINISHED") {
      // ⚠️ WAŻNE: w DB MUSI zostać tylko settle_match(TEXT), bez overloadu BIGINT.
      const { error: settleErr } = await supabase.rpc("settle_match", {
        p_match_id: String(matchId),
      });

      if (settleErr) {
        results.push({ matchId, ok: false, step: "rpc_settle_match", detail: settleErr });
        continue;
      }
      settled = true;
    }

    results.push({
      matchId,
      ok: true,
      status_local: localStatus,
      saved: true,
      settled,
      score: { ft: { home: ftHome, away: ftAway }, ht: { home: htHome, away: htAway } },
    });
  }

  return NextResponse.json({
    ok: true,
    queued: uniq.length,
    limit,
    bufferMinutes,
    onlyFinished,
    skipFetch,
    matchId: matchIdParam ?? null,
    results,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  // Żeby curl -X POST działał (i żebyś mógł to odpalać jako "job")
  return handle(req);
}
  */

import { NextResponse } from "next/server";