import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getPlayerPortrait, applyPlayerPortrait, PLAYER_PORTRAIT_FALLBACK } from '../../sharp-service/player-portraits.js';

test('the design players resolve to their verified real portraits', () => {
  for (const [id, name, file] of [
    ['DERRICK_WHITE_1_NBA', 'Derrick White', 'derrick-white'],
    ['PAYTON_PRITCHARD_1_NBA', 'Payton Pritchard', 'payton-pritchard'],
    ['JAYSON_TATUM_1_NBA', 'Jayson Tatum', 'jayson-tatum'],
  ]) {
    assert.deepEqual(getPlayerPortrait(id), {
      src: `/assets/players/${file}.png`, alt: `${name} portrait`,
      source: 'espn', playerID: id, fallbackSrc: PLAYER_PORTRAIT_FALLBACK,
    });
  }
});

test('every exact-ID mapping agrees with its recorded official athlete source', async () => {
  const { portraits } = JSON.parse(await readFile(new URL('../../sharp-service/assets/players/SOURCES.json', import.meta.url), 'utf8'));
  const seen = new Set();
  for (const entry of portraits) {
    assert.ok(!seen.has(entry.playerID), `Duplicate provider ID: ${entry.playerID}`);
    seen.add(entry.playerID);
    const official = `https://a.espncdn.com/i/headshots/nba/players/full/${entry.espnAthleteID}.png`;
    assert.equal(entry.portraitSource, official);
    assert.match(entry.officialRosterSource, /^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/basketball\/nba\/teams\/(?:\d+|bos)\/roster$/);
    assert.equal(getPlayerPortrait(entry.playerID).src, entry.bundledPath || official);
    assert.equal(getPlayerPortrait(entry.playerID).alt, `${entry.officialName} portrait`);
    assert.equal(getPlayerPortrait(entry.playerID, official).src, official);
  }
});

test('names, near matches, different discriminators and other sports cannot claim a portrait', () => {
  for (const id of [
    'Derrick White', 'derrick_white_1_nba', 'DERRICK_WHITE_2_NBA',
    'DERRICK_WHITE_1_NFL', ' DERRICK_WHITE_1_NBA', 'DERRICK_WHITE_1_NBA ',
    'DERRICK_WHITE_NBA', '3078576', 'UNKNOWN_PLAYER_1_NBA', '__proto__',
    'constructor', 'toString', '', null, undefined, 3078576, {}, [],
  ]) {
    const portrait = getPlayerPortrait(id);
    assert.equal(portrait.source, 'fallback');
    assert.equal(portrait.src, PLAYER_PORTRAIT_FALLBACK);
    assert.equal(portrait.alt, 'Player portrait unavailable');
  }
});

test('unresolved name variants remain unmapped instead of borrowing another athlete', () => {
  for (const id of ['RON_HOLLAND_1_NBA', 'PJ_WASHINGTON_JR_1_NBA', 'HERBERT_JONES_1_NBA']) {
    assert.equal(getPlayerPortrait(id).source, 'fallback');
  }
});

test('a supplied official URL must belong to the same verified athlete', () => {
  const id = 'DERRICK_WHITE_1_NBA';
  const white = 'https://a.espncdn.com/i/headshots/nba/players/full/3078576.png';
  const tatum = 'https://a.espncdn.com/i/headshots/nba/players/full/4065648.png';
  assert.equal(getPlayerPortrait(id, white).src, white);
  assert.equal(getPlayerPortrait(id, tatum).src, '/assets/players/derrick-white.png');
  assert.equal(getPlayerPortrait('UNKNOWN_PLAYER_1_NBA', white).source, 'fallback');
  assert.equal(getPlayerPortrait('3078576', white).source, 'fallback');
});

test('unverified URL forms and hosts cannot override the verified identity', () => {
  const id = 'DERRICK_WHITE_1_NBA';
  for (const url of [
    'javascript:alert(1)', 'data:image/svg+xml,<svg/>', '//a.espncdn.com/i/headshots/nba/players/full/3078576.png',
    'http://a.espncdn.com/i/headshots/nba/players/full/3078576.png',
    'https://a.espncdn.com.evil.example/i/headshots/nba/players/full/3078576.png',
    'https://a.espncdn.com@evil.example/i/headshots/nba/players/full/3078576.png',
    'https://a.espncdn.com/i/headshots/nba/players/full/3078576.png?player=4065648',
    '/assets/players/jayson-tatum.png', 'https://example.com/derrick-white.png',
    {}, [], null, undefined,
  ]) assert.equal(getPlayerPortrait(id, url).src, '/assets/players/derrick-white.png');
});

test('returned presentation data cannot mutate a future identity lookup', () => {
  const first = getPlayerPortrait('DERRICK_WHITE_1_NBA');
  first.src = '/assets/players/jayson-tatum.png';
  first.alt = 'A different athlete';
  const next = getPlayerPortrait('DERRICK_WHITE_1_NBA');
  assert.equal(next.src, '/assets/players/derrick-white.png');
  assert.equal(next.alt, 'Derrick White portrait');
});

test('image loading errors replace a portrait with the outline icon exactly once', () => {
  const image = { dataset: {}, className: 'player-photo' };
  const result = applyPlayerPortrait(image, 'DERRICK_WHITE_1_NBA');
  assert.equal(image.src, result.src);
  assert.equal(image.alt, 'Derrick White portrait');
  assert.equal(image.dataset.portraitSource, 'espn');
  assert.equal(image.loading, 'lazy');
  assert.equal(image.decoding, 'async');
  assert.equal(image.className, 'player-photo');
  image.onerror();
  assert.equal(image.src, PLAYER_PORTRAIT_FALLBACK);
  assert.equal(image.alt, 'Player portrait unavailable');
  assert.equal(image.dataset.portraitSource, 'fallback');
  assert.equal(image.onerror, null);
});

test('unknown identity starts with the icon and no recursive load handler', () => {
  const image = { dataset: {}, onerror: () => assert.fail('Previous handler must be replaced') };
  applyPlayerPortrait(image, 'UNKNOWN_PLAYER_1_NBA', 'https://a.espncdn.com/i/headshots/nba/players/full/3078576.png');
  assert.equal(image.src, PLAYER_PORTRAIT_FALLBACK);
  assert.equal(image.dataset.portraitSource, 'fallback');
  assert.equal(image.onerror, null);
});

test('reusing an image replaces prior identity and restores its correct load handler', () => {
  const image = { dataset: {} };
  applyPlayerPortrait(image, 'DERRICK_WHITE_1_NBA');
  image.onerror();
  applyPlayerPortrait(image, 'JAYSON_TATUM_1_NBA');
  assert.equal(image.src, '/assets/players/jayson-tatum.png');
  assert.equal(image.alt, 'Jayson Tatum portrait');
  assert.equal(image.dataset.portraitSource, 'espn');
  assert.equal(typeof image.onerror, 'function');
});
