import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonBody = Record<string, unknown>;

type ProfileRow = {
  id: string;
  username: string | null;
  email: string | null;
};

type BetRow = {
  id: string;
  user_id: string;
  stake: number | string | null;
  total_odds: number | string | null;
  potential_win: number | string | null;
  payout: number | string | null;
  status: string | null;
  settled: boolean | null;
  created_at: string | null;
  settled_at: string | null;
};

type BetItemRow = {
  id: string;
  bet_id: string;
  user_id: string;
  match_id_bigint: number | string | null;
  league: string | null;
  home: string | null;
  away: string | null;
  market: string | null;
  pick: string | null;
  odds: number | string | null;
  result: string | null;
  settled: boolean | null;
  settled_at: string | null;
  kickoff_at: string | null;
  created_at: string | null;
};

const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 1000;
const MAX_DAYS = 30;
const MAX_LIMIT = 1000;
const IN_CHUNK_SIZE = 100;

function json(status: number, body: JsonBody) {
  return NextResponse.json(body, { status });
}

function parseBoundedNumber(
  value: string | null,
  fallback: number,
  min: number,
  max: number
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function displayName(profile: ProfileRow | undefined, userId: string) {
  return profile?.username || profile?.email || userId;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => !!value))];
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export async function GET(req: Request) {
  const guard = await requireAdmin(req);

  if (!guard.ok) {
    return json(guard.status, { ok: false, error: guard.error });
  }

  const url = new URL(req.url);
  const days = parseBoundedNumber(
    url.searchParams.get("days"),
    DEFAULT_DAYS,
    1,
    MAX_DAYS
  );
  const limit = parseBoundedNumber(
    url.searchParams.get("limit"),
    DEFAULT_LIMIT,
    1,
    MAX_LIMIT
  );

  const cutoffIso = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000
  ).toISOString();

  try {
    const supabase = supabaseAdmin();

    const { data: betRows, error: betsError } = await supabase
      .from("bets")
      .select(
        "id,user_id,stake,total_odds,potential_win,payout,status,settled,created_at,settled_at"
      )
      .gte("created_at", cutoffIso)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (betsError) {
      return json(500, { ok: false, error: betsError.message });
    }

    const bets = (betRows ?? []) as BetRow[];
    const betIds = uniqueStrings(bets.map((bet) => bet.id));
    const userIds = uniqueStrings(bets.map((bet) => bet.user_id));

    const profilesById = new Map<string, ProfileRow>();

    if (userIds.length > 0) {
      const { data: profileRows, error: profilesError } = await supabase
        .from("profiles")
        .select("id,username,email")
        .in("id", userIds);

      if (profilesError) {
        return json(500, { ok: false, error: profilesError.message });
      }

      for (const profile of (profileRows ?? []) as ProfileRow[]) {
        profilesById.set(String(profile.id), profile);
      }
    }

    const itemsByBetId = new Map<string, BetItemRow[]>();

    for (const betIdChunk of chunk(betIds, IN_CHUNK_SIZE)) {
      const { data: itemRows, error: itemsError } = await supabase
        .from("bet_items")
        .select(
          "id,bet_id,user_id,match_id_bigint,league,home,away,market,pick,odds,result,settled,settled_at,kickoff_at,created_at"
        )
        .in("bet_id", betIdChunk)
        .order("created_at", { ascending: true });

      if (itemsError) {
        return json(500, { ok: false, error: itemsError.message });
      }

      for (const item of (itemRows ?? []) as BetItemRow[]) {
        const betId = String(item.bet_id);
        const group = itemsByBetId.get(betId) ?? [];
        group.push(item);
        itemsByBetId.set(betId, group);
      }
    }

    const normalizedBets = bets.map((bet) => {
      const userId = String(bet.user_id);
      const profile = profilesById.get(userId);
      const items = (itemsByBetId.get(String(bet.id)) ?? []).map((item) => ({
        id: item.id,
        bet_id: item.bet_id,
        user_id: item.user_id,
        match_id_bigint: toNumber(item.match_id_bigint),
        league: item.league ?? "",
        home: item.home ?? "",
        away: item.away ?? "",
        market: item.market ?? "",
        pick: item.pick ?? "",
        odds: toNumber(item.odds),
        result: item.result ?? null,
        settled: Boolean(item.settled),
        settled_at: item.settled_at,
        kickoff_at: item.kickoff_at,
        created_at: item.created_at,
      }));

      return {
        id: bet.id,
        user_id: userId,
        user: {
          id: userId,
          username: profile?.username ?? null,
          email: profile?.email ?? null,
          display_name: displayName(profile, userId),
        },
        stake: toNumber(bet.stake),
        total_odds: toNumber(bet.total_odds),
        potential_win: toNumber(bet.potential_win),
        payout: bet.payout === null ? null : toNumber(bet.payout),
        status: bet.status ?? "pending",
        settled: Boolean(bet.settled),
        created_at: bet.created_at,
        settled_at: bet.settled_at,
        item_count: items.length,
        items,
      };
    });

    return json(200, {
      ok: true,
      days,
      cutoffIso,
      limit,
      returned: normalizedBets.length,
      possiblyLimited: normalizedBets.length === limit,
      bets: normalizedBets,
    });
  } catch (error: unknown) {
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : "Server error",
    });
  }
}
