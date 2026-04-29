import { NextResponse } from "next/server";
import { formatBetSelectionLabels } from "@/lib/odds/labels";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
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
  settled_at: string | null;
  created_at: string | null;
  bet_type: string | null;
  public_share_created_at: string | null;
};

type BetItemRow = {
  id: string;
  bet_id: string;
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

type ProfileRow = {
  id: string;
  username: string | null;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function tokenIsSafe(value: string) {
  return /^[A-Za-z0-9_-]{24,96}$/.test(value);
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statusLabel(status: string | null) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "won") return "Wygrany";
  if (normalized === "lost") return "Przegrany";
  if (normalized === "void") return "Zwrot";
  return "W grze";
}

export async function GET(_req: Request, context: RouteContext) {
  const { token: rawToken } = await context.params;
  const token = String(rawToken ?? "").trim();

  if (!tokenIsSafe(token)) {
    return json(400, { ok: false, error: "Invalid token" });
  }

  try {
    const admin = supabaseAdmin();
    const { data: betRow, error: betError } = await admin
      .from("bets")
      .select(
        [
          "id",
          "user_id",
          "stake",
          "total_odds",
          "potential_win",
          "payout",
          "status",
          "settled",
          "settled_at",
          "created_at",
          "bet_type",
          "public_share_created_at",
        ].join(",")
      )
      .eq("public_share_enabled", true)
      .eq("public_share_token", token)
      .maybeSingle<BetRow>();

    if (betError) {
      return json(500, { ok: false, error: betError.message });
    }

    if (!betRow) {
      return json(404, { ok: false, error: "Public bet not found" });
    }

    const [{ data: profileRow }, { data: itemRows, error: itemsError }] =
      await Promise.all([
        admin
          .from("profiles")
          .select("id,username")
          .eq("id", betRow.user_id)
          .maybeSingle<ProfileRow>(),
        admin
          .from("bet_items")
          .select(
            [
              "id",
              "bet_id",
              "match_id_bigint",
              "league",
              "home",
              "away",
              "market",
              "pick",
              "odds",
              "result",
              "settled",
              "settled_at",
              "kickoff_at",
              "created_at",
            ].join(",")
          )
          .eq("bet_id", betRow.id)
          .order("created_at", { ascending: true }),
      ]);

    if (itemsError) {
      return json(500, { ok: false, error: itemsError.message });
    }

    const items = ((itemRows ?? []) as unknown as BetItemRow[]).map((item) => {
      const labels = formatBetSelectionLabels({
        market: item.market,
        pick: item.pick,
        home: item.home,
        away: item.away,
      });

      return {
        id: item.id,
        match_id_bigint: item.match_id_bigint,
        league: item.league ?? "",
        home: item.home ?? "",
        away: item.away ?? "",
        market: item.market ?? "",
        pick: item.pick ?? "",
        marketLabel: labels.marketLabel,
        selectionLabel: labels.selectionLabel,
        odds: toNumber(item.odds),
        result: item.result,
        settled: Boolean(item.settled),
        settled_at: item.settled_at,
        kickoff_at: item.kickoff_at,
        created_at: item.created_at,
      };
    });

    return json(200, {
      ok: true,
      bet: {
        id: betRow.id,
        user: {
          username: profileRow?.username ?? null,
        },
        stake: toNumber(betRow.stake),
        total_odds: toNumber(betRow.total_odds),
        potential_win: toNumber(betRow.potential_win),
        payout: betRow.payout == null ? null : toNumber(betRow.payout),
        status: betRow.status ?? "pending",
        statusLabel: statusLabel(betRow.status),
        settled: Boolean(betRow.settled),
        settled_at: betRow.settled_at,
        created_at: betRow.created_at,
        bet_type: betRow.bet_type ?? "standard",
        public_share_created_at: betRow.public_share_created_at,
        item_count: items.length,
      },
      items,
    });
  } catch (error: unknown) {
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : "Server error",
    });
  }
}
