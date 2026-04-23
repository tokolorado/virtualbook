// app/api/sofascore/mapping/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMatchId(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const matchId = toMatchId(url.searchParams.get("matchId"));

    if (!matchId) {
      return NextResponse.json(
        { error: "Missing or invalid matchId" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("match_sofascore_map")
      .select("match_id, sofascore_event_id")
      .eq("match_id", matchId)
      .maybeSingle<{
        match_id: number;
        sofascore_event_id: number | null;
      }>();

    const missingTable =
      typeof error?.message === "string" &&
      error.message.toLowerCase().includes("relation") &&
      error.message.toLowerCase().includes("does not exist");

    if (missingTable) {
      return NextResponse.json(
        {
          matchId,
          mapped: false,
          sofascoreEventId: null,
          error: "Table match_sofascore_map does not exist",
        },
        { status: 200 }
      );
    }

    if (error) {
      return NextResponse.json(
        { error: `match_sofascore_map query failed: ${error.message}` },
        { status: 500 }
      );
    }

    const sofascoreEventId =
      typeof data?.sofascore_event_id === "number"
        ? data.sofascore_event_id
        : null;

    return NextResponse.json(
      {
        matchId,
        mapped: sofascoreEventId !== null,
        sofascoreEventId,
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown mapping endpoint error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}