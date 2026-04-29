import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import {
  MISSION_DEFINITIONS,
  evaluateMissions,
  missionWindow,
  type MissionBet,
  type MissionBetItem,
  type MissionClaim,
} from "@/lib/missions";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  missionId?: string;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

async function loadMissionState(userId: string) {
  const admin = supabaseAdmin();
  const window = missionWindow();

  const { data: betRows, error: betsError } = await admin
    .from("bets")
    .select("id,status,total_odds,created_at")
    .eq("user_id", userId)
    .gte("created_at", window.weekStartIso)
    .order("created_at", { ascending: false });

  if (betsError) {
    throw new Error(betsError.message);
  }

  const bets = (betRows ?? []) as MissionBet[];
  const betIds = bets.map((bet) => bet.id);
  let items: MissionBetItem[] = [];

  if (betIds.length > 0) {
    const { data: itemRows, error: itemsError } = await admin
      .from("bet_items")
      .select("bet_id,odds")
      .in("bet_id", betIds);

    if (itemsError) {
      throw new Error(itemsError.message);
    }

    items = (itemRows ?? []) as MissionBetItem[];
  }

  const periodKeys = [window.dailyKey, window.weeklyKey];
  const { data: claimRows, error: claimsError } = await admin
    .from("user_mission_claims")
    .select("mission_id,period_key")
    .eq("user_id", userId)
    .in("period_key", periodKeys);

  if (claimsError) {
    throw new Error(claimsError.message);
  }

  const claims = (claimRows ?? []) as MissionClaim[];

  return {
    window,
    bets,
    items,
    claims,
    missions: evaluateMissions({ bets, items, claims }),
  };
}

export async function GET(req: Request) {
  const user = await requireUser(req);

  if (!user.ok) {
    return json(user.status, { ok: false, error: user.error });
  }

  try {
    const state = await loadMissionState(user.userId);

    return json(200, {
      ok: true,
      window: state.window,
      missions: state.missions,
    });
  } catch (error: unknown) {
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : "Server error",
    });
  }
}

export async function POST(req: Request) {
  const user = await requireUser(req);

  if (!user.ok) {
    return json(user.status, { ok: false, error: user.error });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const missionId = String(body.missionId ?? "").trim();
  const definition = MISSION_DEFINITIONS.find((mission) => mission.id === missionId);

  if (!definition) {
    return json(404, { ok: false, error: "Mission not found" });
  }

  try {
    const state = await loadMissionState(user.userId);
    const mission = state.missions.find((entry) => entry.id === missionId);

    if (!mission) {
      return json(404, { ok: false, error: "Mission not found" });
    }

    if (!mission.completed) {
      return json(400, { ok: false, error: "Mission is not completed yet" });
    }

    if (mission.claimed) {
      return json(409, { ok: false, error: "Mission reward already claimed" });
    }

    const admin = supabaseAdmin();
    const { data, error } = await admin.rpc("claim_mission_reward", {
      p_user_id: user.userId,
      p_mission_id: mission.id,
      p_period_key: mission.periodKey,
      p_reward_amount: mission.reward,
      p_details: {
        title: mission.title,
        period: mission.period,
        progress: mission.progress,
        target: mission.target,
      },
    });

    if (error) {
      return json(400, { ok: false, error: error.message });
    }

    return json(200, {
      ok: true,
      result: data,
    });
  } catch (error: unknown) {
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : "Server error",
    });
  }
}
