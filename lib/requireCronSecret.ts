import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

export type CronSecretAuthResult =
  | { ok: true; secret: string }
  | {
      ok: false;
      status: 401 | 500;
      error: string;
      reason: "missing_cron_secret_env" | "unauthorized";
    };

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function timingSafeStringEqual(a: string, b: string) {
  return timingSafeEqual(digest(a), digest(b));
}

function bearerToken(value: string | null) {
  const header = value ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export function checkCronSecretHeaders(
  headers: Pick<Headers, "get">,
  expected: string | undefined
): CronSecretAuthResult {
  if (!expected) {
    return {
      ok: false,
      status: 500,
      error: "Missing CRON_SECRET in env",
      reason: "missing_cron_secret_env",
    };
  }

  const candidates = [
    headers.get("x-cron-secret") ?? "",
    bearerToken(headers.get("authorization")),
  ];

  const ok = candidates.some((candidate) =>
    candidate ? timingSafeStringEqual(candidate, expected) : false
  );

  if (!ok) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized",
      reason: "unauthorized",
    };
  }

  return { ok: true, secret: expected };
}

export function getCronSecretAuthResult(req: Request) {
  return checkCronSecretHeaders(req.headers, process.env.CRON_SECRET);
}

export function requireCronSecret(req: Request) {
  const auth = getCronSecretAuthResult(req);

  if (auth.ok) return null;

  return NextResponse.json(
    { ok: false, error: auth.error },
    { status: auth.status }
  );
}
