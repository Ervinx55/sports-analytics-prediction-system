export function gradeMarket(obs, awayScore, homeScore) {
  if (![awayScore,homeScore].every(value=>Number.isInteger(value)&&value>=0)) return null;
  const sides=obs.market_type==='total'?['over','under']:['away','home'];
  if(!sides.includes(obs.market_side)) return null;
  if(['spread','total'].includes(obs.market_type) &&
    !((typeof obs.line==='number' || typeof obs.line==='string' && obs.line.trim()!=='') && Number.isFinite(Number(obs.line)))) return null;
  let actualValue = null;
  let comparison = 0;

  if (obs.market_type === "moneyline") {
    actualValue = obs.market_side === "away" ? awayScore : homeScore;
    const opponent = obs.market_side === "away" ? homeScore : awayScore;
    comparison = actualValue - opponent;
  } else if (obs.market_type === "spread") {
    const line = Number(obs.line);
    if (!Number.isFinite(line)) return null;
    if (obs.market_side === "away") {
      actualValue = awayScore + line;
      comparison = actualValue - homeScore;
    } else {
      actualValue = homeScore + line;
      comparison = actualValue - awayScore;
    }
  } else if (obs.market_type === "total") {
    const line = Number(obs.line);
    if (!Number.isFinite(line)) return null;
    actualValue = awayScore + homeScore;
    comparison =
      obs.market_side === "over"
        ? actualValue - line
        : line - actualValue;
  } else {
    return null;
  }

  if (Math.abs(comparison) <= 1e-9) {
    return { actualValue, outcome: "PUSH", won: false, pushed: true };
  }
  if (comparison > 0) {
    return { actualValue, outcome: "W", won: true, pushed: false };
  }
  return { actualValue, outcome: "L", won: false, pushed: false };
}

