import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import providerStatusHandler from "../../sharp-service/handlers/providerstatus.js";

const ENV_KEYS = [
  "SPORTS_ODDS_API_KEY",
  "SHARPAPI_KEY",
  "THE_ODDS_API_KEY"
];
let saved = {};

beforeEach(() => {
  saved = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]])
  );
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function mockRes() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: null,
    headers,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
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

test("provider status rejects unsupported methods", async () => {
  const res = mockRes();
  await providerStatusHandler({ method: "POST" }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.error, "GET only");
  assert.equal(res.headers.get("allow"), "GET");
});

test("provider status reports configured failover chain without exposing secrets", async () => {
  process.env.SHARPAPI_KEY = "secret-sharp";
  process.env.THE_ODDS_API_KEY = "secret-odds";

  const res = mockRes();
  await providerStatusHandler({ method: "GET" }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.providerChain, [
    "SportsGameOdds",
    "SharpAPI",
    "The Odds API",
    "Schedule Only"
  ]);
  assert.deepEqual(res.body.configured, {
    sportsGameOdds: false,
    sharpApi: true,
    theOddsApi: true
  });
  assert.equal(
    res.body.providers.sportsGameOdds.status,
    "NOT_CONFIGURED"
  );
  assert.equal(res.body.providers.sharpApi.status, "READY");
  assert.equal(
    res.body.providers.theOddsApi.configured,
    true
  );
  assert.notEqual(
    res.body.providers.theOddsApi.status,
    "NOT_CONFIGURED"
  );
  assert.equal(res.body.providers.theOddsApi.status, "AWAITING_FIRST_RESPONSE");
  assert.equal(res.body.oddsProviderReady, true);

  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes("secret-sharp"), false);
  assert.equal(serialized.includes("secret-odds"), false);
});
