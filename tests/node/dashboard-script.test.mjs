import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("sharp-service/dashboard.html", "utf8");

test("dashboard inline script parses", () => {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "dashboard script block must exist");
  assert.doesNotThrow(() => new Function(match[1]));
});

test("provider health observability is wired into the dashboard", () => {
  for (const id of [
    "providerHealthBadge",
    "phUpstream",
    "ph429",
    "phShared",
    "phStale",
    "phCache",
    "phObjects",
    "providerHealthDetail",
    "providerIncidentList",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  assert.match(
    html,
    /renderProviderHealth\([\s\S]*data\.providerHealth\|\|\{\}[\s\S]*data\.providerUsage\|\|null[\s\S]*\)/
  );
});
