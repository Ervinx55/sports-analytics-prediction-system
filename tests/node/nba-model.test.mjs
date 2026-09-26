import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import nbaHandler from "../../sharp-service/handlers/nbamodel.js";
import {
  normalizeTeam,
  projectEvent,
  scheduleContext,
  simulateGame
} from "../../sharp-service/lib/nba-model.js";

const originalFetch = globalThis.fetch;
const originalBoardUrl = process.env.EDGE_LAB_BOARD_URL;
const originalBdlKey = process.env.BALLDONTLIE_API_KEY;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function createRes() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
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
}

async function invoke(query = {}, method = "GET") {
  const req = { method, query, headers: {} };
  const res = createRes();
  await nbaHandler(req, res);
  return res;
}

function team(abbreviation, fullName) {
  return {
    abbreviation,
    full_name: fullName,
    name: fullName.split(" ").at(-1)
  };
}

function game({
  id,
  date,
  home,
  away,
  homeScore,
  awayScore,
  season = 2026
}) {
  return {
    id,
    date,
    datetime: `${date}T00:00:00.000Z`,
    season,
    status: "Final",
    status_state: "final",
    home_team_score: homeScore,
    visitor_team_score: awayScore,
    home_team: home,
    visitor_team: away,
    postseason: false
  };
}

const BOS = team("BOS", "Boston Celtics");
const LAL = team("LAL", "Los Angeles Lakers");
const NYK = team("NYK", "New York Knicks");
const PHX = team("PHX", "Phoenix Suns");

function historyGames() {
  return [
    game({
      id: 1,
      date: "2026-09-10",
      home: BOS,
      away: NYK,
      homeScore: 118,
      awayScore: 108
    }),
    game({
      id: 2,
      date: "2026-09-12",
      home: PHX,
      away: LAL,
      homeScore: 111,
      awayScore: 116
    }),
    game({
      id: 3,
      date: "2026-09-14",
      home: LAL,
      away: NYK,
      homeScore: 121,
      awayScore: 115
    }),
    game({
      id: 4,
      date: "2026-09-16",
      home: NYK,
      away: BOS,
      homeScore: 104,
      awayScore: 113
    }),
    game({
      id: 5,
      date: "2026-09-18",
      home: BOS,
      away: PHX,
      homeScore: 120,
      awayScore: 112
    }),
    game({
      id: 6,
      date: "2026-09-19",
      home: PHX,
      away: LAL,
      homeScore: 109,
      awayScore: 114
    }),
    game({
      id: 7,
      date: "2026-09-20",
      home: LAL,
      away: NYK,
      homeScore: 117,
      awayScore: 110
    }),
    game({
      id: 8,
      date: "2026-09-21",
      home: NYK,
      away: BOS,
      homeScore: 106,
      awayScore: 119
    }),
    game({
      id: 9,
      date: "2026-09-22",
      home: BOS,
      away: PHX,
      homeScore: 116,
      awayScore: 108
    }),
    game({
      id: 10,
      date: "2026-09-23",
      home: PHX,
      away: LAL,
      homeScore: 113,
      awayScore: 118
    })
  ];
}

function price(odds, line = null) {
  return {
    odds,
    line,
    available: true,
    updatedAt: "2026-09-24T18:00:00Z"
  };
}

function market({
  draftkings,
  fanduel,
  betmgm,
  caesars
}) {
  const books = {};
  if (draftkings) books.draftkings = draftkings;
  if (fanduel) books.fanduel = fanduel;
  if (betmgm) books.betmgm = betmgm;
  if (caesars) books.caesars = caesars;
  const rows = Object.values(books);
  return {
    consensus: {
      odds: rows[0]?.odds ?? null,
      line: rows[0]?.line ?? null
    },
    books
  };
}

function boardEvent() {
  return {
    eventID: "nba-lal-bos",
    sport: "BASKETBALL",
    league: "NBA",
    startsAt: "2026-09-25T23:30:00Z",
    matchup: {
      away: { name: "Los Angeles Lakers", short: "LAL" },
      home: { name: "Boston Celtics", short: "BOS" }
    },
    markets: {
      moneyline: {
        away: market({
          draftkings: price(145),
          fanduel: price(150),
          betmgm: price(148),
          caesars: price(152)
        }),
        home: market({
          draftkings: price(-165),
          fanduel: price(-170),
          betmgm: price(-168),
          caesars: price(-172)
        })
      },
      spread: {
        away: market({
          draftkings: price(-110, 4.5),
          fanduel: price(-108, 5),
          betmgm: price(-112, 4.5),
          caesars: price(-110, 5)
        }),
        home: market({
          draftkings: price(-110, -4.5),
          fanduel: price(-112, -5),
          betmgm: price(-108, -4.5),
          caesars: price(-110, -5)
        })
      },
      total: {
        over: market({
          draftkings: price(-110, 228.5),
          fanduel: price(-105, 229),
          betmgm: price(-112, 228.5),
          caesars: price(-108, 229)
        }),
        under: market({
          draftkings: price(-110, 228.5),
          fanduel: price(-115, 229),
          betmgm: price(-108, 228.5),
          caesars: price(-112, 229)
        })
      }
    }
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.__edgeLabNbaDataCache = new Map();

  if (originalBoardUrl === undefined) {
    delete process.env.EDGE_LAB_BOARD_URL;
  } else {
    process.env.EDGE_LAB_BOARD_URL = originalBoardUrl;
  }

  if (originalBdlKey === undefined) {
    delete process.env.BALLDONTLIE_API_KEY;
  } else {
    process.env.BALLDONTLIE_API_KEY = originalBdlKey;
  }
});

test("NBA team aliases normalize provider names", () => {
  assert.equal(normalizeTeam("Boston Celtics"), "BOS");
  assert.equal(normalizeTeam("LA Clippers"), "LAC");
  assert.equal(normalizeTeam("Philadelphia 76ers"), "PHI");
  assert.equal(normalizeTeam("Utah Jazz"), "UTA");
});

test("NBA schedule context detects back-to-backs and density", () => {
  const rows = [
    {
      startsAt: "2026-09-24T23:00:00Z",
      weight: 1
    },
    {
      startsAt: "2026-09-23T23:00:00Z",
      weight: 0.8
    },
    {
      startsAt: "2026-09-21T23:00:00Z",
      weight: 0.6
    }
  ];
  const context = scheduleContext(
    rows,
    "2026-09-25T23:30:00Z"
  );
  assert.equal(context.restDays, 0);
  assert.equal(context.backToBack, true);
  assert.equal(context.gamesLast72Hours, 2);
  assert.ok(context.fatiguePenalty > 1);
});

test("NBA simulation is deterministic for the same event", () => {
  const a = simulateGame({
    eventId: "nba-test",
    projectedHomeMargin: 4,
    projectedTotal: 228,
    iterations: 2000
  });
  const b = simulateGame({
    eventId: "nba-test",
    projectedHomeMargin: 4,
    projectedTotal: 228,
    iterations: 2000
  });
  assert.deepEqual(a, b);
  assert.ok(a.moneyline.home > 0.5);
});

test("NBA model grades every exact book and line separately", () => {
  const projected = projectEvent({
    event: boardEvent(),
    games: historyGames(),
    season: 2026,
    simulationIterations: 2000
  });

  assert.equal(projected.available, true);
  assert.equal(projected.model.productionEligible, false);
  assert.equal(projected.model.productionWeight, 0);
  assert.equal(projected.model.calibrated, false);
  assert.ok(projected.model.independentWeight > 0);
  assert.equal(projected.markets.length, 24);
  assert.ok(projected.markets.every((row) => row.status === "PASS"));
  assert.ok(projected.markets.every((row) =>
    ["PLAY", "PASS"].includes(row.shadowStatus)
  ));

  const dkHomeSpread = projected.markets.find(
    (row) =>
      row.marketType === "spread" &&
      row.side === "home" &&
      row.book === "draftkings"
  );
  const fdHomeSpread = projected.markets.find(
    (row) =>
      row.marketType === "spread" &&
      row.side === "home" &&
      row.book === "fanduel"
  );

  assert.equal(dkHomeSpread.line, -4.5);
  assert.equal(fdHomeSpread.line, -5);
  assert.notEqual(dkHomeSpread.id, fdHomeSpread.id);
  assert.equal(dkHomeSpread.exactLineBookCount, 2);
  assert.equal(fdHomeSpread.exactLineBookCount, 2);
});

test("NBA API safely degrades to market-only without history key", async () => {
  delete process.env.BALLDONTLIE_API_KEY;
  process.env.EDGE_LAB_BOARD_URL = "https://edge.test/api/board";

  globalThis.fetch = async (url) => {
    if (String(url).startsWith("https://edge.test/api/board")) {
      return jsonResponse({
        providerCache: { status: "HIT" },
        providerFailures: [],
        events: [boardEvent()]
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const response = await invoke({
    season: "2026",
    startsAfter: "2026-09-25T00:00:00Z",
    startsBefore: "2026-09-26T00:00:00Z"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.league, "NBA");
  assert.equal(response.body.productionEligible, false);
  assert.equal(response.body.eventCount, 1);
  assert.equal(
    response.body.sourceHealth.games.status,
    "UNAVAILABLE"
  );
  assert.equal(
    response.body.events[0].model.independentAvailable,
    false
  );
  assert.equal(
    response.body.events[0].model.independentWeight,
    0
  );
  assert.ok(
    response.body.markets.every(
      (row) =>
        Math.abs(
          row.modelProbability -
          row.marketFairProbability
        ) < 1e-12
    )
  );
  assert.equal(response.body.shadowPlayCount, 0);
});

test("NBA API uses cached free game history when configured", async () => {
  process.env.BALLDONTLIE_API_KEY = "test-key";
  process.env.EDGE_LAB_BOARD_URL = "https://edge.test/api/board";

  let bdlCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value.startsWith("https://edge.test/api/board")) {
      return jsonResponse({
        providerCache: { status: "HIT" },
        providerFailures: [],
        events: [boardEvent()]
      });
    }
    if (value.startsWith("https://api.balldontlie.io/v1/games")) {
      bdlCalls += 1;
      assert.equal(options.headers.authorization, "test-key");
      return jsonResponse({
        data: historyGames(),
        meta: { next_cursor: null, per_page: 100 }
      });
    }
    throw new Error(`unexpected fetch: ${value}`);
  };

  const first = await invoke({
    season: "2026",
    startsAfter: "2026-09-25T00:00:00Z",
    startsBefore: "2026-09-26T00:00:00Z"
  });
  const second = await invoke({
    season: "2026",
    startsAfter: "2026-09-25T00:00:00Z",
    startsBefore: "2026-09-26T00:00:00Z"
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(bdlCalls, 1);
  assert.equal(first.body.sourceHealth.games.status, "HEALTHY");
  assert.equal(
    first.body.events[0].model.independentAvailable,
    true
  );
});

test("NBA model rejects unsupported methods before fetching", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({});
  };
  const response = await invoke({}, "POST");
  assert.equal(response.statusCode, 405);
  assert.equal(calls, 0);
});
