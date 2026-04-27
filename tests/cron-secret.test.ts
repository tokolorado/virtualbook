import test from "node:test";
import assert from "node:assert/strict";
import {
  checkCronSecretHeaders,
  timingSafeStringEqual,
} from "../lib/requireCronSecret";

test("cron secret accepts x-cron-secret", () => {
  const result = checkCronSecretHeaders(
    new Headers({ "x-cron-secret": "secret-value" }),
    "secret-value"
  );

  assert.equal(result.ok, true);
});

test("cron secret accepts bearer token", () => {
  const result = checkCronSecretHeaders(
    new Headers({ authorization: "Bearer secret-value" }),
    "secret-value"
  );

  assert.equal(result.ok, true);
});

test("cron secret rejects missing env", () => {
  const result = checkCronSecretHeaders(new Headers(), undefined);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 500);
    assert.equal(result.reason, "missing_cron_secret_env");
  }
});

test("cron secret rejects wrong values", () => {
  const result = checkCronSecretHeaders(
    new Headers({ "x-cron-secret": "wrong" }),
    "secret-value"
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 401);
    assert.equal(result.reason, "unauthorized");
  }
});

test("timingSafeStringEqual handles different lengths", () => {
  assert.equal(timingSafeStringEqual("short", "much-longer-secret"), false);
});
