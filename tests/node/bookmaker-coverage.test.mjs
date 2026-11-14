import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import board from '../../sharp-service/api/board.js';
import sharp from '../../sharp-service/api/sharp.js';
import { propsResponse } from '../../sharp-service/api/nbaprops.js';
import { normalizeSharpApiBoardRows } from '../../sharp-service/lib/sharpapi-provider.js';
import { protectedSportsGameOddsFetch as fetchOdds, resetProviderProtectionForTests } from '../../sharp-service/lib/provider-protection.js';

const originalFetch = globalThis.fetch;
const keys = ['SPORTS_ODDS_API_KEY', 'Sports_Game_Odds_API', 'SHARP_MONITOR_TOKEN', 'SHARP_API_KEY', 'SHARPAPI_API_KEY', 'THE_ODDS_API_KEY', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SPORTS_ODDS_REQUESTS_PER_MINUTE', 'SPORTS_ODDS_OBJECT_OPTIMIZATION'];
const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => {
  resetProviderProtectionForTests();
  keys.forEach(key => delete process.env[key]);
  process.env.SPORTS_ODDS_API_KEY = 'test';
  process.env.SPORTS_ODDS_REQUESTS_PER_MINUTE = '300';
  process.env.SPORTS_ODDS_OBJECT_OPTIMIZATION = '0';
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  resetProviderProtectionForTests();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
async function invoke(handler, query) {
  const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: 'GET', query, headers: {} }, res);
  return res;
}

test('board and sharp translate BookMaker aliases before requesting SGO', async () => {
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(new URL(url));
    return response({ success: true, data: [] });
  };
  for (const handler of [board, sharp]) {
    resetProviderProtectionForTests();
    const result = await invoke(handler, { leagues: 'NBA', books: 'Bovada,bookmaker,Bookmaker.eu,bookmakereu' });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.books, ['bookmakereu', 'bovada']);
  }
  assert.equal(urls.length, 2);
  assert.ok(urls.every(url => url.searchParams.get('bookmakerID') === 'bookmakereu,bovada'));
});

test('board reports observed, missing and fresh quote sides without claiming complete market readiness', async () => {
  const now = Date.now();
  const price = (age = 1000, available = true) => ({ odds: '-110', available, lastUpdatedAt: new Date(now - age).toISOString() });
  globalThis.fetch = async () => response({ success: true, data: [{ eventID: 'e1', leagueID: 'NBA', odds: {
    'points-home-game-ml-home': { byBookmaker: { draftkings: price(), bovada: price(1000, false), fanduel: price(600000), kalshi: price(), circa: { odds: '-120', available: true }, bookmakereu: price(-60000) } }
  } }] });
  const result = await invoke(board, { leagues: 'NBA', books: 'pinnacle,bovada,draftkings,fanduel,kalshi,prizepicks,underdog,circa,bookmaker' });
  const coverage = result.body.bookCoverage;
  assert.ok(coverage, 'coverage must describe actual returned quotes');
  assert.deepEqual(coverage.missingRequested, ['pinnacle', 'prizepicks', 'underdog']);
  assert.deepEqual(coverage.observed, ['bookmakereu', 'bovada', 'circa', 'draftkings', 'fanduel', 'kalshi']);
  const byId = Object.fromEntries(coverage.books.map(book => [book.id, book]));
  assert.equal(byId.draftkings.freshQuoteSides, 1);
  for (const id of ['bovada', 'fanduel', 'circa', 'bookmakereu']) assert.equal(byId[id].freshQuoteSides, 0, id);
  assert.equal(byId.kalshi.type, 'exchange');
  assert.equal(byId.prizepicks.type, 'dfs');
  assert.equal(byId.underdog.type, 'dfs');
  assert.equal(byId.bovada.type, 'sportsbook');
  assert.equal(coverage.productionApproval, false);
});

test('NBA props explicitly reports unsupported requested books while preserving the frozen DraftKings feed', async () => {
  let requested;
  const now = Date.now();
  const result = await propsResponse({ now, key: 'test', requestedBooks: ['bovada', 'prizepicks', 'draftkings'], fetchPage: async req => {
    requested = new URL(req.url).searchParams.get('bookmakerID');
    return { payload: { success: true, data: [] }, fetchedAt: now, cacheStatus: 'MISS' };
  } });
  assert.equal(requested, 'draftkings');
  assert.deepEqual(result.body.bookCoverage.requested, ['bovada', 'draftkings', 'prizepicks']);
  assert.deepEqual(result.body.bookCoverage.configured, ['draftkings']);
  assert.deepEqual(result.body.bookCoverage.unsupportedRequested, ['bovada', 'prizepicks']);
  assert.deepEqual(result.body.bookCoverage.observed, []);
  assert.equal(result.body.productionWeight, 0);
});

test('SharpAPI fallback recognizes the same BookMaker identity as SGO', () => {
  const rows = [{ sportsbook: 'bookmaker', event_id: 'e1', market_type: 'moneyline', selection_type: 'home', odds_american: -120, home_team: 'Home', away_team: 'Away', league: 'NBA' }];
  const events = normalizeSharpApiBoardRows(rows, { league: 'NBA', books: ['bookmakereu'] });
  assert.equal(events.length, 1);
  assert.ok(events[0].markets.moneyline.home.books.bookmakereu);
});

test('SGO request errors do not serialize or block unrelated healthy league requests', async () => {
  const request = league => fetchOdds({ url: `https://api.sportsgameodds.com/v2/events?leagueID=${league}`, apiKey: 'test' });
  globalThis.fetch = async () => response({ success: false, message: 'invalid bookmakerID' }, 400);
  await assert.rejects(request('INVALID'), error => error.status === 400);
  const releases = [];
  globalThis.fetch = () => new Promise(resolve => releases.push(() => resolve(response({ success: true, data: [] }))));
  const first = request('NBA');
  const second = request('NFL');
  const outcomes = Promise.allSettled([first, second]);
  await new Promise(resolve => setImmediate(resolve));
  releases.forEach(release => release());
  const results = await outcomes;
  assert.equal(releases.length, 2, 'a request-specific 400 must not open a provider recovery probe');
  assert.ok(results.every(result => result.status === 'fulfilled'));
});

test('request-specific 400 is logged and releases shared leases without recording a global outage', async () => {
  process.env.SUPABASE_URL = 'https://cache.test';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (new URL(url).hostname === 'api.sportsgameodds.com') return response({ success: false, message: 'invalid query' }, 400);
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : null });
    if (path.endsWith('/claim_provider_refresh')) return response(true);
    if (path.endsWith('/claim_provider_budget')) return response({ allowed: true, remaining: 299 });
    return response([]);
  };
  await assert.rejects(fetchOdds({ url: 'https://api.sportsgameodds.com/v2/events?leagueID=INVALID', apiKey: 'test' }), error => error.status === 400);
  assert.ok(calls.some(call => call.path.endsWith('/release_provider_refresh')));
  assert.ok(calls.some(call => call.path.endsWith('/provider_request_events') && call.body.status_code === 400));
  assert.ok(!calls.some(call => call.path.endsWith('/record_provider_failure')));
  assert.ok(!calls.some(call => call.path.endsWith('/record_provider_success')));
});

test('the shared SGO boundary coalesces equivalent aliases without truncating internal book lists', async () => {
  let seenUrl;
  let calls = 0;
  globalThis.fetch = async url => { calls++; seenUrl = new URL(url); return response({ success: true, data: [] }); };
  const request = books => fetchOdds({ url: 'https://api.sportsgameodds.com/v2/events?bookmakerID=' + books, apiKey: 'test' });
  await request('bookmaker,Bovada');
  await request('bovada,bookmakereu');
  assert.equal(calls, 1);
  assert.equal(seenUrl.searchParams.get('bookmakerID'), 'bookmakereu,bovada');
  await request(Array.from({ length: 25 }, (_, i) => 'fixture' + i).join(','));
  assert.equal(seenUrl.searchParams.get('bookmakerID').split(',').length, 25);
});
