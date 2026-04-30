import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const settleCronRoute = fs.readFileSync(
  "app/api/cron/settle/route.ts",
  "utf8"
);

const cronLogger = fs.readFileSync("lib/cronLogger.ts", "utf8");

test("settle cron treats SQL ok=false responses as real failures", () => {
  assert.match(settleCronRoute, /settleResult\.ok\s*===\s*false/);
  assert.match(settleCronRoute, /failedMatchResults/);
  assert.match(settleCronRoute, /failedBackfillResults/);
  assert.match(settleCronRoute, /cronLogError\(logId,\s*\{/);
  assert.match(settleCronRoute, /return\s+json\(500,\s*responseBody\)/);
});

test("cron logger preserves structured error details", () => {
  assert.match(
    cronLogger,
    /typeof\s+error\s+===\s+"object"\s+&&\s+error\s+!==\s+null/
  );
  assert.doesNotMatch(cronLogger, /message:\s*error\s+instanceof\s+Error/);
});
