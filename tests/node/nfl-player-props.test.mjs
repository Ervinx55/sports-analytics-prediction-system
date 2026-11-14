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
  assert.equal(result.projections.receiving_yards.residualWeight, 0.9);
  assert.ok(Number.isFinite(result.projections.receiving_yards.opportunityMean));
  assert.ok(
    Math.abs(
      result.projections.receiving_yards.mean -
        (
          result.projections.receiving_yards.baselineMean +
          0.9 * (
            result.projections.receiving_yards.opportunityMean -
            result.projections.receiving_yards.baselineMean
          )
        )
    ) < 0.01
  );
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


test("schedule lookup preserves first-match dates and refreshes after schedule corrections", () => {
  const games = [
    { game_id: "known", season: 2026, week: 1, home_team: "GB", away_team: "CHI", gameday: "2026-09-10" },
    { game_id: "known", season: 2026, week: 1, home_team: "GB", away_team: "CHI", gameday: "2026-09-01" }
  ];
  const byId = { game_id: "known", season: 2026, week: 1, team: "GB" };
  const byTeam = { season: 2026, week: 1, team: "CHI" };
  const rows = [byId, byTeam];
  const options = { schedule: games, cutoff: "2026-09-05T12:00:00Z", source: "player_stats" };
  assert.deepEqual(pointInTimeRows(rows, options), []);
  games[0].gameday = "2026-09-01";
  assert.deepEqual(pointInTimeRows(rows, options), rows);
  assert.deepEqual(pointInTimeRows([{ game_id: "missing" }], options), []);
});
import { createEventOpportunityProjector } from '../../sharp-service/lib/nfl-event-projections.js';
import {resetProviderProtectionForTests} from '../../sharp-service/lib/provider-protection.js';

test('event projection reuse preserves real projections and every sportsbook candidate', () => {
  const context = { event, schedule, season: 2026, playerStats, snapCounts, ngs, depthCharts, weatherContext: { controlledEnvironment: true } };
  const calculate = createEventOpportunityProjector(context);
  const player = { playerName: 'Jayden Reed', preferredTeam: 'GB', preferredPosition: 'WR', opponentSnapshot: { defYppAllowed: 5.8 } };
  const expected = projectPlayerOpportunity({ ...context, ...player });
  const actual = calculate(player);
  assert.deepEqual(actual, expected);
  const original = structuredClone(actual);
  for (const [statID, line] of [['receiving_yards', 70.5], ['receiving_receptions', 5.5]]) {
    const prop = { playerName: player.playerName, statID,
      over: { books: { draftkings: { odds: -110, line, available: true } } },
      under: { books: { draftkings: { odds: -110, line, available: true } } }
    };
    const candidates = gradePropMarket(prop, calculate(player));
    assert.equal(candidates.length, 2);
    assert.deepEqual(candidates, gradePropMarket(prop, expected));
    assert.ok(candidates.every(row => row.productionWeight === 0 && row.status === 'PASS'));
  }
  assert.deepEqual(actual, original);
});
test('event projections do not rescan unrelated depth history for each player',()=>{
 let unrelatedReads=0;
 const unrelated=Array.from({length:100},()=>({team:'SF',position:'QB',get dt(){unrelatedReads++;return '2026-09-01T00:00:00Z';},pos_rank:1}));
 const context={event,schedule,season:2026,playerStats,snapCounts,ngs,depthCharts:[...depthCharts,...unrelated]};
 const calculate=createEventOpportunityProjector(context);
 calculate({playerName:'Jordan Love',preferredTeam:'GB',preferredPosition:'QB'});
 calculate({playerName:'Jayden Reed',preferredTeam:'GB',preferredPosition:'WR'});
 assert.equal(unrelatedReads,0,'unrelated team/position timestamps must not be scanned by each projection');
});
test('indexed projections preserve the frozen outputs across players, cutoffs and corrected inputs',()=>{
 const base={event,schedule,season:2026,playerStats,snapCounts,ngs,depthCharts,weatherContext:{windMph:20,totalAdjustmentPoints:-2}};
 for(const startsAt of ['2026-09-18T20:00:00Z','2026-10-11T20:00:00Z']){
  const context={...base,event:{...event,startsAt}};
  const calculate=createEventOpportunityProjector(context);
  for(const [playerName,preferredTeam,preferredPosition] of [['Jordan Love','GB','QB'],['Jayden Reed','GB','WR'],['Missing Player','GB','TE']]){
   const args={playerName,preferredTeam,preferredPosition,opponentSnapshot:{defYppAllowed:5.8}};
   const actual=calculate(args),expected=projectPlayerOpportunity({...context,...args});
   assert.deepEqual(actual,expected);
   for(const statID of ['passing_yards','passing_touchdowns','rushing_yards','receiving_receptions','receiving_yards']){
    const prop={playerName,statID,over:{books:{draftkings:{odds:-110,line:20.5,available:true}}},under:{books:{draftkings:{odds:-110,line:20.5,available:true}}}};
    assert.deepEqual(gradePropMarket(prop,actual),gradePropMarket(prop,expected));
   }
  }
 }
 const corrected=structuredClone(base);corrected.playerStats[0].passing_yards='100';
 const args={playerName:'Jordan Love',preferredTeam:'GB'};
 assert.deepEqual(createEventOpportunityProjector(corrected)(args),projectPlayerOpportunity({...corrected,...args}));
});
test('compact NFL estimate response preserves identical frozen candidates and omits duplicated analyses',async()=>{
 const originalFetch=globalThis.fetch,keys=['SPORTS_ODDS_API_KEY','SPORTS_ODDS_OBJECT_OPTIMIZATION','SHARPAPI_KEY','THE_ODDS_API_KEY','SUPABASE_URL'];
 const env=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const asCsv=rows=>{const names=[...new Set(rows.flatMap(r=>Object.keys(r)))];return [names.join(','),...rows.map(r=>names.map(k=>r[k]??'').join(','))].join('\n');};
 const id='JAYDEN_REED_1_NFL',odd=side=>({playerID:id,statID:'receiving_yards',sideID:side,periodID:'game',betTypeID:'ou',byBookmaker:{draftkings:{odds:'-110',overUnder:'70.5',available:true,lastUpdatedAt:new Date().toISOString()}}});
 const providerEvent={eventID:'fixture',leagueID:'NFL',status:{startsAt:event.startsAt},teams:{home:{teamID:'GB_NFL',names:{long:'Green Bay Packers'}},away:{teamID:'ATL_NFL',names:{long:'Atlanta Falcons'}}},players:{[id]:{name:'Jayden Reed',teamID:'GB_NFL',position:'WR'}},odds:{over:odd('over'),under:odd('under')}};
 const invoke=async query=>{const res={status(code){this.code=code;return this;},setHeader(){},json(body){this.body=body;return this;}};await nflPropsHandler({method:'GET',query},res);return res;};
 try{
  keys.forEach(k=>delete process.env[k]);process.env.SPORTS_ODDS_API_KEY='fixture';process.env.SPORTS_ODDS_OBJECT_OPTIMIZATION='0';
  resetProviderProtectionForTests();globalThis.__edgeLabNflDataCache=new Map();globalThis.__edgeLabNflPlayerCache=new Map();
  globalThis.fetch=async url=>{
   const u=String(url);
   if(u.includes('api.sportsgameodds.com'))return new Response(JSON.stringify({success:true,data:[providerEvent]}));
   const rows=u.includes('games.csv')?schedule:u.includes('stats_player')?playerStats:u.includes('snap_counts')?snapCounts:u.includes('depth_charts')?depthCharts:u.includes('ngs_passing')?ngs.passing:u.includes('ngs_receiving')?ngs.receiving:u.includes('ngs_rushing')?ngs.rushing:[];
   return new Response(asCsv(rows));
  };
  const full=await invoke({season:'2026'}),compact=await invoke({season:'2026',view:'estimates'});
  assert.equal(full.code,200);assert.equal(compact.code,200);assert.ok(full.body.candidates.length>0);
  assert.deepEqual(compact.body.candidates,full.body.candidates);
  assert.equal(compact.body.events,undefined);assert.equal(compact.body.shadowPlays,undefined);
  assert.equal(compact.body.productionWeight,0);assert.equal(compact.body.productionEligible,false);
 }finally{
  globalThis.fetch=originalFetch;resetProviderProtectionForTests();globalThis.__edgeLabNflDataCache=new Map();globalThis.__edgeLabNflPlayerCache=new Map();
  for(const [k,v] of Object.entries(env)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});
