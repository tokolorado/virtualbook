import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const resultsSyncRoute = fs.readFileSync(
  "app/api/results/sync/route.ts",
  "utf8"
);

test("results sync persists match_results before idempotent settlement", () => {
  assert.match(
    resultsSyncRoute,
    /from\("match_results"\)\s*\.upsert\(\s*matchResultRow,\s*\{\s*onConflict:\s*"match_id"\s*\}\s*\)/i
  );
  assert.match(resultsSyncRoute, /settle_match_once/i);
  assert.doesNotMatch(
    resultsSyncRoute,
    /rpc\("settle_match",\s*\{\s*p_match_id:\s*localMatch\.id/i
  );
});

