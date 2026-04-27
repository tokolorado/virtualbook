import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase",
  "migrations",
  "20260427_weekly_grant_200.sql"
);

const migrationSql = readFileSync(migrationPath, "utf8");

test("weekly grant migration fixes every known grant amount to 200 VB", () => {
  assert.match(migrationSql, /v_grant_amount\s+numeric\s*:=\s*200/i);
  assert.match(migrationSql, /p_amount\s+numeric\s+default\s+200/i);
  assert.doesNotMatch(migrationSql, /WEEKLY_GRANT[\s\S]{0,120}\b1000\b/i);
});

test("weekly grant migration keeps legacy-safe weekly idempotency", () => {
  assert.match(migrationSql, /created_at\s*>=\s*v_week_start_utc/i);
  assert.match(migrationSql, /created_at\s*<\s*v_next_week_start_utc/i);
  assert.match(migrationSql, /pg_advisory_xact_lock/i);
});

test("weekly grant migration revokes public execute permissions", () => {
  assert.match(
    migrationSql,
    /revoke\s+all\s+on\s+function\s+public\.vb_weekly_grant_if_due\(uuid\)\s+from\s+public/i
  );
  assert.match(
    migrationSql,
    /revoke\s+all\s+on\s+function\s+public\.grant_weekly_vb\(numeric\)\s+from\s+authenticated/i
  );
  assert.match(
    migrationSql,
    /revoke\s+all\s+on\s+function\s+public\.vb_weekly_grant\(\)\s+from\s+authenticated/i
  );
});
