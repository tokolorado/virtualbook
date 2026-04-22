import { NextResponse } from "next/server";
import { getMappedSofascoreEventId } from "@/lib/sofascore/mapping";

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

    const sofascoreEventId = await getMappedSofascoreEventId(matchId);

    return NextResponse.json(
      {
        matchId,
        sofascoreEventId,
        mapped: sofascoreEventId !== null,
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown mapping read error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}