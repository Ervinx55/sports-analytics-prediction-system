import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldFallbackFromPrimary
} from "../../sharp-service/api/board.js";

function row({ ok = true, events = [{}], cacheStatus = "MISS" } = {}) {
  return {
    ok,
    events,
    cache: {
      status: cacheStatus,
      ageSeconds: cacheStatus === "STALE" ? 240 : 10
    }
  };
}

test("failed or empty primary odds trigger provider fallback", () => {
  assert.equal(
    shouldFallbackFromPrimary(row({ ok: false }), true),
    true
  );
  assert.equal(
    shouldFallbackFromPrimary(row({ events: [] }), true),
    true
  );
});

test("fresh primary odds remain preferred", () => {
  assert.equal(
    shouldFallbackFromPrimary(
      row({ cacheStatus: "HIT" }),
      true
    ),
    false
  );
});

test("stale primary odds try SharpAPI when configured", () => {
  assert.equal(
    shouldFallbackFromPrimary(
      row({ cacheStatus: "STALE" }),
      true
    ),
    true
  );
});

test("stale primary odds are retained when no free secondary is configured", () => {
  assert.equal(
    shouldFallbackFromPrimary(
      row({ cacheStatus: "STALE" }),
      false
    ),
    false
  );
});
