import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  adaptiveRefreshPolicy,
  nearestCandidateStart
} from "../../sharp-service/lib/adaptive-refresh.js";

const NOW = Date.parse("2026-09-24T12:00:00Z");

test("adaptive refresh accelerates live and near-start markets", () => {
  const live = adaptiveRefreshPolicy({
    live: true,
    priority: "critical",
    now: NOW
  });
  assert.equal(live.suggestedSeconds, 15);

  const near = adaptiveRefreshPolicy({
    nearestStartAt: new Date(NOW + 45 * 60 * 1000).toISOString(),
    priority: "critical",
    now: NOW
  });
  assert.equal(near.mode, "NEAR_START");
  assert.equal(near.suggestedSeconds, 30);
});

test("adaptive refresh slows distant and background work", () => {
  const distant = adaptiveRefreshPolicy({
    nearestStartAt: new Date(NOW + 30 * 60 * 60 * 1000).toISOString(),
    priority: "normal",
    now: NOW
  });
  assert.equal(distant.suggestedSeconds, 300);

  const background = adaptiveRefreshPolicy({
    priority: "background",
    now: NOW
  });
  assert.equal(background.suggestedSeconds, 300);
});

test("provider recovery and object pressure slow refresh safely", () => {
  const recovering = adaptiveRefreshPolicy({
    live: true,
    priority: "critical",
    recoveryState: "BACKOFF",
    objectUsagePct: 96,
    now: NOW
  });

  assert.equal(recovering.suggestedSeconds, 180);
  assert.ok(recovering.slowedBy.includes("provider recovery"));
  assert.ok(recovering.slowedBy.includes("critical object pressure"));
});

test("nearest start ignores old stale candidates", () => {
  const nearest = nearestCandidateStart([
    { starts_at: new Date(NOW - 5 * 60 * 60 * 1000).toISOString() },
    { starts_at: new Date(NOW + 70 * 60 * 1000).toISOString() },
    { starts_at: new Date(NOW + 20 * 60 * 1000).toISOString() }
  ], NOW);

  assert.equal(
    nearest,
    new Date(NOW + 20 * 60 * 1000).toISOString()
  );
});

test("dashboard self-schedules and no longer uses fixed 60-second interval", () => {
  const html = readFileSync("sharp-service/dashboard.html", "utf8");
  assert.match(html, /id=["']refreshCadence["']/);
  assert.match(html, /scheduleNextRefresh\(DATA\?\.refreshPolicy\)/);
  assert.doesNotMatch(html, /setInterval\(load,60000\)/);
});
