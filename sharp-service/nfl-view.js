export function modelRows(data, kind, now = Date.now()) {
  const generated = Date.parse(data.generatedAt || '');
  const stale = !Number.isFinite(generated) || now - generated > 10 * 60_000;
  const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  return (kind === 'props' ? data.candidates || [] : data.markets || [])
    .filter(row => Date.parse(row.startsAt) > now)
    .map(row => ({...row, model: probability(kind === 'props' ? row.rawIndependentProbability : row.modelProbability), market: probability(row.marketFairProbability), status: 'SHADOW', stale})).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
}
export function marketLabel(row, kind) {
 if(kind==='props') return [row.playerName,row.statID?.replaceAll('_',' '),row.side,row.line].filter(v=>v!==null&&v!==undefined).join(' · ');
 const line=row.line===null||row.line===undefined?'Line unavailable':String(row.line);
 return [row.marketType,row.label,row.marketType==='moneyline'?null:line].filter(v=>v!==null&&v!==undefined).join(' · ');
}
