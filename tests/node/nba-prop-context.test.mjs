import test from "node:test";
import assert from "node:assert/strict";

import {
  applyNbaPropGameContext,
  buildNbaPropGameContext,
  contextSignal,
  impliedTeamTotals,
  matchBoardEvent
} from "../../sharp-service/lib/nba-prop-context.js";

function team(id, abbreviation, fullName) {
  return {
    id,
    abbreviation,
    full_name: fullName,
    name: fullName.split(" ").at(-1)
  };
}

const BOS = team(2, "BOS", "Boston Celtics");
const LAL = team(14, "LAL", "Los Angeles Lakers");
const NYK = team(20, "NYK", "New York Knicks");
const PHX = team(24, "PHX", "Phoenix Suns");

function game({
  id,
  date,
  home,
  away,
  homeScore,
  awayScore
}) {
  return {
    id,
    date,
    datetime: `${date}T23:30:00Z`,
    season: 2026,
    status: "Final",
    status_state: "final",
    home_team: home,
    visitor_team: away,
    home_team_score: homeScore,
    visitor_team_score: awayScore
  };
}

const games = [
  game({ id: 1, date: "2026-10-01", home: BOS, away: NYK, homeScore: 119, awayScore: 108 }),
  game({ id: 2, date: "2026-10-03", home: LAL, away: PHX, homeScore: 116, awayScore: 110 }),
  game({ id: 3, date: "2026-10-05", home: NYK, away: BOS, homeScore: 111, awayScore: 121 }),
  game({ id: 4, date: "2026-10-07", home: PHX, away: LAL, homeScore: 109, awayScore: 118 }),
  game({ id: 5, date: "2026-10-09", home: BOS, away: PHX, homeScore: 123, awayScore: 112 }),
  game({ id: 6, date: "2026-10-11", home: LAL, away: NYK, homeScore: 120, awayScore: 114 }),
  game({ id: 7, date: "2026-10-13", home: NYK, away: BOS, homeScore: 105, awayScore: 117 }),
  game({ id: 8, date: "2026-10-15", home: PHX, away: LAL, homeScore: 108, awayScore: 115 })
];

const propEvent = {
  eventID: "sharpapi:nba-lal-bos",
  startsAt: "2026-10-20T23:30:00Z",
  matchup: {
    away: { name: "Los Angeles Lakers" },
    home: { name: "Boston Celtics" }
  }
};

const boardEvent = {
  eventID: "theodds:event-99",
  league: "NBA",
  startsAt: "2026-10-20T23:30:00Z",
  matchup: {
    away: { name: "Los Angeles Lakers" },
    home: { name: "Boston Celtics" }
  },
  markets: {
    spread: {
      home: {
        consensus: { line: -5 },
        books: {}
      },
      away: {
        consensus: { line: 5 },
        books: {}
      }
    },
    total: {
      over: {
        consensus: { line: 230 },
        books: {}
      },
      under: {
        consensus: { line: 230 },
        books: {}
      }
    }
  }
};

test("NBA context matches games across provider event IDs", () => {
  const matched = matchBoardEvent(
    propEvent,
    [
      {
        ...boardEvent,
        eventID: "different-provider-id"
      }
    ]
  );

  assert.ok(matched);
  assert.equal(
    matched.eventID,
    "different-provider-id"
  );
});

test("NBA implied team totals use total and home spread", () => {
  const implied =
    impliedTeamTotals(boardEvent);

  assert.equal(implied.total, 230);
  assert.equal(implied.homeSpread, -5);
  assert.equal(implied.home, 117.5);
  assert.equal(implied.away, 112.5);
});

test("NBA game context combines market, opponent, and schedule inputs", () => {
  const context =
    buildNbaPropGameContext({
      propEvent,
      boardEvent,
      games,
      season: 2026,
      playerTeamName:
        "Boston Celtics"
    });

  assert.equal(context.available, true);
  assert.equal(context.playerTeam, "BOS");
  assert.equal(context.opponentTeam, "LAL");
  assert.equal(context.side, "home");
  assert.equal(context.boardMatched, true);
  assert.equal(
    context.impliedTeamTotal,
    117.5
  );
  assert.ok(
    Number.isFinite(
      context.signals.opponentDefense
    )
  );
  assert.ok(context.featureCount >= 3);
});

test("NBA context shadow blend is tightly capped", () => {
  const projection = {
    available: true,
    mean: 30,
    sd: 6,
    historyGames: 8
  };
  const context = {
    available: true,
    signals: {
      teamTotal: 10,
      opponentDefense: 10,
      scoringEnvironment: 10,
      fatigue: 0
    }
  };

  assert.equal(
    contextSignal("points", context),
    0.9
  );

  const adjusted =
    applyNbaPropGameContext(
      projection,
      "points",
      context
    );

  assert.equal(adjusted.rawMean, 30);
  assert.equal(
    adjusted.contextShadowWeight,
    0.25
  );
  assert.ok(
    adjusted.contextChallengerMean <=
      31.5
  );
  assert.ok(
    adjusted.mean <=
      30.375
  );
  assert.ok(adjusted.mean > 30);
});

test("NBA context does nothing when environment is unavailable", () => {
  const projection = {
    available: true,
    mean: 30,
    sd: 6,
    historyGames: 8
  };

  const adjusted =
    applyNbaPropGameContext(
      projection,
      "points",
      {
        available: false
      }
    );

  assert.equal(adjusted.rawMean, 30);
  assert.equal(adjusted.mean, 30);
  assert.equal(
    adjusted.contextShadowWeight,
    0
  );
});
