import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import handler from "../../sharp-service/api/props.js";

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
const originalSetTimeout = globalThis.setTimeout;
const originalApiKey = process.env.SPORTS_ODDS_API_KEY;

function resetPropsCache() {
  const cache = globalThis.__edgeLabPropsCache;
  cache?.entries?.clear();
  cache?.inFlight?.clear();
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers
    }
  });
}

function createRes() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

async function invoke(query = {}, method = "GET") {
  const req = { method, query };
  const res = createRes();
  await handler(req, res);
  return res;
}

beforeEach(() => {
  resetPropsCache();
  process.env.SPORTS_ODDS_API_KEY = "test-key";
  Date.now = originalDateNow;
  globalThis.setTimeout = originalSetTimeout;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  globalThis.setTimeout = originalSetTimeout;
  resetPropsCache();

  if (originalApiKey === undefined) {
    delete process.env.SPORTS_ODDS_API_KEY;
  } else {
    process.env.SPORTS_ODDS_API_KEY = originalApiKey;
  }
});

test("caches identical props requests for 60 seconds", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ success: true, data: [] });
  };

  const first = await invoke();
  const second = await invoke();

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.cache.status, "MISS");
  assert.equal(first.getHeader("x-props-cache"), "MISS");

  assert.equal(second.statusCode, 200);
  assert.equal(second.body.cache.status, "HIT");
  assert.equal(second.getHeader("x-props-cache"), "HIT");
  assert.equal(calls, 1);
});

test("canonicalizes bookmaker order and duplicates into one cache key", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ success: true, data: [] });
  };

  const first = await invoke({ books: "fanduel,draftkings,fanduel" });
  const second = await invoke({ books: "draftkings,fanduel" });

  assert.equal(first.body.cache.status, "MISS");
  assert.equal(second.body.cache.status, "HIT");
  assert.deepEqual(second.body.books, ["draftkings", "fanduel"]);
  assert.equal(calls, 1);
});

test("coalesces concurrent identical requests into one upstream fetch", async () => {
  let calls = 0;
  let releaseFetch;

  globalThis.fetch = () => {
    calls += 1;
    return new Promise((resolve) => {
      releaseFetch = () => resolve(jsonResponse({ success: true, data: [] }));
    });
  };

  const firstPromise = invoke();
  const secondPromise = invoke();

  await Promise.resolve();
  assert.equal(calls, 1);

  releaseFetch();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(first.body.cache.status, "MISS");
  assert.equal(second.body.cache.status, "COALESCED");
  assert.equal(calls, 1);
});

test("serves a recent stale response when upstream returns 429", async () => {
  let now = 1_000;
  Date.now = () => now;

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({ success: true, data: [] });
    }
    return jsonResponse(
      { success: false, message: "rate limited" },
      429,
      { "retry-after": "60" }
    );
  };

  const seeded = await invoke();
  assert.equal(seeded.body.cache.status, "MISS");

  now += 61_000;
  const stale = await invoke();

  assert.equal(stale.statusCode, 200);
  assert.equal(stale.body.cache.status, "STALE");
  assert.equal(stale.body.servedStale, true);
  assert.equal(stale.body.upstreamError.status, 429);
  assert.equal(stale.body.upstreamError.retryAfterSeconds, 60);
  assert.equal(stale.getHeader("x-props-cache"), "STALE");
  assert.equal(calls, 2);
});

test("passes through 429 and Retry-After when no stale cache exists", async () => {
  globalThis.fetch = async () =>
    jsonResponse(
      { success: false, message: "rate limited" },
      429,
      { "retry-after": "60" }
    );

  const response = await invoke();

  assert.equal(response.statusCode, 429);
  assert.equal(response.body.retryAfterSeconds, 60);
  assert.equal(response.body.cache.status, "MISS");
  assert.equal(response.getHeader("retry-after"), "60");
  assert.equal(response.getHeader("cache-control"), "no-store");
});

test("retries one transient 5xx response and succeeds", async () => {
  globalThis.setTimeout = (fn) => {
    fn();
    return 0;
  };

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({ message: "temporary provider failure" }, 503);
    }
    return jsonResponse({ success: true, data: [] });
  };

  const response = await invoke();

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.cache.status, "MISS");
  assert.equal(calls, 2);
});

test("rejects unsupported methods without calling the provider", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ success: true, data: [] });
  };

  const response = await invoke({}, "POST");

  assert.equal(response.statusCode, 405);
  assert.equal(response.body.error, "GET only");
  assert.equal(response.getHeader("allow"), "GET");
  assert.equal(calls, 0);
});
