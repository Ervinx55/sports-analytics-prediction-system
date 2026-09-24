import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import nflHandler from "../../sharp-service/api/nflmodel.js";
import {
  normalizeTeam,
  parseCsv,
  simulateGame
} from "../../sharp-service/lib/nfl-model.js";

const originalFetch = globalThis.fetch;
const originalBoardUrl = process.env.EDGE_LAB_BOARD_URL;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function textResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/csv" }
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
  await nflHandler(req, res);
  return res;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBoardUrl === undefined) {
    delete process.env.EDGE_LAB_BOARD_URL;
  } else {
    process.env.EDGE_LAB_BOARD_URL = originalBoardUrl;
  }
  globalThis.__edgeLabNflDataCache = new Map();
});

test("NFL team aliases normalize provider names", () => {
  assert.equal(normalizeTeam("Green Bay Packers"), "GB");
  assert.equal(normalizeTeam("Los Angeles Rams"), "LA");
  assert.equal(normalizeTeam("Jacksonville Jaguars"), "JAX");
  assert.equal(normalizeTeam("Washington Commanders"), "WAS");
});

test("CSV parser preserves quoted fields", () => {
  const rows = parseCsv('a,b,c\n1,"hello, world",3\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].b, "hello, world");
});

test("NFL simulation is deterministic for the same event", () => {
  const a = simulateGame({
    eventId: "test",
    projectedHomeMargin: 3,
    projectedTotal: 45,
    homeSpread: -2.5,
    totalLine: 44.5,
    iterations: 1000
  });
  const b = simulateGame({
    eventId: "test",
    projectedHomeMargin: 3,
    projectedTotal: 45,
    homeSpread: -2.5,
    totalLine: 44.5,
    iterations: 1000
  });
  assert.deepEqual(a, b);
  assert.ok(a.moneyline.home > 0.5);
});

test("NFL model produces shadow-only team market grades", async () => {
  process.env.EDGE_LAB_BOARD_URL = "https://edge.test/api/board";

  const schedule = [
    "game_id,season,game_type,week,gameday,away_team,away_score,home_team,home_score,location,away_rest,home_rest,away_qb_name,home_qb_name,roof,surface,stadium",
    "2026_01_ATL_GB,2026,REG,1,2026-09-10,ATL,20,GB,27,Home,7,7,Michael Penix Jr.,Jordan Love,outdoors,grass,Lambeau Field",
    "2026_02_GB_MIN,2026,REG,2,2026-09-17,GB,24,MIN,17,Home,7,7,Jordan Love,J.J. McCarthy,dome,turf,U.S. Bank Stadium",
    "2026_02_CAR_ATL,2026,REG,2,2026-09-17,CAR,13,ATL,30,Home,7,7,Bryce Young,Michael Penix Jr.,dome,turf,Mercedes-Benz Stadium",
    "2025_18_GB_CHI,2025,REG,18,2026-01-04,GB,28,CHI,20,Home,7,7,Jordan Love,Caleb Williams,outdoors,grass,Soldier Field",
    "2025_18_NO_ATL,2025,REG,18,2026-01-04,NO,17,ATL,24,Home,7,7,Derek Carr,Michael Penix Jr.,dome,turf,Mercedes-Benz Stadium",
    "2026_03_ATL_GB,2026,REG,3,2026-09-24,ATL,,GB,,Home,7,7,Michael Penix Jr.,Jordan Love,outdoors,grass,Lambeau Field"
  ].join("\n");

  const statsHeader = [
    "season","week","team","season_type","game_id","opponent_team",
    "attempts","carries","sacks_suffered","passing_yards","rushing_yards",
    "passing_epa","rushing_epa","passing_interceptions","fumbles_lost"
  ].join(",");
  const currentStats = [
    statsHeader,
    "2026,1,ATL,REG,2026_01_ATL_GB,GB,30,24,2,220,105,-1.2,1.0,1,1",
    "2026,1,GB,REG,2026_01_ATL_GB,ATL,32,26,1,275,120,5.0,2.5,0,0",
    "2026,2,GB,REG,2026_02_GB_MIN,MIN,29,29,2,250,135,3.8,2.0,1,0",
    "2026,2,MIN,REG,2026_02_GB_MIN,GB,34,22,3,210,82,-2.0,-1.0,2,0",
    "2026,2,CAR,REG,2026_02_CAR_ATL,ATL,35,19,4,180,70,-4.0,-1.5,2,1",
    "2026,2,ATL,REG,2026_02_CAR_ATL,CAR,27,31,1,240,155,3.0,3.5,0,0"
  ].join("\n");
  const priorStats = [
    statsHeader,
    "2025,18,GB,REG,2025_18_GB_CHI,CHI,31,28,1,260,130,4.0,2.0,0,0",
    "2025,18,CHI,REG,2025_18_GB_CHI,GB,36,20,3,205,90,-2.0,-0.8,1,1",
    "2025,18,NO,REG,2025_18_NO_ATL,ATL,33,21,2,215,80,-1.0,0.5,1,0",
    "2025,18,ATL,REG,2025_18_NO_ATL,NO,28,27,1,245,125,2.8,1.8,0,0"
  ].join("\n");

  const market = (odds, line = null) => ({
    consensus: { odds, line },
    books: {
      draftkings: { odds, line, available: true },
      fanduel: { odds: odds + 2, line, available: true },
      betmgm: { odds: odds - 2, line, available: true }
    }
  });

  const board = {
    providerCache: { status: "HIT" },
    events: [{
      eventID: "nfl-atl-gb",
      sport: "FOOTBALL",
      league: "NFL",
      startsAt: "2026-09-24T20:15:00-04:00",
      matchup: {
        away: { name: "Atlanta Falcons", short: "ATL" },
        home: { name: "Green Bay Packers", short: "GB" }
      },
      markets: {
        moneyline: {
          away: market(220),
          home: market(-270)
        },
        spread: {
          away: market(-108, 5.5),
          home: market(-112, -5.5)
        },
        total: {
          over: market(-105, 43.5),
          under: market(-115, 43.5)
        }
      }
    }]
  };

  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.startsWith("https://edge.test/api/board")) {
      return jsonResponse(board);
    }
    if (value.includes("nfldata/master/data/games.csv")) {
      return textResponse(schedule);
    }
    if (value.includes("stats_team_week_2026.csv")) {
      return textResponse(currentStats);
    }
    if (value.includes("stats_team_week_2025.csv")) {
      return textResponse(priorStats);
    }
    throw new Error(`unexpected fetch: ${value}`);
  };

  const response = await invoke({
    season: "2026",
    startsAfter: "2026-09-24T00:00:00Z",
    startsBefore: "2026-09-25T00:00:00Z"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.league, "NFL");
  assert.equal(response.body.productionEligible, false);
  assert.equal(response.body.eventCount, 1);
  assert.equal(response.body.availableEventCount, 1);
  assert.equal(response.body.marketCount, 6);
  assert.equal(response.body.events[0].model.version, "NFL Team Markets v1-shadow");
  assert.equal(response.body.events[0].simulation.iterations, 20000);
  assert.ok(response.body.events[0].model.marketWeight > 0.5);
  assert.ok(response.body.markets.every((row) => row.status === "PASS"));
  assert.ok(response.body.markets.every((row) =>
    ["PLAY", "PASS"].includes(row.shadowStatus)
  ));
});

test("NFL model rejects unsupported methods before fetching", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({});
  };
  const response = await invoke({}, "POST");
  assert.equal(response.statusCode, 405);
  assert.equal(calls, 0);
});
