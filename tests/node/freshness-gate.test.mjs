import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const market = readFileSync(
  "supabase/functions/market-card/index.ts",
  "utf8"
);
const props = readFileSync(
  "supabase/functions/player-prop-card/index.ts",
  "utf8"
);

for (const [name, source] of [
  ["team market", market],
  ["player prop", props],
]) {
  test(name + " freshness gate can change production decisions", () => {
    assert.match(source, /function applyFreshnessGate/);
    assert.match(source, /DOWNGRADE_PENDING/);
    assert.match(source, /PASS_STALE/);
    assert.match(source, /freshness\.score < 65/);
    assert.match(source, /freshness\.score < 80/);
    assert.match(source, /freshness\.hardStale/);
    assert.match(source, /affectsDecision: true/);
  });
}

test("team freshness includes market, sharp, lineup, and weather ages", () => {
  for (const component of ["market", "sharp", "lineup", "weather"]) {
    assert.match(market, new RegExp(`"${component}"`));
  }
});

test("prop freshness includes prop market, lineup role, and weather ages", () => {
  for (const component of ["prop_market", "lineup_role", "weather"]) {
    assert.match(props, new RegExp(`"${component}"`));
  }
});
