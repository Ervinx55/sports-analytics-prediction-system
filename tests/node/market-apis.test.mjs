import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import boardHandler from "../../sharp-service/api/board.js";
import sharpHandler from "../../sharp-service/api/sharp.js";
import propsHandler from "../../sharp-service/api/props.js";
import {
  resetProviderProtectionForTests
} from "../../sharp-service/lib/provider-protection.js";

const originalFetch = globalThis.fetch;
const originalEnv = {
  SPORTS_ODDS_API_KEY: process.env.SPORTS_ODDS_API_KEY,
  SHARP_MONITOR_TOKEN: process.env.SHARP_MONITOR_TOKEN,
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

async function invoke(handler, query = {}, method = "GET") {
  const req = { method, query, headers: {} };
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
  delete process.env.SHARP_MONITOR_TOKEN;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SPORTS_ODDS_REQUESTS_PER_MINUTE = "9";
  delete process.env.SPORTS_ODDS_CRITICAL_RESERVE;
  delete process.env.SPORTS_ODDS_NORMAL_RESERVE;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetProviderProtectionForTests();
  for (const [name, value] of Object.entries(originalEnv)) {
    restoreEnv(name, value);
  }
});

test("board reuses provider cache on identical requests", async () => {
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return jsonResponse({ success: true, data: [] });
  };

  const first = await invoke(boardHandler);
  const second = await invoke(boardHandler);

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.providerCache.status, "MISS");
  assert.equal(first.body.providerCache.layerCounts.upstream, 1);

  assert.equal(second.statusCode, 200);
  assert.equal(second.body.providerCache.status, "HIT");
  assert.equal(second.body.providerCache.layerCounts.local, 1);
  assert.equal(providerCalls, 1);
});

test("board normalizes duplicate leagues and bookmaker order", async () => {
  let seenUrl = "";
  globalThis.fetch = async (url) => {
    seenUrl = String(url);
    return jsonResponse({ success: true, data: [] });
  };

  const response = await invoke(boardHandler, {
    leagues: "mlb,MLB",
    books: "fanduel,draftkings,fanduel"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.requestedLeagues, ["MLB"]);
  assert.deepEqual(response.body.books, ["draftkings", "fanduel"]);
  assert.match(seenUrl, /bookmakerID=draftkings%2Cfanduel/);
});

test("sharp limits cold upstream concurrency to two leagues", async () => {
  let active = 0;
  let maxActive = 0;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return jsonResponse({ success: true, data: [] });
  };

  const response = await invoke(sharpHandler, {
    leagues: "MLB,NFL,NBA,NHL"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(calls, 4);
  assert.ok(maxActive <= 2, `max concurrency was ${maxActive}`);
  assert.deepEqual(response.body.availableLeagues, [
    "MLB",
    "NFL",
    "NBA",
    "NHL"
  ]);
});

test("sharp circuit breaker stops a 429 from cascading across leagues", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(
      { success: false, message: "rate limited" },
      429,
      { "retry-after": "60" }
    );
  };

  const response = await invoke(sharpHandler, {
    leagues: "MLB,NFL,NBA,NHL"
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.providerCache.circuitOpen, true);
  assert.equal(response.getHeader("x-provider-circuit"), "OPEN");
  assert.equal(calls, 2);
  assert.equal(response.body.unavailableLeagues.length, 4);
});

test("sharp blocks unsupported methods before calling provider", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ success: true, data: [] });
  };

  const response = await invoke(sharpHandler, {}, "POST");

  assert.equal(response.statusCode, 405);
  assert.equal(response.body.error, "GET only");
  assert.equal(calls, 0);
});


test("background sharp traffic preserves critical request capacity", async () => {
  process.env.SPORTS_ODDS_REQUESTS_PER_MINUTE = "4";
  process.env.SPORTS_ODDS_CRITICAL_RESERVE = "1";
  process.env.SPORTS_ODDS_NORMAL_RESERVE = "1";

  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return jsonResponse({ success: true, data: [] });
  };

  const bulk = await invoke(sharpHandler, {
    leagues: "MLB,NFL,NBA,NHL"
  });

  assert.equal(bulk.statusCode, 200);
  assert.equal(providerCalls, 2);
  assert.equal(bulk.body.availableLeagues.length, 2);
  assert.equal(bulk.body.unavailableLeagues.length, 2);
  assert.ok(
    bulk.body.unavailableLeagues.every(
      (row) => row.budgetBlocked === true
    )
  );

  const props = await invoke(propsHandler, { limit: "99" });

  assert.equal(props.statusCode, 200);
  assert.equal(props.body.requestBudget.priority, "critical");
  assert.equal(props.body.requestBudget.claimed, true);
  assert.equal(providerCalls, 3);
});

test("live board traffic is promoted to critical priority", async () => {
  process.env.SPORTS_ODDS_REQUESTS_PER_MINUTE = "2";
  process.env.SPORTS_ODDS_CRITICAL_RESERVE = "1";
  process.env.SPORTS_ODDS_NORMAL_RESERVE = "0";

  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return jsonResponse({ success: true, data: [] });
  };

  const response = await invoke(boardHandler, {
    leagues: "MLB",
    live: "true"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.providerPriority, "critical");
  assert.equal(response.body.unavailableLeagues.length, 0);
  assert.equal(providerCalls, 1);
});
