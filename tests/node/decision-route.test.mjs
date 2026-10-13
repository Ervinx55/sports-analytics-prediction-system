import assert from "node:assert/strict";
import test from "node:test";
import handler from "../../sharp-service/api/decision.js";

test("decision endpoint rejects non-GET requests without fetching providers", async () => {
  const req = { method: "POST", query: {} };
  let status = 200;
  const headers = {};
  let body;
  const res = {
    setHeader(name, value) { headers[name] = value; },
    status(code) { status = code; return this; },
    json(value) { body = value; return this; },
  };
  await handler(req, res);
  assert.equal(status, 405);
  assert.equal(headers.Allow, "GET");
  assert.deepEqual(body, { error: "GET only" });
});
