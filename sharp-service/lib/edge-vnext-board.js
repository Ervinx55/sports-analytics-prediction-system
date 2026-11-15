import { decisionGate } from "./edge-vnext.js";

const truthy = x => x === true;
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
    const p = probability(m.modelProbability) ? m.modelProbability : null;
    const fair = probability(m.marketFairProbability) ? m.marketFairProbability : null;
    const gate = decisionGate({
      modelProbability:p, marketFairProbability:fair,
      offeredOdds:m.bestOdds, sport:"NFL", marketType:m.marketType,
      // The source does not currently expose unconditional win/push mass.
      // Withhold price EV rather than treating integer markets as push-free.
      pushProbability:m.pushProbability ?? null,
      modelCapturedAt:nflGenerated, quoteCapturedAt:m.quoteCapturedAt ?? null,
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
      modelOrigin:"MARKET_ANCHORED_SHADOW",
      dataQuality:m.dataQuality ?? null,
      decision:"AVOID", reasons:gate.reasons,
      note:"Existing NFL model uses market shrinkage and is not independently promoted."
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
        reason:nflSourceOk?"Model exists but its ML/spread prices are market-anchored; no independent promotion.":"NFL source unavailable or failed."},
      NHL:{state:"NO_VERIFIED_NHL_PROP_MODEL", generatedAt:null, upcomingMarkets:0,
        reason:"NHL props remain research-only until per-market forecasts, role data and out-of-sample validation are connected."},
      NBA:{state:nbaHasIndependent?"INTEGRATION_REVIEW_REQUIRED":"NO_VERIFIED_INDEPENDENT_MODEL",
        generatedAt:nbaResponse?.generatedAt ?? null, upcomingMarkets:0,
        reason:"No independently calibrated NBA forecasts connected; sportsbook odds are not substitute model predictions."}
    },
    rows, rankedBy:"SHADOW_MODEL_PROBABILITY_NOT_PROVEN_EDGE",
    sourceWarnings: [
      "NFL quotes are at most as fresh as the source response and are not separately timestamp-verified.",
      "Missing NBA model cannot be ranked; never substitute book implied probabilities.",
      "NHL prop averages and recent hit rates are not calibrated forecasts.",
      "All model outcomes require calibration and independent holdout evidence before BUY."
    ]
  };
}
