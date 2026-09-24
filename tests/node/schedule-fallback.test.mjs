import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchScheduleFallback,
  normalizeMlbSchedule
} from "../../sharp-service/lib/schedule-fallback.js";

const NOW = Date.parse("2026-09-24T18:00:00Z");

test("MLB schedule fallback normalizes and bounds games", () => {
  const payload = {
    dates: [
      {
        games: [
          {
            gamePk: 2,
            gameDate: "2026-09-25T00:10:00Z",
            teams: {
              away: { team: { name: "Seattle Mariners" } },
              home: { team: { name: "Houston Astros" } }
            },
            status: { detailedState: "Scheduled" }
          },
          {
            gamePk: 1,
            gameDate: "2026-09-24T19:05:00Z",
            teams: {
              away: { team: { name: "New York Yankees" } },
              home: { team: { name: "Baltimore Orioles" } }
            },
            status: { detailedState: "Scheduled" }
          },
          {
            gamePk: 3,
            gameDate: "2026-09-22T19:05:00Z",
            teams: {
              away: { team: { name: "Old Away" } },
              home: { team: { name: "Old Home" } }
            }
          }
        ]
      }
    ]
  };

  const games = normalizeMlbSchedule(payload, {
    now: NOW,
    hours: 36
  });

  assert.equal(games.length, 2);
  assert.equal(games[0].event_id, "mlb-1");
  assert.equal(games[0].away_team, "New York Yankees");
  assert.equal(games[0].home_team, "Baltimore Orioles");
  assert.equal(games[0].schedule_only, true);
  assert.equal(games[1].event_id, "mlb-2");
});

test("MLB schedule fallback calls official schedule feed", async () => {
  let requestedUrl = null;
  const fetchImpl = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          dates: [{
            games: [{
              gamePk: 77,
              gameDate: "2026-09-24T23:10:00Z",
              teams: {
                away: { team: { name: "Away Club" } },
                home: { team: { name: "Home Club" } }
              },
              status: { detailedState: "Scheduled" }
            }]
          }]
        };
      }
    };
  };

  const result = await fetchScheduleFallback({
    sport: "MLB",
    hours: 36,
    now: NOW,
    fetchImpl
  });

  assert.equal(result.supported, true);
  assert.equal(result.source, "MLB Stats API");
  assert.equal(result.games.length, 1);
  assert.match(requestedUrl, /statsapi\.mlb\.com\/api\/v1\/schedule/);
  assert.match(requestedUrl, /sportId=1/);
  assert.match(requestedUrl, /startDate=2026-09-24/);
});

test("unsupported sports do not fabricate schedule games", async () => {
  const result = await fetchScheduleFallback({
    sport: "NFL",
    now: NOW,
    fetchImpl: async () => {
      throw new Error("should not fetch");
    }
  });

  assert.equal(result.supported, false);
  assert.deepEqual(result.games, []);
  assert.match(result.reason, /NFL/);
});
