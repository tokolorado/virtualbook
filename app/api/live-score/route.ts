import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "This endpoint has been disabled. VirtualBook now uses BSD as the only match, odds and results provider.",
    },
    { status: 410 }
  );
}

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "This endpoint has been disabled. VirtualBook now uses BSD as the only match, odds and results provider.",
    },
    { status: 410 }
  );
}