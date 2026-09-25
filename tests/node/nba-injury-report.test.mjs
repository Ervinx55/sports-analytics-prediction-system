import test from "node:test";
import assert from "node:assert/strict";

import {
  candidateReportUrls,
  parseOfficialInjuryText,
  resolveOfficialAvailability
} from "../../sharp-service/lib/nba-injury-report.js";

const sample = [
  "Injury Report: 02/19/26 03:30 PM",
  "Page 1 of 2",
  "Game Date Game Time Matchup Team Player Name Current Status Reason",
  "02/19/2026 07:00 (ET) ATL@PHI Atlanta Hawks Dennis, RayJ Out G League - Two-Way",
  "Philadelphia 76ers Oubre Jr., Kelly Available Injury/Illness - Left Knee; Injury Recovery",
  "07:30 (ET) DET@NYK Detroit Pistons Duren, Jalen Out League Suspension",
  "New York Knicks Anunoby, OG Probable Injury/Illness - Right Toe; Toenail Avulsion",
  "10:00 (ET) BOS@GSW Boston Celtics Tatum, Jayson Out Injury/Illness - Right Achilles; Repair",
  "Golden State Warriors Curry, Stephen Questionable Injury/Illness - Right Knee; Soreness",
  "02/20/2026 07:00 (ET) CLE@CHA Cleveland Cavaliers NOT YET SUBMITTED",
  "Charlotte Hornets NOT YET SUBMITTED"
].join("\n");

test("NBA official injury parser extracts statuses and teams", () => {
  const report = parseOfficialInjuryText(sample, {
    sourceUrl: "https://example.test/report.pdf"
  });

  assert.equal(report.parsed, true);
  assert.equal(report.entryCount, 6);
  assert.equal(
    report.reportTimestamp,
    "2026-02-19T20:30:00.000Z"
  );
  assert.equal(
    report.entries.find(
      (row) => row.playerName === "Jayson Tatum"
    ).status,
    "Out"
  );
  assert.equal(
    report.entries.find(
      (row) => row.playerName === "Kelly Oubre Jr."
    ).team,
    "Philadelphia 76ers"
  );
  assert.ok(
    report.unsubmittedTeams.includes("Cleveland Cavaliers")
  );
  assert.ok(
    report.unsubmittedTeams.includes("Charlotte Hornets")
  );
});

test("NBA official injury resolution hard-blocks OUT", () => {
  const report = parseOfficialInjuryText(sample);
  const resolved = resolveOfficialAvailability(report, {
    playerName: "Jayson Tatum",
    teamName: "Boston Celtics",
    now: new Date("2026-02-19T21:00:00Z")
  });

  assert.equal(resolved.officialStatus, "OUT");
  assert.equal(resolved.availabilityBlocked, true);
  assert.equal(resolved.resolvedForPlay, false);
});

test("NBA official injury resolution clears fresh AVAILABLE or PROBABLE", () => {
  const report = parseOfficialInjuryText(sample);
  const probable = resolveOfficialAvailability(report, {
    playerName: "OG Anunoby",
    teamName: "New York Knicks",
    now: new Date("2026-02-19T21:00:00Z")
  });
  const available = resolveOfficialAvailability(report, {
    playerName: "Kelly Oubre Jr.",
    teamName: "Philadelphia 76ers",
    now: new Date("2026-02-19T21:00:00Z")
  });

  assert.equal(probable.officialStatus, "PROBABLE");
  assert.equal(probable.resolvedForPlay, true);
  assert.equal(available.officialStatus, "AVAILABLE");
  assert.equal(available.resolvedForPlay, true);
});

test("NBA official injury resolution leaves QUESTIONABLE unresolved", () => {
  const report = parseOfficialInjuryText(sample);
  const resolved = resolveOfficialAvailability(report, {
    playerName: "Stephen Curry",
    teamName: "Golden State Warriors",
    now: new Date("2026-02-19T21:00:00Z")
  });

  assert.equal(resolved.officialStatus, "QUESTIONABLE");
  assert.equal(resolved.availabilityBlocked, false);
  assert.equal(resolved.resolvedForPlay, false);
});

test("NBA fresh submitted report can resolve a player not listed", () => {
  const report = parseOfficialInjuryText(sample);
  const resolved = resolveOfficialAvailability(report, {
    playerName: "Tyrese Maxey",
    teamName: "Philadelphia 76ers",
    now: new Date("2026-02-19T21:00:00Z")
  });

  assert.equal(resolved.officialStatus, "NOT_LISTED");
  assert.equal(resolved.resolvedForPlay, true);
  assert.equal(resolved.availabilityBlocked, false);
});

test("NBA team not yet submitted never clears availability", () => {
  const report = parseOfficialInjuryText(sample);
  const resolved = resolveOfficialAvailability(report, {
    playerName: "Donovan Mitchell",
    teamName: "Cleveland Cavaliers",
    now: new Date("2026-02-19T21:00:00Z")
  });

  assert.equal(resolved.officialStatus, "NOT_YET_SUBMITTED");
  assert.equal(resolved.resolvedForPlay, false);
});

test("NBA report URL discovery candidates use official CDN naming", () => {
  const urls = candidateReportUrls(
    new Date("2026-02-19T20:45:00Z"),
    { lookbackHours: 1, includePreviousDay: false }
  );

  assert.ok(urls.length >= 3);
  assert.match(
    urls[0],
    /^https:\/\/ak-static\.cms\.nba\.com\/referee\/injury\/Injury-Report_2026-02-19_03_30PM\.pdf$/
  );
});
