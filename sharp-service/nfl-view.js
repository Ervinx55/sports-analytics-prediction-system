export function modelRows(data, kind, now = Date.now()) {
  const generated = Date.parse(data.generatedAt || '');
  const stale = !Number.isFinite(generated) || generated > now || now - generated > 10 * 60_000;
  const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  const blocked = kind === 'props' ? [] : (data.events || []).filter(event => event.available === false).map(event => ({
    ...event, forecastBlocked: true, productionEligible: false,
    away: event.matchup?.away?.name || 'Away team', home: event.matchup?.home?.name || 'Home team',
    label: 'Forecast unavailable', reason: event.reason || 'Required forecast inputs could not be verified.'
  }));
  return [...(kind === 'props' ? data.candidates || [] : data.markets || []), ...blocked]
    .filter(row => Date.parse(row.startsAt) > now)
    .map(row => {
      const weight = probability(row.independentContributionWeight);
      const marketOnly = row.probabilitySource === 'market_only' && weight === 0;
      const blend = row.probabilitySource === 'market_blend' && weight !== null && weight > 0;
      const blocked = row.forecastBlocked || row.forecastReadiness?.available === false;
      const model = blocked ? null : probability(kind === 'props' ? row.rawIndependentProbability : blend ? row.modelProbability : null);
      const probabilityLabel = kind === 'props' ? 'Independent model (unvalidated)' : blend ? 'Market + model blend' : 'Independent forecast';
      const probabilityNote = blocked ? 'Forecast unavailable: required inputs are unverified.'
        : kind === 'props' ? 'Independent research estimate. Accuracy validation has not authorized production use.'
        : marketOnly ? 'Market prices only; independent model contribution is 0%. This is not a validated model win rate.'
        : blend ? `${(weight * 100).toFixed(1)}% independent model contribution; the remainder comes from market prices. This blend is not cleared for production.`
        : 'Probability source is unverified; no model percentage is shown.';
      return {...row, model, market: probability(row.marketFairProbability), probabilityLabel, probabilityNote, status: 'SHADOW', stale};
    }).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
}
export function marketLabel(row, kind) {
 if(kind==='props') return [row.playerName,row.statID?.replaceAll('_',' '),row.side,row.line].filter(v=>v!==null&&v!==undefined).join(' · ');
 const line=row.line===null||row.line===undefined?'Line unavailable':String(row.line);
 return [row.marketType,row.label,row.marketType==='moneyline'?null:line].filter(v=>v!==null&&v!==undefined).join(' · ');
}
