import { NextResponse } from "next/server";

export function requireCronSecret(req: Request) {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "Missing CRON_SECRET in env" },
      { status: 500 }
    );
  }

  const gotCustom = req.headers.get("x-cron-secret") || "";
  const gotAuth = req.headers.get("authorization") || "";

  const ok =
    gotCustom === expected ||
    gotAuth === `Bearer ${expected}`;

  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  return null;
}