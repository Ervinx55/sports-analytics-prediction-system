import { decisionGate } from "./edge-vnext.js";

const probability = x => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
export function buildEdgeBoard({ nflResponse = null, nbaResponse = null, now = new Date().toISOString() } = {}) {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("Invalid observation time");
  const nflGenerated = nflResponse?.generatedAt || null;
  const nflSourceOk = Boolean(nflResponse && !nflResponse.error && nflResponse.league === "NFL");
  const nflMarkets = nflSourceOk && Array.isArray(nflResponse.markets) ? nflResponse.markets : [];
  const rows = [];
  for (const m of nflMarkets) {
    const starts = Date.parse(m.startsAt);
    if (!Number.isFinite(starts) || starts <= nowMs || starts > nowMs + 8 * 86400000) continue;
    const weight = probability(m.independentContributionWeight) ? m.independentContributionWeight : null;
    const marketOnly = m.probabilitySource === "market_only" && weight === 0;
    const blend = m.probabilitySource === "market_blend" && weight !== null && weight > 0;
    const p = blend && probability(m.modelProbability) ? m.modelProbability : null;
    const fair = probability(m.marketFairProbability) ? m.marketFairProbability : null;
    const gate = decisionGate({
      modelProbability:p, marketFairProbability:fair,
      modelCapturedAt:nflGenerated, quoteCapturedAt:nflGenerated,
      startsAt:m.startsAt, now, sourceHealthy:nflSourceOk,
      independentForecast:false, calibrated:false, approved:false
    });
    rows.push({
      sport:"NFL", eventId:m.eventID, startsAt:m.startsAt, label:m.label,
      matchup:[m.away,m.home].filter(Boolean).join(" @ "),
      marketType:m.marketType, side:m.side, line:m.line ?? null,
      bestBook:m.bestBook ?? null, bestOdds:m.bestOdds ?? null,
      modelProbability:p, marketFairProbability:fair,
      edgePercentagePoints:gate.edgePercentagePoints,
      probabilitySource:marketOnly?"market_only":blend?"market_blend":"unverified",
      independentContributionWeight:weight,
      modelOrigin:marketOnly?"MARKET_ONLY":blend?"MARKET_BLEND_UNVALIDATED":"UNVERIFIED_PROBABILITY_SOURCE",
      dataQuality:m.dataQuality ?? null,
      decision:"AVOID", reasons:gate.reasons,
      note:marketOnly?"Market prices only; independent model contribution is 0%. No model probability or model edge is available.":
        blend?`${(weight*100).toFixed(1)}% independent model contribution; the remainder comes from market prices. This blend is unvalidated and not cleared for production.`:
        "Probability source is unverified; no model probability or model edge is available."
    });
  }
  rows.sort((a,b)=>(b.modelProbability ?? -1)-(a.modelProbability ?? -1));
  const nbaHasIndependent = nbaResponse?.productionEligible === true &&
    nbaResponse?.independentForecast === true &&
    nbaResponse?.calibrationVerified === true &&
    Array.isArray(nbaResponse?.markets);
  // Until an independently validated NBA model is wired, never map bookmaker
  // implied probabilities into the "our model" column.
  return {
    version:"edge-vnext-board-v1", generatedAt:now,
    automaticBuyEnabled:false, productionEligible:false,
    sports:{
      NFL:{state:nflSourceOk?"MARKET_ANCHORED_SHADOW":"UNAVAILABLE",
        generatedAt:nflGenerated, upcomingMarkets:rows.length,
        reason:nflSourceOk?"Market-only references and explicitly labeled unvalidated blends; no independent promotion.":"NFL source unavailable or failed."},
      NBA:{state:nbaHasIndependent?"INTEGRATION_REVIEW_REQUIRED":"NO_VERIFIED_INDEPENDENT_MODEL",
        generatedAt:nbaResponse?.generatedAt ?? null, upcomingMarkets:0,
        reason:"No independently calibrated NBA forecasts connected; sportsbook odds are not substitute model predictions."}
    },
    rows, rankedBy:"SHADOW_MODEL_PROBABILITY_NOT_PROVEN_EDGE",
    sourceWarnings: [
      "NFL quotes are at most as fresh as the source response and are not separately timestamp-verified.",
      "Missing NBA model cannot be ranked; never substitute book implied probabilities.",
      "All model outcomes require calibration and independent holdout evidence before BUY."
    ]
  };
}
