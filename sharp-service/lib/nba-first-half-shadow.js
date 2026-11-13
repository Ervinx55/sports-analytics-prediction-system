/**
 * Edge Lab NBA first-half spread research engine (SHADOW ONLY).
 * A transparent normal-margin baseline, NOT a fitted or calibrated model.
 * No production BUY decision may be derived from this module.
 */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const MS_MIN = 60000;

// Abramowitz/Stegun approximation of the standard normal cumulative distribution.
export function normalCdf(z) {
  if (!finite(z)) throw new TypeError("z must be finite");
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const density = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  const tail = density * t *
    (0.319381530 + t * (-0.356563782 + t * (1.781477937 +
    t * (-1.821255978 + t * 1.330274429))));
  return clamp(z >= 0 ? 1 - tail : tail, 0, 1);
}

/**
 * Model distribution for home 1H lead (home points minus away points).
 * Inputs must be generated from records available BEFORE tipoff.
 *
 * firstHalfNetRating: home 1H net rating minus away 1H net rating, per 100 possessions.
 * seasonNetRating: season home net rating minus away net rating, per 100 possessions.
 * possessionEstimate: expected possessions IN ONE HALF (not whole game).
 *
 * Small-sample 1H ratings are intentionally shrunk toward a season prior.
 * Estimated standard deviation is supplied by a separate historical fit:
 * this code will not infer/calibrate it from a handful of games.
 */
export function estimateFirstHalfMargin({
  firstHalfNetRating, seasonNetRating, firstHalfSampleGames,
  possessionEstimate, priorGames = 25,
  homeCourtPoints = 0, restAdjustmentPoints = 0,
  availabilityAdjustmentPoints = 0, travelAdjustmentPoints = 0,
  marginStdDev
}) {
  const numbers = [firstHalfNetRating, seasonNetRating, firstHalfSampleGames,
    possessionEstimate, priorGames, homeCourtPoints, restAdjustmentPoints,
    availabilityAdjustmentPoints, travelAdjustmentPoints, marginStdDev];
  if (!numbers.every(finite) || firstHalfSampleGames < 0 ||
      priorGames <= 0 || possessionEstimate < 35 || possessionEstimate > 65 ||
      marginStdDev < 4 || marginStdDev > 30) {
    throw new RangeError("Missing or implausible first-half model inputs");
  }
  const weight = firstHalfSampleGames / (firstHalfSampleGames + priorGames);
  const shrunkNetRating = weight * firstHalfNetRating + (1 - weight) * seasonNetRating;
  const expectedHomeMargin = shrunkNetRating * possessionEstimate / 100 +
    homeCourtPoints + restAdjustmentPoints + availabilityAdjustmentPoints +
    travelAdjustmentPoints;
  return {
    expectedHomeMargin, marginStdDev, shrinkageWeight: weight,
    shrunkNetRating, modelType: "normal_margin_unfitted_shadow_v1"
  };
}

/**
 * Sportsbook spread refers to the home team: -3.5 requires home lead > 3.5.
 * Integer-point final scores create real push mass on integer spreads.
 * Use a discretized normal distribution with continuity correction rather
 * than treating the score as a continuous random variable.
 */
export function spreadOutcome({expectedHomeMargin, marginStdDev}, homeSpread) {
  if (![expectedHomeMargin, marginStdDev, homeSpread].every(finite) ||
      marginStdDev <= 0) throw new RangeError("Invalid margin distribution or line");
  const threshold = -homeSpread;
  // Integer final score margin M: home covers if M > threshold.
  const winMin = Math.floor(threshold) + 1;
  const win = 1 - normalCdf((winMin - 0.5 - expectedHomeMargin) / marginStdDev);
  const thresholdIsInteger = Number.isInteger(threshold);
  const push = thresholdIsInteger ?
    normalCdf((threshold + 0.5 - expectedHomeMargin) / marginStdDev) -
    normalCdf((threshold - 0.5 - expectedHomeMargin) / marginStdDev) : 0;
  return {
    win: clamp(win, 0, 1),
    push: clamp(push, 0, 1),
    loss: clamp(1 - win - push, 0, 1),
    thresholdHomeMargin: threshold
  };
}

export function decimalOdds(americanOdds) {
  if (!finite(americanOdds) || americanOdds === 0) throw new RangeError("Invalid odds");
  return americanOdds > 0 ? 1 + americanOdds / 100 : 1 + 100 / Math.abs(americanOdds);
}

/** Expected NET return per $1 stake, treating pushes as stake refunded. */
export function sportsbookEv({win, push = 0, loss}, americanOdds) {
  if (![win, push, loss].every(finite) ||
      [win, push, loss].some(x => x < 0 || x > 1) ||
      Math.abs(win + push + loss - 1) > 0.000001) {
    throw new RangeError("Probabilities must sum to one");
  }
  return win * (decimalOdds(americanOdds) - 1) - loss;
}

/**
 * Exchange combo EV for a ticket with known all-legs-win probability.
 * maxPayout includes returned stake. Fee is assessed only on wins
 * unless an explicit lossFee is supplied. Never assume independence.
 */
export function comboEv({cost, maxPayout, winProbability, winFee = 0, lossFee = 0}) {
  if (![cost, maxPayout, winProbability, winFee, lossFee].every(finite) ||
      cost <= 0 || maxPayout < 0 || winFee < 0 || lossFee < 0 ||
      winProbability < 0 || winProbability > 1) throw new RangeError("Invalid combo parameters");
  return winProbability * (maxPayout - cost - winFee) +
    (1 - winProbability) * (-cost - lossFee);
}

export function gradeCombo({cost, payout, legs}) {
  if (![cost, payout].every(finite) || cost < 0 || payout < 0 ||
      !Array.isArray(legs) || legs.length === 0 ||
      !legs.every(x => ["WIN", "LOSS", "PUSH", "VOID"].includes(x))) {
    throw new RangeError("Invalid combo settlement");
  }
  const wins = legs.filter(x => x === "WIN").length;
  return {wins, legs: legs.length, legHitRate: wins / legs.length,
    netProfit: payout - cost, ticketWon: payout > cost};
}

/**
 * Research gate. A SHADOW_CANDIDATE is NEVER an executable BUY.
 * Require timestamps, valid probability distribution, matching exact spread
 * and an external no-vig sharp baseline. Confidence / calibration gates
 * must be developed before any production decision.
 */
export function evaluateFirstHalfShadow({
  distribution, quote, sharp, now, tipoff,
  maxQuoteAgeMinutes = 10, minimumEv = 0.03,
  availabilityConfirmed = false, modelCalibrated = false
}) {
  const reasons = [];
  const nowMs = Date.parse(now), tipoffMs = Date.parse(tipoff);
  const checkedMs = Date.parse(quote?.checkedAt);
  const sharpMs = Date.parse(sharp?.checkedAt);
  if (![nowMs, tipoffMs, checkedMs, sharpMs].every(Number.isFinite) ||
      checkedMs > nowMs || sharpMs > nowMs ||
      nowMs - checkedMs > maxQuoteAgeMinutes * MS_MIN ||
      nowMs - sharpMs > maxQuoteAgeMinutes * MS_MIN || nowMs >= tipoffMs) {
    reasons.push("STALE_OR_INVALID_TIMESTAMP");
  }
  if (!quote || !sharp || !finite(quote.homeSpread) ||
      !finite(sharp.homeSpread) || quote.homeSpread !== sharp.homeSpread ||
      !finite(quote.americanOdds) || quote.americanOdds === 0 ||
      !finite(sharp.noVigHomeCover) || sharp.noVigHomeCover < 0 ||
      sharp.noVigHomeCover > 1) reasons.push("UNMATCHED_OR_MISSING_PRICE");
  if (!availabilityConfirmed) reasons.push("ROTATION_UNCONFIRMED");
  if (!modelCalibrated) reasons.push("MODEL_UNCALIBRATED");
  let outcome = null, expectedValue = null;
  if (distribution && quote && finite(quote.homeSpread) &&
      finite(quote.americanOdds) && quote.americanOdds !== 0) {
    try {
      outcome = spreadOutcome(distribution, quote.homeSpread);
      expectedValue = sportsbookEv(outcome, quote.americanOdds);
    } catch { reasons.push("INVALID_DISTRIBUTION"); }
  } else reasons.push("NO_DISTRIBUTION");
  if (expectedValue !== null && expectedValue < minimumEv) reasons.push("EV_BELOW_GATE");
  const operational = reasons.some(r => r !== "MODEL_UNCALIBRATED");
  return {
    status: operational ? "AVOID" : "SHADOW_CANDIDATE",
    productionDecision: "DISABLED",
    reasons, outcome, expectedValue,
    sharpFairCover: sharp?.noVigHomeCover ?? null,
    modelType: distribution?.modelType ?? null
  };
}
