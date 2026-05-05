// app/api/cron/pipeline/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Deprecated endpoint. BSD sync-runner is the only active pipeline.",
    },
    { status: 410 }
  );
}