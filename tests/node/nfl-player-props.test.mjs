import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import nflPropsHandler from "../../sharp-service/api/nflprops.js";
import {
  gradePropMarket,
  independentProbability,
  pointInTimeRows,
  projectPlayerOpportunity
} from "../../sharp-service/lib/nfl-player-props.js";

afterEach(() => {
  globalThis.__edgeLabNflPlayerCache = new Map();
});

const schedule = [
  {
    game_id: "2026_01_MIN_GB",
    season: "2026",
    week: "1",
    gameday: "2026-09-10",
    away_team: "MIN",
    home_team: "GB"
  },
  {
    game_id: "2026_02_GB_CHI",
    season: "2026",
    week: "2",
    gameday: "2026-09-17",
    away_team: "GB",
    home_team: "CHI"
  },
  {
    game_id: "2026_03_DET_GB",
    season: "2026",
    week: "3",
    gameday: "2026-09-24",
    away_team: "DET",
    home_team: "GB"
  },
  {
    game_id: "2026_04_GB_DAL",
    season: "2026",
    week: "4",
    gameday: "2026-10-01",
    away_team: "GB",
    home_team: "DAL"
  },
  {
    game_id: "2026_05_ATL_GB",
    season: "2026",
    week: "5",
    gameday: "2026-10-08",
    away_team: "ATL",
    home_team: "GB"
  }
];

function playerRow({
  game,
  name,
  id,
  position,
  attempts = 0,
  passingYards = 0,
  passingTds = 0,
  carries = 0,
  rushingYards = 0,
  targets = 0,
  receptions = 0,
  receivingYards = 0
}) {
  return {
    season: "2026",
    week: String(game),
    game_id: schedule[game - 1].game_id,
    recent_team: "GB",
    player_id: id,
    player_display_name: name,
    position,
    attempts: String(attempts),
    passing_yards: String(passingYards),
    passing_tds: String(passingTds),
    carries: String(carries),
    rushing_yards: String(rushingYards),
    targets: String(targets),
    receptions: String(receptions),
    receiving_yards: String(receivingYards)
  };
}

const playerStats = [
  playerRow({ game: 1, name: "Jordan Love", id: "QB1", position: "QB", attempts: 34, passingYards: 262, passingTds: 2, carries: 3, rushingYards: 12 }),
  playerRow({ game: 2, name: "Jordan Love", id: "QB1", position: "QB", attempts: 31, passingYards: 245, passingTds: 2, carries: 2, rushingYards: 8 }),
  playerRow({ game: 3, name: "Jordan Love", id: "QB1", position: "QB", attempts: 36, passingYards: 288, passingTds: 3, carries: 4, rushingYards: 18 }),
  playerRow({ game: 4, name: "Jordan Love", id: "QB1", position: "QB", attempts: 33, passingYards: 271, passingTds: 2, carries: 3, rushingYards: 11 }),

  playerRow({ game: 1, name: "Jayden Reed", id: "WR1", position: "WR", targets: 7, receptions: 5, receivingYards: 68 }),
  playerRow({ game: 2, name: "Jayden Reed", id: "WR1", position: "WR", targets: 8, receptions: 6, receivingYards: 79 }),
  playerRow({ game: 3, name: "Jayden Reed", id: "WR1", position: "WR", targets: 10, receptions: 7, receivingYards: 96 }),
  playerRow({ game: 4, name: "Jayden Reed", id: "WR1", position: "WR", targets: 11, receptions: 8, receivingYards: 104 }),

  playerRow({ game: 1, name: "Josh Jacobs", id: "RB1", position: "RB", carries: 18, rushingYards: 82, targets: 4, receptions: 3, receivingYards: 25 }),
  playerRow({ game: 2, name: "Josh Jacobs", id: "RB1", position: "RB", carries: 20, rushingYards: 91, targets: 3, receptions: 2, receivingYards: 17 }),
  playerRow({ game: 3, name: "Josh Jacobs", id: "RB1", position: "RB", carries: 22, rushingYards: 106, targets: 4, receptions: 3, receivingYards: 29 }),
  playerRow({ game: 4, name: "Josh Jacobs", id: "RB1", position: "RB", carries: 21, rushingYards: 99, targets: 5, receptions: 4, receivingYards: 36 }),

  playerRow({ game: 1, name: "Other Back", id: "RB2", position: "RB", carries: 7, rushingYards: 31 }),
  playerRow({ game: 2, name: "Other Back", id: "RB2", position: "RB", carries: 6, rushingYards: 24 }),
  playerRow({ game: 3, name: "Other Back", id: "RB2", position: "RB", carries: 6, rushingYards: 28 }),
  playerRow({ game: 4, name: "Other Back", id: "RB2", position: "RB", carries: 7, rushingYards: 30 })
];

const snapCounts = [1, 2, 3, 4].map((week, index) => ({
  season: "2026",
  week: String(week),
  team: "GB",
  pfr_player_id: `ReedJa00-${week}`,
  player: "Jayden Reed",
  position: "WR",
  offense_pct: String([72, 76, 88, 91][index])
}));

const ngs = {
  passing: [],
  rushing: [],
  receiving: [1, 2, 3, 4].map((week) => ({
    season: "2026",
    week: String(week),
    team_abbr: "GB",
    player_gsis_id: "WR1",
    player_display_name: "Jayden Reed"
  }))
};

const depthCharts = [
  {
    dt: "2026-10-08T11:00:00Z",
    team: "GB",
    player_name: "Jayden Reed",
    pos_abb: "WR",
    pos_rank: "1"
  }
];

const event = {
  eventID: "NFL_ATL_GB_2026",
  startsAt: "2026-10-08T20:15:00-04:00",
  matchup: {
    away: { name: "Atlanta Falcons", short: "ATL" },
    home: { name: "Green Bay Packers", short: "GB" }
  },
  markets: {
    spread: {
      home: { consensus: { line: -3.5 } },
      away: { consensus: { line: 3.5 } }
    },
    total: {
      over: { consensus: { line: 47.5 } },
      under: { consensus: { line: 47.5 } }
    }
  }
};

test("point-in-time guard excludes information unavailable at kickoff", () => {
  const rows = [
    playerStats[0],
    {
      ...playerStats[0],
      game_id: "2026_05_ATL_GB",
      week: "5"
    }
  ];
  const visible = pointInTimeRows(rows, {
    cutoff: event.startsAt,
    schedule,
    source: "player_stats"
  });

  assert.equal(visible.length, 1);
  assert.equal(visible[0].week, "1");
});

test("opportunity engine produces coherent WR projections", () => {
  const result = projectPlayerOpportunity({
    playerName: "Jayden Reed",
    event,
    schedule,
    season: 2026,
    playerStats,
    snapCounts,
    ngs,
    depthCharts,
    weatherContext: {
      controlledEnvironment: true,
      windMph: 0
    },
    opponentSnapshot: {
      defYppAllowed: 5.8
    }
  });

  assert.equal(result.player.team, "GB");
  assert.equal(result.player.position, "WR");
  assert.equal(result.dataQuality, "A");
  assert.equal(result.historyGames, 4);
  assert.ok(result.environment.projectedPlays > 50);
  assert.ok(result.environment.projectedPassAttempts > 20);
  assert.ok(result.projections.targets.mean > result.projections.receiving_receptions.mean);
  assert.ok(result.projections.receiving_yards.mean > result.projections.receiving_receptions.mean);
  assert.equal(result.projections.receiving_receptions.baselineMean, 6.5);
  assert.equal(result.projections.receiving_receptions.mean, 6.5);
  assert.equal(result.projections.receiving_receptions.residualWeight, 0);
  assert.equal(result.projections.receiving_yards.baselineMean, 86.75);
  assert.equal(result.projections.receiving_yards.mean, 86.75);
  assert.equal(result.projections.receiving_yards.residualWeight, 0);
  assert.ok(Number.isFinite(result.projections.receiving_yards.opportunityMean));
  assert.ok(result.role.targetShare.value > 0.2);
  assert.equal(result.featureAvailability.participation.liveAvailable, false);
  assert.equal(result.featureAvailability.injuries.liveAvailable, false);
});

test("prop grading treats every sportsbook line as a distinct shadow candidate", () => {
  const opportunity = projectPlayerOpportunity({
    playerName: "Jayden Reed",
    event,
    schedule,
    season: 2026,
    playerStats,
    snapCounts,
    ngs,
    depthCharts,
    weatherContext: {
      controlledEnvironment: true,
      windMph: 0
    },
    opponentSnapshot: {
      defYppAllowed: 5.8
    }
  });

  const prop = {
    statID: "receiving_yards",
    playerID: "WR1",
    playerName: "Jayden Reed",
    over: {
      books: {
        draftkings: { odds: -110, line: 70.5, available: true },
        fanduel: { odds: -105, line: 72.5, available: true }
      }
    },
    under: {
      books: {
        draftkings: { odds: -110, line: 70.5, available: true },
        fanduel: { odds: -115, line: 72.5, available: true }
      }
    }
  };

  const candidates = gradePropMarket(prop, opportunity);
  assert.equal(candidates.length, 4);
  assert.deepEqual(
    [...new Set(candidates.map((row) => row.line))].sort((a, b) => a - b),
    [70.5, 72.5]
  );
  assert.ok(candidates.every((row) => row.status === "PASS"));
  assert.ok(candidates.every((row) => row.shadowStatus === "PASS"));
  assert.ok(candidates.every((row) => row.productionEligible === false));
  assert.ok(candidates.every((row) => row.productionWeight === 0));
  assert.ok(candidates.every((row) => row.marketShrinkage === 0));
  assert.ok(candidates.every((row) =>
    Math.abs(
      row.shadowModelProbability - row.marketFairProbability
    ) < 1e-12
  ));
});

test("continuous probability responds monotonically to a harder over line", () => {
  const projection = { mean: 250, sd: 45 };
  const p240 = independentProbability(projection, 240.5, "over", "passing_yards");
  const p270 = independentProbability(projection, 270.5, "over", "passing_yards");
  assert.ok(p240 > p270);
});


test("NFL player props API rejects unsupported methods before fetching", async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch should not be called");
  };

  const headers = new Map();
  const res = {
    statusCode: 200,
    body: null,
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

  try {
    await nflPropsHandler(
      { method: "POST", query: {}, headers: {} },
      res
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(res.statusCode, 405);
  assert.equal(headers.get("allow"), "GET");
  assert.equal(fetchCalls, 0);
});


test("integer passing TD lines condition model probability on non-push outcomes", () => {
  const projection = { mean: 2 };
  const over = independentProbability(
    projection,
    2,
    "over",
    "passing_touchdowns"
  );
  const under = independentProbability(
    projection,
    2,
    "under",
    "passing_touchdowns"
  );
  assert.ok(over > 0);
  assert.ok(under > 0);
  assert.ok(Math.abs(over + under - 1) < 1e-9);
});


test("provider current-team identity overrides stale historical team after a move", () => {
  const movedStats = playerStats
    .filter((row) => row.player_id === "WR1")
    .map((row) => ({ ...row, recent_team: "MIN" }));

  const result = projectPlayerOpportunity({
    playerName: "Jayden Reed",
    preferredTeam: "GB",
    preferredPosition: "WR",
    event,
    schedule,
    season: 2026,
    playerStats: movedStats,
    snapCounts: [],
    ngs: { passing: [], receiving: [], rushing: [] },
    depthCharts: [],
    weatherContext: { controlledEnvironment: true, windMph: 0 },
    opponentSnapshot: { defYppAllowed: 5.6 }
  });

  assert.equal(result.player.team, "GB");
  assert.equal(result.player.position, "WR");
  assert.equal(result.historyGames, 4);
  assert.ok(result.projections.receiving_yards.mean > 0);
  assert.equal(result.dataQuality, "D");
});
