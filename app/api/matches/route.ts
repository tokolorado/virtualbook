import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "This endpoint has been disabled. Use /api/events and BSD-backed sync instead.",
    },
    { status: 410 }
  );
}
