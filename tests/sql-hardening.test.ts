import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const snapshot = fs.readFileSync(
  "supabase/functions/public_function_definitions_20260427.sql",
  "utf8"
);

const migration = fs.readFileSync(
  "supabase/migrations/20260427_harden_upsert_match_result_search_path.sql",
  "utf8"
);

const privilegesMigration = fs.readFileSync(
  "supabase/migrations/20260427_harden_function_execute_privileges.sql",
  "utf8"
);

const adminForceSettleMigration = fs.readFileSync(
  "supabase/migrations/20260427_admin_force_settle_bet.sql",
  "utf8"
);

const sameMatchAccumulatorMigration = fs.readFileSync(
  "supabase/migrations/20260428_reject_same_match_accumulator_items.sql",
  "utf8"
);

test("production function snapshot documents every inspected public function", () => {
  const functionHeaders = snapshot.match(/^-- Function:/gm) ?? [];

  assert.equal(functionHeaders.length, 11);
});

test("upsert_match_result hardening migration pins both overload search paths", () => {
  const alterStatements = migration.match(
    /alter\s+function\s+public\.upsert_match_result\s*\(/gi
  ) ?? [];

  assert.equal(alterStatements.length, 2);
  assert.match(migration, /set\s+search_path\s+to\s+public/gi);
});

test("function privilege hardening keeps only place_bet public to authenticated users", () => {
  assert.match(
    privilegesMigration,
    /grant\s+execute\s+on\s+function\s+public\.place_bet\(\s*numeric,\s*jsonb,\s*uuid\s*\)\s+to\s+authenticated,\s+service_role/i
  );

  for (const functionName of [
    "apply_vb_transaction",
    "run_system_check_suite",
    "settle_bet",
    "settle_match",
    "settle_match_once",
    "upsert_match_result",
    "vb_weekly_grant_if_due",
    "grant_weekly_vb",
    "vb_weekly_grant",
  ]) {
    assert.match(
      privilegesMigration,
      new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+public\\.${functionName}\\(`,
        "i"
      )
    );
  }
});

test("admin manual settlement is transactional and service-role only", () => {
  assert.match(
    adminForceSettleMigration,
    /create\s+or\s+replace\s+function\s+public\.admin_force_settle_bet/i
  );
  assert.match(adminForceSettleMigration, /perform\s+public\.settle_bet/i);
  assert.match(
    adminForceSettleMigration,
    /insert\s+into\s+public\.admin_audit_logs/i
  );
  assert.match(
    adminForceSettleMigration,
    /revoke\s+all\s+on\s+function\s+public\.admin_force_settle_bet\(uuid,\s*text,\s*uuid\)\s+from\s+public,\s+anon,\s+authenticated/i
  );
  assert.match(
    adminForceSettleMigration,
    /grant\s+execute\s+on\s+function\s+public\.admin_force_settle_bet\(uuid,\s*text,\s*uuid\)\s+to\s+service_role/i
  );
});

test("place_bet rejects same-match accumulator correlations in SQL", () => {
  assert.match(
    sameMatchAccumulatorMigration,
    /v_distinct_matches\s+integer/i
  );
  assert.match(
    sameMatchAccumulatorMigration,
    /if\s+v_distinct_matches\s*<>\s*v_items_count\s+then/i
  );
  assert.match(
    sameMatchAccumulatorMigration,
    /Correlated selections in same match are not allowed/i
  );
});
