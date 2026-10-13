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

test("decision endpoint identifies failed dependencies without authorizing plays", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/api/board")) throw new Error("provider offline");
    return { ok: true, json: async () => ({ records: [], dates: [], alerts: [] }) };
  };
  try {
    let status = 200;
    let body;
    const res = {
      setHeader() {},
      status(code) { status = code; return this; },
      json(value) { body = value; return this; },
    };
    await handler({ method: "GET", query: { date: "2026-10-13" } }, res);
    assert.equal(status, 503);
    assert.equal(body.code, "DATA_BLOCKED");
    assert.equal(body.finalPlayAuthorized, false);
    assert.deepEqual(body.failedDependencies, [{ dependency: "board", reason: "UPSTREAM_UNAVAILABLE" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
