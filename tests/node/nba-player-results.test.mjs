import test from "node:test";
import assert from "node:assert/strict";

import {
  actualStat,
  findScheduleGame,
  findBoxscorePlayer,
  settleObservation,
  teamCode
} from "../../supabase/functions/grade-nba-player-props/nba-player-results.js";

const schedule = {
  leagueSchedule: {
    gameDates: [
      {
        gameDate: "2026-10-20",
        games: [
          {
            gameId: "0022600001",
            gameDateTimeUTC: "2026-10-20T23:30:00Z",
            awayTeam: { teamTricode: "LAL" },
            homeTeam: { teamTricode: "BOS" }
          }
        ]
      }
    ]
  }
};

const boxscore = {
  game: {
    gameId: "0022600001",
    gameStatus: 3,
    gameStatusText: "Final",
    awayTeam: {
      players: [
        {
          personId: 2544,
          name: "LeBron James",
          firstName: "LeBron",
          familyName: "James",
          played: true,
          statistics: {
            minutes: "PT35M12.00S",
            points: 26,
            reboundsTotal: 8,
            assists: 9,
            threePointersMade: 2,
            blocks: 1,
            steals: 1,
            turnovers: 4
          }
        },
        {
          personId: 999,
          name: "Bench Player",
          firstName: "Bench",
          familyName: "Player",
          played: false,
          statistics: {
            minutes: "PT0M00.00S",
            points: 0,
            reboundsTotal: 0,
            assists: 0,
            threePointersMade: 0,
            blocks: 0,
            steals: 0,
            turnovers: 0
          }
        }
      ]
    },
    homeTeam: {
      players: []
    }
  }
};

function observation(overrides = {}) {
  return {
    starts_at: "2026-10-20T23:30:00Z",
    away_team: "Los Angeles Lakers",
    home_team: "Boston Celtics",
    player_name: "LeBron James",
    player_id: "LEBRON_JAMES_2544_NBA",
    stat_id: "points",
    side: "over",
    line: 25.5,
    ...overrides
  };
}

test("NBA result helper normalizes team names to official tricodes", () => {
  assert.equal(teamCode("Boston Celtics"), "BOS");
  assert.equal(teamCode("Los Angeles Lakers"), "LAL");
  assert.equal(teamCode("LA Clippers"), "LAC");
});

test("NBA result helper resolves schedule game by teams and start time", () => {
  const game = findScheduleGame(schedule, observation());
  assert.ok(game);
  assert.equal(game.gameId, "0022600001");
});

test("NBA result helper matches player by normalized name", () => {
  const player = findBoxscorePlayer(boxscore, observation());
  assert.equal(player.personId, 2544);
});

test("NBA result helper computes direct and combo props", () => {
  const player = findBoxscorePlayer(boxscore, observation());
  assert.equal(actualStat(player, "points"), 26);
  assert.equal(actualStat(player, "rebounds"), 8);
  assert.equal(actualStat(player, "assists"), 9);
  assert.equal(actualStat(player, "threes_made"), 2);
  assert.equal(actualStat(player, "points_rebounds_assists"), 43);
  assert.equal(actualStat(player, "points_rebounds"), 34);
  assert.equal(actualStat(player, "points_assists"), 35);
  assert.equal(actualStat(player, "rebounds_assists"), 17);
  assert.equal(actualStat(player, "blocks_steals"), 2);
});

test("NBA settlement grades win loss and push correctly", () => {
  const win = settleObservation(observation(), boxscore);
  assert.equal(win.outcome, "W");
  assert.equal(win.won, true);

  const loss = settleObservation(
    observation({ side: "under", line: 25.5 }),
    boxscore
  );
  assert.equal(loss.outcome, "L");
  assert.equal(loss.won, false);

  const push = settleObservation(
    observation({ side: "over", line: 26 }),
    boxscore
  );
  assert.equal(push.outcome, "PUSH");
  assert.equal(push.pushed, true);
});

test("NBA DNP settles as VOID instead of an under win", () => {
  const settled = settleObservation(
    observation({
      player_name: "Bench Player",
      player_id: "BENCH_PLAYER_999_NBA",
      side: "under",
      line: 4.5
    }),
    boxscore
  );

  assert.equal(settled.outcome, "VOID");
  assert.equal(settled.actualValue, null);
  assert.equal(settled.won, null);
  assert.equal(settled.pushed, false);
});

test("NBA settlement waits until official game status is final", () => {
  const live = structuredClone(boxscore);
  live.game.gameStatus = 2;
  live.game.gameStatusText = "Q4";

  const settled = settleObservation(observation(), live);
  assert.equal(settled.ready, false);
  assert.match(settled.reason, /not final/i);
});
