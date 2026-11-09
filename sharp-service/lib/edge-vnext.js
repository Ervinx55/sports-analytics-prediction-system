// Edge Lab vNext: deterministic probability, price and risk primitives.
// Strictly analytical: never authorizes bets, assigns historical calibration,
// or substitutes bookmaker probabilities for an independent model.
export const VERSION = "edge-vnext-alt-lines-v1";

function number(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function unit(p) { return Number.isFinite(p) && p >= 0 && p <= 1; }
function validMoney(v) { return Number.isFinite(v) && v >= 0; }

export function americanOddsToProbability(odds) {
  const o = number(odds);
  if (o === null || o === 0 || Math.abs(o) < 100) return null;
  return o < 0 ? -o / (100 - o) : 100 / (o + 100);
}
export function americanOddsToDecimal(odds) {
  const o = number(odds);
  if (o === null || o === 0 || Math.abs(o) < 100) return null;
  return o < 0 ? 1 + 100 / -o : 1 + o / 100;
}
export function removeVigTwoWay(a, b) {
  const p = americanOddsToProbability(a), q = americanOddsToProbability(b);
  if (p === null || q === null || p + q <= 0) return null;
  return { a: p / (p + q), b: q / (p + q), overround: p + q - 1 };
}

// Each item denotes an exclusive exact outcome integer: 0,1,2,...;
// record missing outcome mass rather than silently re-normalizing it.
export function validateMass(pmf) {
  if (!Array.isArray(pmf) || !pmf.length || pmf.length > 1001) return null;
  let total = 0;
  for (const p of pmf) {
    if (!unit(p)) return null;
    total += p;
  }
  return Math.abs(total - 1) <= 0.000001 ? pmf : null;
}
export function poissonMass(mean, maxOutcome = 300) {
  const lambda = number(mean);
  if (lambda === null || lambda < 0 || lambda > 200 ||
      !Number.isInteger(maxOutcome) || maxOutcome < 0 || maxOutcome > 1000) return null;
  if (lambda === 0) return [1];
  let p = Math.exp(-lambda);
  const dist = [p];
  let sum = p;
  for (let i = 1; i <= maxOutcome; i++) {
    p *= lambda / i;
    dist.push(p);
    sum += p;
  }
  // Do not silently condition on truncated mass for large lambda.
  if (sum < 0.999999 || sum > 1.000001) return null;
  return dist.map(x => x / sum);
}

export function thresholdProbability({ pmf, threshold, direction = "at_least" }) {
  const dist = validateMass(pmf), line = number(threshold);
  if (!dist || line === null || !Number.isFinite(line)) return null;
  if (!["at_least", "over", "under", "at_most"].includes(direction)) return null;
  let win = 0, push = 0;
  for (let i = 0; i < dist.length; i++) {
    const wins = direction === "at_least" ? i >= line :
      direction === "over" ? i > line :
      direction === "under" ? i < line : i <= line;
    if (wins) win += dist[i];
    else if ((direction === "over" || direction === "under") && i === line) push += dist[i];
  }
  return {
    winProbability: Math.min(1, Math.max(0, win)),
    pushProbability: Math.min(1, Math.max(0, push)),
    loseProbability: Math.max(0, 1 - win - push)
  };
}

export function priceAmerican({ winProbability, pushProbability = 0, odds }) {
  const decimal = americanOddsToDecimal(odds);
  if (!unit(winProbability) || !unit(pushProbability) || winProbability + pushProbability > 1 + 1e-9 || decimal === null) return null;
  const lose = Math.max(0, 1 - winProbability - pushProbability);
  const netEVPerDollar = winProbability * (decimal - 1) - lose;
  return {
    decimal,
    quotedImpliedProbability: americanOddsToProbability(odds),
    breakEvenWinProbability: (1 - pushProbability) / decimal,
    netEVPerDollar,
    expectedROI: netEVPerDollar
  };
}

// Kalshi binary YES/NO settled at $1 for a win, $0 otherwise.
// Costs and fees are explicit and always paid: a quote in cents may be an
// ask/contract cost, not a probability or a sportsbook American price.
export function priceKalshi({ winProbability, contractPrice, contracts = 1, fees = 0 }) {
  const p = number(contractPrice), n = number(contracts), f = number(fees);
  if (!unit(winProbability) || p === null || p <= 0 || p >= 1 ||
      !Number.isInteger(n) || n < 1 || n > 100000 || !validMoney(f)) return null;
  const cost = p * n + f;
  const expectedPayout = winProbability * n;
  return {
    cost, expectedPayout,
    netEV: expectedPayout - cost,
    expectedROI: (expectedPayout - cost) / cost,
    breakEvenWinProbability: cost / n,
    warning: "Fees, fill price and event contract settlement terms must be verified"
  };
}

// Fréchet bounds hold regardless of dependence. An independence product
// is ONLY presented when caller explicitly supplies an evidence-backed
// independence attestation; correlated picks cannot be multiplied by default.
export function comboProbability({ legs, independenceVerified = false }) {
  if (!Array.isArray(legs) || !legs.length || legs.length > 30 ||
      !legs.every(x => unit(x.probability))) return null;
  const probabilities = legs.map(x => x.probability);
  const lower = Math.max(0, probabilities.reduce((a, b) => a + b, 0) - (probabilities.length - 1));
  const upper = Math.min(...probabilities);
  const uniqueKeys = new Set(legs.map(x => x.outcomeKey));
  const distinct = uniqueKeys.size === legs.length && !legs.some(x => !x.outcomeKey);
  return {
    lowerBound: lower, upperBound: upper,
    estimatedJoint: independenceVerified && distinct ?
      probabilities.reduce((a, b) => a * b, 1) : null,
    correlationStatus: distinct ? "UNVERIFIED" : "SHARED_OR_UNKNOWN_OUTCOMES",
    recommendation: "AVOID_AUTOMATIC_COMBO_BUY"
  };
}

export function gradePosition({ stake, payout, settled = true }) {
  const s = number(stake), p = number(payout);
  if (!settled || s === null || p === null || !validMoney(s) || !validMoney(p) || s === 0) return null;
  return { stake: s, payout: p, profit: p - s, roi: (p - s) / s };
}
export function summarizePositions(positions) {
  if (!Array.isArray(positions)) return null;
  const graded = positions.map(gradePosition);
  if (graded.some(x => !x)) return null;
  const stake = graded.reduce((s, x) => s + x.stake, 0);
  const payout = graded.reduce((s, x) => s + x.payout, 0);
  return { count: graded.length, stake, payout, profit: payout - stake, roi: stake > 0 ? (payout - stake) / stake : null };
}

// Decision gate: any missing pregame forecast, timestamp, validation or
// independently observed quote means the model is NOT ready to call BUY.
export function decisionGate({ modelProbability, modelCapturedAt, quoteCapturedAt, startsAt,
  calibrated = false, independentForecast = false, sourceHealthy = false, approved = false,
  minimumEdge = 0.03, marketFairProbability, now = new Date().toISOString() }) {
  const p = number(modelProbability), market = number(marketFairProbability);
  const times = [modelCapturedAt, quoteCapturedAt, startsAt, now].map(x => Date.parse(x));
  const validTimes = times.every(Number.isFinite);
  const reasons = [];
  if (!unit(p) || !unit(market)) reasons.push("MISSING_PROBABILITIES");
  if (!validTimes || times[0] > times[2] || times[1] > times[2] || times[0] > times[3] || times[1] > times[3]) reasons.push("INVALID_PREGAME_TIMESTAMPS");
  if (validTimes && times[2] <= times[3]) reasons.push("GAME_STARTED");
  if (validTimes && times[3] - times[0] > 10 * 60 * 1000) reasons.push("STALE_MODEL");
  if (validTimes && times[3] - times[1] > 5 * 60 * 1000) reasons.push("STALE_QUOTE");
  if (!calibrated) reasons.push("UNCALIBRATED");
  if (!independentForecast) reasons.push("MARKET_ANCHORED_OR_UNVERIFIED_MODEL");
  if (!sourceHealthy) reasons.push("SOURCE_UNAVAILABLE");
  if (!approved) reasons.push("MANUAL_APPROVAL_REQUIRED");
  if (unit(p) && unit(market) && p - market < minimumEdge) reasons.push("EDGE_BELOW_THRESHOLD");
  return {
    decision: reasons.length ? "AVOID" : "MANUAL_BUY_REVIEW",
    edgePercentagePoints: unit(p) && unit(market) ? 100 * (p - market) : null,
    reasons,
    automaticBuyEnabled: false
  };
}
