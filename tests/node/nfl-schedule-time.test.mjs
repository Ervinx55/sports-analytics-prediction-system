import test from "node:test";
import assert from "node:assert/strict";

import {
  easternLocalToUtcIso,
  scheduleKickoffIso
} from "../../sharp-service/lib/nfl-schedule-time.js";

test("NFL kickoff conversion respects Eastern daylight time", () => {
  assert.equal(
    easternLocalToUtcIso("2024-09-08", "13:00"),
    "2024-09-08T17:00:00.000Z"
  );
});

test("NFL kickoff conversion respects Eastern standard time", () => {
  assert.equal(
    easternLocalToUtcIso("2024-12-08", "20:20"),
    "2024-12-09T01:20:00.000Z"
  );
});

test("NFL kickoff conversion uses conservative day-start fallback", () => {
  assert.deepEqual(
    scheduleKickoffIso({
      gameday: "2024-09-08",
      gametime: ""
    }),
    {
      startsAt: "2024-09-08T00:00:00.000Z",
      source: "gameday-start",
      conservativeFallback: true
    }
  );
});
