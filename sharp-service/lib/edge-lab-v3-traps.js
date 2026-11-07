/**
 * Edge Lab V3 diagnostic layer.
 * Research-only: this file MUST NOT promote shadow estimates to production bets.
 * Does not create a probability from a defense-vs-position rank or hit streak.
 */
export const EDGE_LAB_V3_VERSION = "edge-lab-v3-trap-preview-1";
const finite = v => typeof v === "number" && Number.isFinite(v);
const frac = v => finite(v) && v >= 0 && v <= 1 ? v : null;
export function breakEvenProbability(americanOdds) {
  const o = Number(americanOdds);
  if (!Number.isFinite(o) || o === 0 || Math.abs(o) < 100) return null;
  return o > 0 ? 100 / (o + 100) : (-o) / (100 - o);
}
const round = v => finite(v) ? Math.round(v * 10000) / 10000 : null;
function quoteAge(iso, now) {
  const at = Date.parse(iso || "");
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}
function flagsFor({ quoteState, updatedAt, modelProbability, quality, context, productionEligible, now }) {
  const flags = [];
  if (quoteState && quoteState !== "OBSERVED") flags.push({ code: "QUOTE_" + quoteState, severity: "HIGH" });
  const age = quoteAge(updatedAt, now);
  if (age === null) flags.push({ code: "QUOTE_TIMESTAMP_UNVERIFIED", severity: "HIGH" });
  else if (Date.parse(updatedAt) > now) flags.push({ code: "FUTURE_QUOTE_TIMESTAMP", severity: "HIGH" });
  else if (age > 15 * 60_000) flags.push({ code: "STALE_PRICE_OVER_15_MINUTES", severity: "HIGH" });
  if (modelProbability === null) flags.push({ code: "CALIBRATED_PROBABILITY_MISSING", severity: "HIGH" });
  if (quality === "C" || quality === "D") flags.push({ code: "LOW_OPPORTUNITY_DATA_QUALITY", severity: "HIGH" });
  if (context && (!context.eligible || !context.historicalPointInTimeEligible)) flags.push({ code: "CONTEXT_NOT_POINT_IN_TIME_VERIFIED", severity: "MEDIUM" });
  if (context && Array.isArray(context.blockers)) for (const code of context.blockers.slice(0, 4)) flags.push({ code: String(code), severity: "MEDIUM" });
  if (!productionEligible) flags.push({ code: "PRODUCTION_CALIBRATION_GATE_CLOSED", severity: "HIGH" });
  return [...new Map(flags.map(f => [f.code, f])).values()];
}
function decision({ modelProbability, breakEven, flags, productionEligible }) {
  // Only explicitly eligible, externally validated model probabilities may qualify.
  // No fallback from market probability, streaks or shadow forecasts.
  if (!productionEligible || modelProbability === null || breakEven === null || flags.some(f => f.severity === "HIGH")) return "AVOID";
  // A conservative margin is a minimum gate, not a guarantee of positive EV.
  return modelProbability - breakEven >= 0.05 ? "BUY" : "AVOID";
}
function finalize(rows, count = 50) {
  const byValue = rows.filter(r => r.estimatedEdge !== null)
    .sort((a, b) => b.estimatedEdge - a.estimatedEdge).slice(0, count);
  const byHitProbability = rows.filter(r => r.calibratedHitProbability !== null)
    .sort((a, b) => b.calibratedHitProbability - a.calibratedHitProbability).slice(0, count);
  const priceOnly = [...rows].sort((a, b) =>
    (a.breakEvenProbability ?? 2) - (b.breakEvenProbability ?? 2)).slice(0, count);
  return {
    version: EDGE_LAB_V3_VERSION,
    scope: "RESEARCH_ONLY",
    probabilitySource: "CALIBRATED_PRODUCTION_MODEL_ONLY",
    disclaimer: "Odds-implied probability is a price, not a predicted hit probability. No BUY is approved from shadow model outputs.",
    marketsReviewed: rows.length,
    buyCount: rows.filter(r => r.decision === "BUY").length,
    mostLikely: byHitProbability,
    bestValue: byValue,
    priceComparisonOnly: priceOnly,
    trapFlagCounts: rows.flatMap(r => r.trapFlags).reduce((a, f) => { a[f.code] = (a[f.code] || 0) + 1; return a; }, {}),
  };
}
export function screenNbaPropsV3(events, { now = Date.now() } = {}) {
  const rows = [];
  for (const event of events || []) for (const player of event.players || []) {
    const prop = player.prop || {};
    for (const side of ["over", "under"]) for (const [book, quote] of Object.entries(prop[side]?.books || {})) {
      const implied = breakEvenProbability(quote.odds);
      const p = null; // NBA context probabilities are currently uncalibrated.
      const flags = flagsFor({
        quoteState: quote.quoteState || prop.quoteState,
        updatedAt: quote.updatedAt, modelProbability: p,
        quality: null, context: player.context,
        productionEligible: false, now
      });
      rows.push({
        eventID: event.eventID, startsAt: event.startsAt,
        matchup: event.matchup, playerName: prop.playerName,
        market: prop.statID, side, book, line: quote.line,
        americanOdds: quote.odds, quoteAt: quote.updatedAt || null,
        breakEvenProbability: round(implied),
        calibratedHitProbability: null, estimatedEdge: null, expectedValue: null,
        researchProjection: finite(player.context?.contextAdjustedProjection) ? player.context.contextAdjustedProjection : null,
        productionEligible: false, decision: decision({modelProbability: p,breakEven: implied,flags,productionEligible:false}),
        trapFlags: flags
      });
    }
  }
  return finalize(rows);
}
export function screenNflPropsV3(candidates, { now = Date.now() } = {}) {
  const rows = (candidates || []).map(c => {
    // NFL independent/shadow forecasts are development-only: don't expose as calibrated picks.
    const p = c.productionEligible === true && c.calibrationState === "PROMOTED" ? frac(c.calibratedHitProbability) : null;
    const implied = breakEvenProbability(c.odds);
    const flags = flagsFor({
      updatedAt: c.updatedAt, modelProbability: p, quality: c.dataQuality,
      productionEligible: c.productionEligible === true && p !== null, now
    });
    return {
      eventID:c.eventID, startsAt:c.startsAt, playerName:c.playerName,
      market:c.statID, side:c.side, book:c.book, line:c.line,
      americanOdds:c.odds, quoteAt:c.updatedAt || null,
      breakEvenProbability:round(implied),calibratedHitProbability:p,
      estimatedEdge:p===null || implied===null ? null : round(p-implied),
      expectedValue:null, productionEligible:p!==null && c.productionEligible===true,
      shadowDiagnostic:c.shadowStatus || null,
      decision:decision({modelProbability:p,breakEven:implied,flags,productionEligible:p!==null && c.productionEligible===true}),
      trapFlags:flags
    };
  });
  return finalize(rows);
}
