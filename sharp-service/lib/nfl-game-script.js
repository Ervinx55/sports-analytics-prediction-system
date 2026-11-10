// Pregame NFL game-script scenario diagnostics. Shadow only: no wager decisions
// or production prop probabilities use these outputs until walk-forward validation.
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const round = (n) => Number(n.toFixed(3));

export function projectGameScriptScenarios({
  teamSpread = null,
  projectedPlays,
  historicalPassRate,
  baselineYardsPerAttempt = null,
  pressureRateAllowed = null,
  thirdDownConversionRate = null
} = {}) {
  if (!finite(projectedPlays) || projectedPlays <= 0 ||
      !finite(historicalPassRate) || historicalPassRate <= 0 || historicalPassRate >= 1) {
    return { status: "UNAVAILABLE", reason: "Missing pregame plays or pass-rate baseline", scenarios: [] };
  }
  // A positive team spread means an underdog. Probabilities are provisional
  // monotonic scenario weights, NOT a calibrated win-probability model.
  const trailingWeight = finite(teamSpread)
    ? clamp(0.33 + teamSpread * 0.018, 0.12, 0.62) : 1 / 3;
  const leadingWeight = finite(teamSpread)
    ? clamp(0.33 - teamSpread * 0.018, 0.12, 0.62) : 1 / 3;
  const neutralWeight = 1 - trailingWeight - leadingWeight;
  const scenarios = [
    { name: "leading", weight: leadingWeight, passRateOffset: -0.075 },
    { name: "close", weight: neutralWeight, passRateOffset: 0 },
    { name: "trailing", weight: trailingWeight, passRateOffset: 0.09 }
  ].map((scenario) => {
    const passRate = clamp(historicalPassRate + scenario.passRateOffset, 0.35, 0.78);
    // Third-down conversion is not a possession-time measurement. If unavailable,
    // deliberately apply NO pace modifier, not a guess about likely turnovers.
    const possessionFactor = finite(thirdDownConversionRate)
      ? clamp(1 + (thirdDownConversionRate - 0.39) * 0.18, 0.96, 1.04)
      : 1;
    const efficiencyFactor = finite(pressureRateAllowed)
      ? clamp(1 - Math.max(0, pressureRateAllowed - 0.30) * (scenario.name === "trailing" ? 0.35 : 0.18), 0.88, 1)
      : 1;
    const plays = projectedPlays * possessionFactor;
    const attempts = plays * passRate;
    return {
      name: scenario.name,
      weight: round(scenario.weight),
      plays: round(plays),
      passRate: round(passRate),
      passingAttempts: round(attempts),
      rushingAttempts: round(plays - attempts),
      efficiencyFactor: round(efficiencyFactor),
      passingYards: finite(baselineYardsPerAttempt)
        ? round(attempts * baselineYardsPerAttempt * efficiencyFactor)
        : null
    };
  });
  const weighted = (field) => scenarios.reduce((sum, s) => sum + s.weight * s[field], 0);
  return {
    status: "SHADOW_UNCALIBRATED",
    version: "nfl-game-script-scenarios-v1",
    pregameOnly: true,
    appliedToProduction: false,
    inputs: {
      teamSpread: finite(teamSpread) ? teamSpread : null,
      pressureRateAvailable: finite(pressureRateAllowed),
      thirdDownRateAvailable: finite(thirdDownConversionRate),
      yardsPerAttemptAvailable: finite(baselineYardsPerAttempt)
    },
    scenarios,
    expectedPassingAttempts: round(weighted("passingAttempts")),
    expectedRushingAttempts: round(weighted("rushingAttempts")),
    expectedPassingYards: finite(baselineYardsPerAttempt) ? round(weighted("passingYards")) : null
  };
}
