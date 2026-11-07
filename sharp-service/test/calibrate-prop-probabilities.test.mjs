import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateHistoricalRow,prepareHistory,calibrate,breakEven,fitPlatt
} from '../scripts/calibrate-prop-probabilities.mjs';

const row=(overrides={})=>({
  sport:'NBA',market:'rebounds',eventId:'game_1',playerId:'player_1',
  book:'draftkings',line:9.5,side:'over',americanOdds:-110,
  startsAt:'2025-02-01T19:00:00Z',predictionAt:'2025-02-01T18:30:00Z',
  quoteAt:'2025-02-01T18:25:00Z',settledAt:'2025-02-02T01:00:00Z',
  season:2025,predictedProbability:0.55,actualValue:11,
  predictionSource:'IMMUTABLE_PREGAME_SNAPSHOT',
  quoteSource:'ARCHIVED_PREGAME_BOOK',
  outcomeSource:'OFFICIAL_FINAL_BOX_SCORE',...overrides
});
test('American price break-even arithmetic',()=>{
  assert.ok(Math.abs(breakEven(-110)-110/210)<1e-10);
  assert.ok(Math.abs(breakEven(+120)-100/220)<1e-10);
  assert.equal(breakEven(-99),null);
  assert.equal(breakEven(0),null);
});
test('valid timestamped quote can pass, but no postgame or postprediction data',()=>{
  assert.equal(validateHistoricalRow(row()),null);
  assert.equal(validateHistoricalRow(row({predictionAt:'2025-02-02T01:30:00Z'})),'POINT_IN_TIME_VIOLATION');
  assert.equal(validateHistoricalRow(row({quoteAt:'2025-02-01T18:31:00Z'})),'QUOTE_POSTDATES_PREDICTION');
  assert.equal(validateHistoricalRow(row({quoteAt:'2025-02-01T17:00:00Z'})),'QUOTE_TOO_STALE');
  assert.equal(validateHistoricalRow(row({quoteSource:'UNKNOWN'})),'ODDS_PROVENANCE_UNVERIFIED');
});
test('integer-line pushes are excluded; alternate books and lines cannot multiply labels',()=>{
  const r=prepareHistory([
    row({line:11,actualValue:11,eventId:'a'}),
    row({eventId:'b'}),
    row({eventId:'b',book:'fanduel',americanOdds:+100,line:8.5,side:'under'})
  ]);
  assert.equal(r.accepted.length,1);
  assert.equal(r.rejects.PUSH_EXCLUDED,1);
  assert.equal(r.rejects.CORRELATED_DUPLICATE_PLAYER_GAME_MARKET,1);
});
test('empty dataset fails closed; no fabricated backtest or live BUY',()=>{
  const report=calibrate([]);
  assert.equal(report.productionEligible,false);
  assert.equal(report.uncoveredGroups,'NO_VALID_NBA_OR_NFL_GROUPS');
  assert.deepEqual(report.groupReports,[]);
});
test('chronological holdout cannot overlap the training period',()=>{
  assert.throws(()=>calibrate([], {trainSeasons:[2025],holdoutSeasons:[2025]}),/precede/);
  assert.throws(()=>calibrate([], {trainSeasons:[2026],holdoutSeasons:[2025]}),/precede/);
});
test('synthetic labeled historical fixture never auto promotes regardless of performance',()=>{
  const fixture=Array.from({length:12},(_,i)=>{
    const year=i<6?2024:2025;
    return row({eventId:'game_'+i,season:year,startsAt:year+'-02-01T19:00:00Z',
      predictionAt:year+'-02-01T18:30:00Z',quoteAt:year+'-02-01T18:25:00Z',
      settledAt:year+'-02-02T01:00:00Z',actualValue:i%2?8:12,
      predictedProbability:i%2?0.35:0.65});
  });
  const report=calibrate(fixture,{trainSeasons:[2024],holdoutSeasons:[2025],minTrain:5,minHoldout:5});
  assert.equal(report.acceptedRows,12);
  assert.equal(report.groupReports.length,1);
  assert.equal(report.groupReports[0].status,'HOLDOUT_EVALUATED_NOT_PROMOTED');
  assert.equal(report.groupReports[0].promotionEligible,false);
  assert.ok(Number.isFinite(report.groupReports[0].metrics.calibrated.brier));
  assert.ok(Number.isFinite(fitPlatt(report.groupReports.length?prepareHistory(fixture).accepted.slice(0,6):[]).slope));
});
