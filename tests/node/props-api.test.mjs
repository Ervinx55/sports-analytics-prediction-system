import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import handler from "../../sharp-service/api/props.js";
import {
  resetProviderProtectionForTests
} from "../../sharp-service/lib/provider-protection.js";

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
const originalSetTimeout = globalThis.setTimeout;
const originalEnv = {
  SPORTS_ODDS_API_KEY: process.env.SPORTS_ODDS_API_KEY,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SPORTS_ODDS_REQUESTS_PER_MINUTE:
    process.env.SPORTS_ODDS_REQUESTS_PER_MINUTE,
  SPORTS_ODDS_CRITICAL_RESERVE:
    process.env.SPORTS_ODDS_CRITICAL_RESERVE,
  SPORTS_ODDS_NORMAL_RESERVE:
    process.env.SPORTS_ODDS_NORMAL_RESERVE
};

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

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  resetProviderProtectionForTests();
  process.env.SPORTS_ODDS_API_KEY = "test-key";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SPORTS_ODDS_REQUESTS_PER_MINUTE = "9";
  delete process.env.SPORTS_ODDS_CRITICAL_RESERVE;
  delete process.env.SPORTS_ODDS_NORMAL_RESERVE;
  Date.now = originalDateNow;
  globalThis.setTimeout = originalSetTimeout;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  globalThis.setTimeout = originalSetTimeout;
  resetProviderProtectionForTests();

  for (const [name, value] of Object.entries(originalEnv)) {
    restoreEnv(name, value);
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
  assert.equal(first.body.cache.layer, "upstream");
  assert.equal(first.getHeader("x-props-cache"), "MISS");

  assert.equal(second.statusCode, 200);
  assert.equal(second.body.cache.status, "HIT");
  assert.equal(second.body.cache.layer, "local");
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
  let markFetchStarted;
  const fetchStarted = new Promise((resolve) => {
    markFetchStarted = resolve;
  });

  globalThis.fetch = () => {
    calls += 1;
    markFetchStarted();
    return new Promise((resolve) => {
      releaseFetch = () => resolve(jsonResponse({ success: true, data: [] }));
    });
  };

  const firstPromise = invoke();
  const secondPromise = invoke();

  await fetchStarted;
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

test("opens the local circuit after a 429 and avoids another provider request", async () => {
  let now = 1_000;
  Date.now = () => now;

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(
      { success: false, message: "rate limited" },
      429,
      { "retry-after": "60" }
    );
  };

  const first = await invoke();
  assert.equal(first.statusCode, 429);

  now += 1_000;
  const second = await invoke();

  assert.equal(second.statusCode, 429);
  assert.equal(second.body.circuitOpen, true);
  assert.equal(calls, 1);
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

test("uses shared Supabase cache without calling SportsGameOdds", async () => {
  process.env.SUPABASE_URL = "https://cache.test";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";

  const fetchedAt = new Date().toISOString();
  let providerCalls = 0;
  let sharedCalls = 0;

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.startsWith("https://cache.test/rest/v1/provider_response_cache")) {
      sharedCalls += 1;
      return jsonResponse([
        {
          payload: { success: true, data: [] },
          status_code: 200,
          fetched_at: fetchedAt,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          stale_until: new Date(Date.now() + 300_000).toISOString(),
          last_error: null
        }
      ]);
    }
    if (text.startsWith("https://cache.test/rest/v1/provider_circuit_state")) {
      sharedCalls += 1;
      return jsonResponse([]);
    }
    if (text.startsWith("https://cache.test/rest/v1/provider_request_events")) {
      sharedCalls += 1;
      return new Response("", { status: 201 });
    }
    if (text.startsWith("https://api.sportsgameodds.com")) {
      providerCalls += 1;
      return jsonResponse({ success: true, data: [] });
    }
    throw new Error(`Unexpected URL: ${text}`);
  };

  const response = await invoke();

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.cache.status, "HIT");
  assert.equal(response.body.cache.layer, "shared");
  assert.equal(response.body.cache.sharedEnabled, true);
  assert.equal(response.getHeader("x-provider-cache-layer"), "shared");
  assert.equal(providerCalls, 0);
  assert.equal(sharedCalls, 3);
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


test("adaptive 429 backoff doubles after a failed half-open probe", async () => {
  let now = 1_000;
  Date.now = () => now;

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(
      { success: false, message: "rate limited" },
      429,
      { "retry-after": "60" }
    );
  };

  const first = await invoke();
  assert.equal(first.statusCode, 429);

  now += 61_000;
  const failedProbe = await invoke({ limit: "99" });
  assert.equal(failedProbe.statusCode, 429);

  const blocked = await invoke({ limit: "98" });
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.circuitOpen, true);
  assert.ok(blocked.body.retryAfterSeconds >= 119);
  assert.equal(calls, 2);
});

test("half-open recovery allows only one local provider probe", async () => {
  let now = 1_000;
  Date.now = () => now;

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(
      { success: false, message: "rate limited" },
      429,
      { "retry-after": "60" }
    );
  };

  const first = await invoke();
  assert.equal(first.statusCode, 429);

  now += 61_000;

  let releaseProbe;
  globalThis.fetch = () => {
    calls += 1;
    return new Promise((resolve) => {
      releaseProbe = () =>
        resolve(jsonResponse({ success: true, data: [] }));
    });
  };

  const probe = invoke({ limit: "97" });
  await Promise.resolve();

  const blocked = await invoke({ limit: "96" });
  assert.equal(blocked.statusCode, 503);
  assert.equal(blocked.body.circuitOpen, true);
  assert.equal(blocked.body.retryAfterSeconds, 2);

  releaseProbe();
  const recovered = await probe;

  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.body.recoveryState, "RECOVERED");
  assert.equal(calls, 2);
});


test("auto-discovers provider request capacity and caches usage lookup", async () => {
  delete process.env.SPORTS_ODDS_REQUESTS_PER_MINUTE;

  let usageCalls = 0;
  let providerCalls = 0;

  globalThis.fetch = async (url) => {
    const text = String(url);

    if (text.includes("/v2/account/usage")) {
      usageCalls += 1;
      return jsonResponse({
        success: true,
        data: {
          tier: "rookie",
          rateLimits: {
            "per-minute": {
              "max-requests": 50,
              "current-requests": 4
            }
          }
        }
      });
    }

    if (text.startsWith("https://api.sportsgameodds.com/v2/events")) {
      providerCalls += 1;
      return jsonResponse({ success: true, data: [] });
    }

    throw new Error("Unexpected URL: " + text);
  };

  const first = await invoke({ limit: "91" });
  const second = await invoke({ limit: "92" });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.body.requestBudget.limitSource, "provider_usage");
  assert.equal(first.body.requestBudget.capacity, 45);
  assert.equal(first.body.requestBudget.providerRateLimit.maxRequests, 50);
  assert.equal(first.body.requestBudget.providerRateLimit.currentRequests, 4);
  assert.equal(usageCalls, 1);
  assert.equal(providerCalls, 2);
});
