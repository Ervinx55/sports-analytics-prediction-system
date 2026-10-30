import test from 'node:test';
import assert from 'node:assert/strict';
import * as math from '../../sharp-service/lib/strategies/calculations.js';

test('American odds conversion rejects invalid prices', () => {
  assert.equal(math.americanToDecimal(-200), 1.5);
  assert.equal(math.americanToDecimal(150), 2.5);
  for (const x of [0, 99, -99, Infinity, NaN, '100', 1000001]) assert.throws(() => math.americanToDecimal(x), RangeError);
});
test('EV includes unconditional pushes and fees', () => {
  const r = math.expectedValue({decimalOdds: 2, winProbability: .5, pushProbability: .1, stakeCents: 10000, feeCents: 100});
  assert.equal(r.expectedProfitCents, 900);
  assert.ok(Math.abs(r.expectedRoi - .09) < 1e-12);
  assert.equal(r.breakEvenProbability, .455);
  assert.equal(r.lossProbability, .4);
  assert.equal(r.requiredCashCents, 10100);
});
test('EV defaults to no pushes and rounds expected money', () => {
  const r = math.expectedValue({decimalOdds: 3, winProbability: .4, stakeCents: 101});
  assert.equal(r.expectedProfitCents, 20);
  assert.ok(Math.abs(r.expectedRoi - .2) < 1e-12);
  assert.equal(r.breakEvenProbability, 1 / 3);
});
test('EV rejects impossible probabilities and unsafe money/odds', () => {
  const valid = {decimalOdds: 2, winProbability: .5, stakeCents: 100};
  for (const patch of [{winProbability: NaN}, {winProbability: 1.1}, {pushProbability: .6}, {stakeCents: 0}, {stakeCents: 1.5}, {stakeCents: Number.MAX_SAFE_INTEGER}, {decimalOdds: Infinity}, {decimalOdds: 1}, {feeCents: -1}, {winProbability: '.5'}]) assert.throws(() => math.expectedValue({...valid, ...patch}), RangeError);
});
const arb = {outcomes: [{label: 'Home', decimalOdds: 2.1}, {label: 'Away', decimalOdds: 2.1}], totalStakeCents: 10001, rulesConfirmed: true, outcomeSetConfirmed: true, possiblePush: false};
test('arbitrage preserves cents and recalculates rounded returns', () => {
  const r = math.arbitrage(arb);
  assert.deepEqual(r.allocations.map(x => x.stakeCents), [5001, 5000]);
  assert.deepEqual(r.scenarios.map(x => x.profitCents), [501, 499]);
  assert.equal(r.worstCaseProfitCents, 499);
  assert.equal(r.theoreticalArbitrage, true);
  assert.equal(r.requiredCashCents, 10001);
  assert.equal(r.limitsVerified, false);
  assert.equal('guaranteed' in r, false);
});
test('three-way arbitrage includes fees and refund scenario', () => {
  const r = math.arbitrage({...arb, outcomes: ['Home', 'Draw', 'Away'].map(label => ({label, decimalOdds: 3.3, feeCents: 10, maxStakeCents: 1000})), totalStakeCents: 3000, possiblePush: true});
  assert.deepEqual(r.scenarios.map(x => x.profitCents), [270, 270, 270, -30]);
  assert.equal(r.requiredCashCents, 3030);
  assert.equal(r.worstCaseProfitCents, -30);
  assert.equal(r.limitsVerified, true);
});
test('arbitrage rejects missing rules/coverage, duplicate outcomes and exceeded limits', () => {
  for (const patch of [{rulesConfirmed: false}, {outcomeSetConfirmed: false}, {possiblePush: undefined}, {outcomes: [arb.outcomes[0]]}, {outcomes: [arb.outcomes[0], arb.outcomes[0]]}, {outcomes: [{label: 'A', decimalOdds: 2, maxStakeCents: 1}, {label: 'B', decimalOdds: 2}]}, {totalStakeCents: 1}]) assert.throws(() => math.arbitrage({...arb, ...patch}), RangeError);
});
const hedge = {termsConfirmed: true, possiblePush: false, payoutCapCents: null, kind: 'cash', backOdds: 3, layOdds: 3, backStakeCents: 10000, commission: 0};
test('cash hedge capital includes stake and liability', () => {
  const r = math.matchedBet(hedge);
  assert.equal(r.layStakeCents, 10000);
  assert.equal(r.liabilityCents, 20000);
  assert.equal(r.requiredCashCents, 30000);
  assert.equal(r.backWinProfitCents, 0);
  assert.equal(r.backLoseProfitCents, 0);
});
test('bonus hedge excludes bonus stake from returns and cash capital', () => {
  const r = math.matchedBet({...hedge, kind: 'bonus', qualifyingCostCents: 100, maxLayStakeCents: 7000});
  assert.equal(r.layStakeCents, 6667);
  assert.equal(r.liabilityCents, 13334);
  assert.equal(r.requiredCashCents, 13434);
  assert.equal(r.backWinProfitCents, 6566);
  assert.equal(r.backLoseProfitCents, 6567);
  assert.equal(r.limitsVerified, true);
});
test('commission applies only to exchange winnings after cent rounding', () => {
  const r = math.matchedBet({...hedge, commission: .05});
  assert.equal(r.layStakeCents, 10169);
  assert.equal(r.liabilityCents, 20338);
  assert.equal(r.backWinProfitCents, -338);
  assert.equal(r.backLoseProfitCents, -339);
  assert.equal(r.worstCaseProfitCents, -339);
});
test('hedges reject unsupported promotions, commission and insufficient size', () => {
  for (const patch of [{kind: 'refund'}, {commission: 1}, {commission: -.01}, {commission: undefined}, {layOdds: 1}, {maxLayStakeCents: 9999}, {qualifyingCostCents: -1}]) assert.throws(() => math.matchedBet({...hedge, ...patch}), RangeError);
});


test('matched calculations require explicit supported terms and reject caps or pushes', () => {
  for (const kind of ['cash', 'bonus']) {
    for (const patch of [{termsConfirmed: undefined}, {termsConfirmed: false}, {termsConfirmed: 'true'}, {possiblePush: undefined}, {possiblePush: true}, {possiblePush: 0}, {payoutCapCents: undefined}, {payoutCapCents: 0}, {payoutCapCents: 10000}, {payoutCapCents: 'none'}]) {
      assert.throws(() => math.matchedBet({...hedge, kind, ...patch}), RangeError);
    }
  }
});

test('monetary settlement rounds decimal half cents correctly',()=>{
 const r=math.arbitrage({...arb,totalStakeCents:100,outcomes:[{label:'A',decimalOdds:2.01},{label:'B',decimalOdds:2.01}]});
 assert.deepEqual(r.scenarios.map(r=>r.profitCents),[1,1]);
 const h=math.matchedBet({...hedge,backOdds:2.01,layOdds:2,backStakeCents:50});
 assert.equal(h.backWinProfitCents,1);
});
test('restricted or refund-dependent promotions require worksheet rather than conversion',()=>{
 for(const patch of [{termsConfirmed:false},{termsConfirmed:undefined},{payoutCapCents:10000},{payoutCapCents:undefined},{possiblePush:true},{possiblePush:undefined}])
 assert.throws(()=>math.matchedBet({...hedge,...patch}),/worksheet|push/i);
});
