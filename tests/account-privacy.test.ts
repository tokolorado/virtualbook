import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/api/auth/check-email/route";

test("retired account lookup reveals no account or confirmation state", async () => {
  const handle: (request: Request) => Response = GET;
  const bodies = [];

  for (const email of ["", "new@example.com", "existing@example.com", "invalid"]) {
    const response = handle(
      new Request(`https://example.com/api/auth/check-email?email=${encodeURIComponent(email)}`)
    );
    assert.equal(response.status, 410);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    for (const field of ["exists", "confirmed", "email", "users"]) {
      assert.equal(field in body, false);
    }
    bodies.push(body);
  }

  for (const body of bodies) assert.deepEqual(body, bodies[0]);
});
