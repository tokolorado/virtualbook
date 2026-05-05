import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const resultsSyncRoute = fs.readFileSync(
  "app/api/results/sync/route.ts",
  "utf8"
);

test("legacy results sync endpoint is disabled after BSD migration", () => {
  assert.match(
    resultsSyncRoute,
    /VirtualBook now uses BSD as the only match, odds and results provider/i
  );
  assert.match(resultsSyncRoute, /status:\s*410/i);
});
