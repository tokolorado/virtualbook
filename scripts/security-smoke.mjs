import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const origin = "http://127.0.0.1:3210";
const checks = [
  ["GET", "/api/auth/check-email?email=existing@example.com", 410],
  ["GET", "/api/auth/check-email?email=new@example.com", 410],
  ["GET", "/api/admin/users", 401],
  ["GET", "/api/admin/cron-logs", 401],
  ["GET", "/api/admin/system-health", 401],
  ["GET", "/api/cron/settle", 405],
  ["POST", "/api/cron/settle", 401],
];

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${origin}/api/auth/check-email`, { signal: AbortSignal.timeout(2000) });
    break;
  } catch (error) {
    if (attempt >= 59) throw error;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

for (const [method, path, status] of checks) {
  const response = await fetch(`${origin}${path}`, {
    method,
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, status, `${method} ${path}`);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  if (path.startsWith("/api/auth/check-email")) {
    const body = await response.json();
    for (const field of ["exists", "confirmed", "email", "users"]) {
      assert.equal(field in body, false);
    }
  }
  console.log(`${method} ${path.split("?")[0]}: ${status}`);
}

// The unreachable build-only Supabase configuration makes any accidental
// database logging before authorization observable in the local server log.
if (process.env.SECURITY_SMOKE_LOG) {
  const log = readFileSync(process.env.SECURITY_SMOKE_LOG, "utf8");
  assert.doesNotMatch(log, /cronLog(?:Start|Success|Error) error:/);
}
