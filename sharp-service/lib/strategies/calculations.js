// Manual hypothetical calculations. No provider, identity, freshness or execution verification.
// Inputs are numeric cents, decimal odds and unconditional probabilities (not percentages).
const MAX_CENTS = 1_000_000_000;
function number(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name} must be a finite number from ${min} to ${max}.`);
  return value;
}
function cents(value, name, min = 0) {
  number(value, name, min, MAX_CENTS);
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be whole cents.`);
  return value;
}
function odds(value, name) {
  number(value, name, 1, 10001);
  if (value <= 1) throw new RangeError(`${name} must exceed 1.`);
  return value;
}
// Decimal rational arithmetic prevents binary floating point from losing half cents.
function rational(value) {
 const [coefficient,exponent='0']=String(value).toLowerCase().split('e');
 const negative=coefficient.startsWith('-'),digits=coefficient.replace('-','').split('.');
 let n=BigInt(digits.join(''))*(negative?-1n:1n),d=1n;
 const scale=(digits[1]?.length||0)-Number(exponent);
 if(scale>=0)d=10n**BigInt(scale);else n*=10n**BigInt(-scale);
 return {n,d};
}
const plus=(a,b)=>({n:a.n*b.d+b.n*a.d,d:a.d*b.d});
const minus=(a,b)=>({n:a.n*b.d-b.n*a.d,d:a.d*b.d});
const times=(a,b)=>({n:a.n*b.n,d:a.d*b.d});
const divide=(a,b)=>({n:a.n*b.d,d:a.d*b.n});
function rounded(value) {
 const r=typeof value==='number'?rational(value):value;
 const sign=r.n<0n?-1n:1n,n=r.n*sign;
 const result=Number(sign*((n*2n+r.d)/(2n*r.d)));
 if(!Number.isSafeInteger(result))throw new RangeError('Calculated money exceeds safe integer precision.');
 return result===0?0:result;
}
export function americanToDecimal(value) {
  number(value, 'American odds', -1_000_000, 1_000_000);
  if (Math.abs(value) < 100) throw new RangeError('American odds must have absolute value at least 100.');
  return value > 0 ? 1 + value / 100 : 1 + 100 / -value;
}
export function expectedValue({decimalOdds, winProbability, pushProbability = 0, stakeCents, feeCents = 0} = {}) {
  odds(decimalOdds, 'Decimal odds');
  number(winProbability, 'Win probability', 0, 1);
  number(pushProbability, 'Push probability', 0, 1);
  if (winProbability + pushProbability > 1) throw new RangeError('Win plus push probability cannot exceed 1.');
  cents(stakeCents, 'Stake', 1);
  cents(feeCents, 'Fee');
  const lossProbability = 1 - winProbability - pushProbability;
  const expectedProfit = stakeCents * (winProbability * (decimalOdds - 1) - lossProbability) - feeCents;
  return {expectedProfitCents: rounded(minus(times(rational(stakeCents),minus(times(rational(winProbability),rational(decimalOdds)),minus(rational(1),rational(pushProbability)))),rational(feeCents))), expectedRoi: expectedProfit / stakeCents,
    breakEvenProbability: (1 - pushProbability + feeCents / stakeCents) / decimalOdds,
    lossProbability, requiredCashCents: stakeCents + feeCents};
}
export function arbitrage({outcomes, totalStakeCents, rulesConfirmed, outcomeSetConfirmed, possiblePush} = {}) {
  if (rulesConfirmed !== true || outcomeSetConfirmed !== true) throw new RangeError('Confirm identical settlement rules and the complete mutually exclusive outcome set.');
  if (typeof possiblePush !== 'boolean') throw new RangeError('Specify whether an all-stakes-refunded push is possible.');
  if (!Array.isArray(outcomes) || ![2, 3].includes(outcomes.length)) throw new RangeError('Supply a complete set of two or three outcomes.');
  cents(totalStakeCents, 'Total stake', outcomes.length);
  const labels = new Set();
  const allocations = outcomes.map(o => {
    if (!o || typeof o.label !== 'string' || !o.label.trim() || o.label.length > 100 || labels.has(o.label.trim().toLowerCase())) throw new RangeError('Each outcome requires a unique label of at most 100 characters.');
    labels.add(o.label.trim().toLowerCase());
    odds(o.decimalOdds, 'Outcome odds');
    cents(o.feeCents ?? 0, 'Outcome fee');
    if (o.maxStakeCents !== undefined) cents(o.maxStakeCents, 'Maximum stake');
    return {label: o.label.trim(), decimalOdds: o.decimalOdds, feeCents: o.feeCents ?? 0, stakeCents: 0};
  });
  const impliedProbabilitySum = allocations.reduce((sum, o) => sum + 1 / o.decimalOdds, 0);
  const raw = allocations.map(o => totalStakeCents / o.decimalOdds / impliedProbabilitySum);
  allocations.forEach((o, i) => { o.stakeCents = Math.floor(raw[i]); });
  const remaining = totalStakeCents - allocations.reduce((sum, o) => sum + o.stakeCents, 0);
  const priority = raw.map((v, i) => ({i, fraction: v - Math.floor(v)})).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (let i = 0; i < remaining; i++) allocations[priority[i].i].stakeCents++;
  allocations.forEach((o, i) => {
    if (o.stakeCents < 1) throw new RangeError('Total stake is too small to fund every outcome.');
    if (outcomes[i].maxStakeCents !== undefined && o.stakeCents > outcomes[i].maxStakeCents) throw new RangeError(`Calculated stake exceeds the supplied limit for ${o.label}.`);
  });
  const totalFeesCents = allocations.reduce((sum, o) => sum + o.feeCents, 0);
  const requiredCashCents = totalStakeCents + totalFeesCents;
  const scenarios = allocations.map(o => ({label: o.label, profitCents: rounded(times(rational(o.stakeCents),rational(o.decimalOdds))) - requiredCashCents}));
  if (possiblePush) scenarios.push({label: 'All stakes refunded (push/void)', profitCents: -totalFeesCents || 0});
  return {impliedProbabilitySum, theoreticalArbitrage: impliedProbabilitySum < 1, allocations, scenarios,
    worstCaseProfitCents: Math.min(...scenarios.map(s => s.profitCents)), requiredCashCents, totalFeesCents,
    limitsVerified: outcomes.every(o => o.maxStakeCents !== undefined)};
}
// termsConfirmed attests eligibility and simple unrestricted settlement: no rollover,
// boosts, conditional refunds, or other payout rules beyond this isolated hedge.
export function matchedBet({kind, backOdds, layOdds, backStakeCents, commission, qualifyingCostCents = 0, maxLayStakeCents, termsConfirmed, possiblePush, payoutCapCents} = {}) {
  if (termsConfirmed !== true) throw new RangeError('Confirm eligible, unrestricted simple terms before calculating. Other promotions remain worksheets.');
  if (possiblePush !== false) throw new RangeError('Confirm no push is possible. Push settlement is not supported by this hedge calculator.');
  if (payoutCapCents !== null) throw new RangeError('Explicitly confirm no payout cap. Capped promotions remain worksheets.');
  if (!['cash', 'bonus'].includes(kind)) throw new RangeError('Only cash hedges or stake-not-returned bonus bets are supported.');
  odds(backOdds, 'Back odds');
  odds(layOdds, 'Lay odds');
  cents(backStakeCents, 'Back stake', 1);
  cents(qualifyingCostCents, 'Qualifying cost');
  number(commission, 'Commission', 0, 1);
  if (commission >= 1) throw new RangeError('Commission must be below 1.');
  if (maxLayStakeCents !== undefined) cents(maxLayStakeCents, 'Available lay stake');
  const layStakeCents = rounded(divide(times(rational(backStakeCents),minus(rational(backOdds),rational(kind === 'bonus' ? 1 : 0))),minus(rational(layOdds),rational(commission))));
  if (layStakeCents < 1 || layStakeCents > MAX_CENTS) throw new RangeError('Calculated lay stake is outside supported bounds.');
  if (maxLayStakeCents !== undefined && layStakeCents > maxLayStakeCents) throw new RangeError('Calculated lay stake exceeds supplied available size.');
  const liabilityCents = rounded(times(rational(layStakeCents),minus(rational(layOdds),rational(1))));
  const cashStake = kind === 'cash' ? backStakeCents : 0;
  const backWinProfitCents = rounded(times(rational(backStakeCents),minus(rational(backOdds),rational(1)))) - liabilityCents - qualifyingCostCents;
  // Assumes one isolated exchange market, with commission only on lay winnings.
  const backLoseProfitCents = layStakeCents - rounded(times(rational(layStakeCents),rational(commission))) - cashStake - qualifyingCostCents;
  return {kind, layStakeCents, liabilityCents, requiredCashCents: cashStake + liabilityCents + qualifyingCostCents,
    backWinProfitCents, backLoseProfitCents, worstCaseProfitCents: Math.min(backWinProfitCents, backLoseProfitCents), limitsVerified: maxLayStakeCents !== undefined};
}

