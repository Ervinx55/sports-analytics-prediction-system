const number = value => (typeof value === 'number' || (typeof value === 'string' && value.trim())) && Number.isFinite(Number(value)) ? Number(value) : null;
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const time = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export const PERFORMANCE_SPORTS = ['MLB','NFL','NBA','CFB','NHL','TENNIS','SOCCER'];
export const scopedSport = sport => ['NHL','TENNIS','SOCCER'].includes(sport);
export const eventIdentity = p => scopedSport(p.sport) ? '['+[p.sport,p.competitionKey,p.tour ?? null,p.eventKey].map(v=>JSON.stringify(v)).join(', ')+']' : p.eventKey;
export const scopeIdentity = p => [p.marketScope?.period ?? null,p.marketScope?.unit ?? null,p.marketScope?.set ?? null,p.marketScope?.game ?? null,p.settlementRule?.version ?? null,p.settlementRule?.format ?? null,p.settlementRule?.retirement ?? null,p.settlementRule?.walkover ?? null];
export function marketKey(p) {
  const key=[p.sport,eventIdentity(p),p.playerKey ?? null,p.marketType,p.side,p.line ?? null,p.modelVersion,p.modelMode];
  if(scopedSport(p.sport)) key.push(scopeIdentity(p));
  return JSON.stringify(key);
}

/** Pure normalization: capture-time eligibility never ages with a later report. */
export function normalizePrediction(input, { now = new Date().toISOString() } = {}) {
  const p = {};
  for (const key of ['id','sourceKey','sport','eventKey','playerKey','marketType','side','modelVersion','modelMode','book','probabilityBasis','competitionKey','tour']) p[key] = text(input[key]);
  for (const key of ['line','odds','modelProbability','marketProbability','pushProbability']) p[key] = number(input[key]);
  for (const key of ['capturedAt','startsAt','quoteAt']) p[key] = time(input[key]);
  p.eligibilityStartsAt = time(input.eligibilityStartsAt ?? input.startsAt);
  if (p.startsAt && p.eligibilityStartsAt && Date.parse(p.startsAt) < Date.parse(p.eligibilityStartsAt)) p.eligibilityStartsAt = p.startsAt;
  p.modelAvailable = input.modelAvailable === true;
  p.marketScope = structuredClone(input.marketScope ?? null);
  p.settlementRule = structuredClone(input.settlementRule ?? null);
  p.sourceIds = structuredClone(input.sourceIds ?? {});
  p.provenance = structuredClone(input.provenance ?? {});
  const reasons = new Set(Array.isArray(input.eligibilityReasons) ? input.eligibilityReasons.filter(x => typeof x === 'string') : []);
  for (const [key, reason] of [['sourceKey','MISSING_SOURCE_KEY'],['eventKey','MISSING_EVENT_KEY'],['marketType','MISSING_MARKET_TYPE'],['side','MISSING_SIDE'],['modelVersion','MISSING_MODEL_VERSION']]) if (!p[key]) reasons.add(reason);
  if (!PERFORMANCE_SPORTS.includes(p.sport)) reasons.add('INVALID_SPORT');
  if(scopedSport(p.sport)) {
    if(!p.competitionKey) reasons.add('INVALID_COMPETITION_SCOPE');
    if(p.sport==='TENNIS') {
      if(!['ATP','WTA'].includes(p.tour)) reasons.add('INVALID_TOUR');
      const scope=p.marketScope;
      if(scope?.period!=null || (scope?.unit==='MATCH' && (scope.set!=null || scope.game!=null)) || (scope?.unit==='SET' && scope.game!=null)) reasons.add('INVALID_MARKET_SCOPE');
      if(!['MATCH','SET','GAME'].includes(scope?.unit) || (scope.unit!=='MATCH' && !(Number.isSafeInteger(scope.set)&&scope.set>0)) || (scope.unit==='GAME' && !(Number.isSafeInteger(scope.game)&&scope.game>0))) reasons.add('INVALID_MARKET_SCOPE');
      if(!['BEST_OF_3','BEST_OF_5'].includes(p.settlementRule?.format)||!['VOID','ACTION'].includes(p.settlementRule?.retirement)||!['VOID','ACTION'].includes(p.settlementRule?.walkover)) reasons.add('UNKNOWN_TENNIS_POLICY');
    } else if(p.marketScope?.unit!=null || p.marketScope?.set!=null || p.marketScope?.game!=null || !(p.sport==='SOCCER'?['REGULATION','INCLUDING_EXTRA_TIME']:['REGULATION','INCLUDING_OVERTIME_SHOOTOUT']).includes(p.marketScope?.period)) reasons.add('INVALID_MARKET_SCOPE');
  }
  if (!['LIVE','SHADOW'].includes(p.modelMode)) reasons.add('INVALID_MODEL_MODE');
  if (!text(p.sourceIds.event)) reasons.add('MISSING_SOURCE_EVENT_ID');
  if (p.marketType?.startsWith('player_') && (!p.playerKey || !text(p.sourceIds.player))) reasons.add('MISSING_PLAYER_KEY');
  if (p.marketType !== 'moneyline' && p.line === null) reasons.add('MISSING_MARKET_LINE');
  if (input.provenance?.identityAmbiguous === true) reasons.add('AMBIGUOUS_IDENTITY');
  if (!p.modelAvailable) reasons.add('MODEL_UNAVAILABLE');
  for (const [key,reason] of [['modelProbability','INVALID_MODEL_PROBABILITY'],['marketProbability','INVALID_MARKET_PROBABILITY']]) if (p[key] === null || p[key] < 0 || p[key] > 1) reasons.add(reason);
  if (p.pushProbability !== null && (p.pushProbability < 0 || p.pushProbability > 1)) reasons.add('INVALID_PUSH_PROBABILITY');
  if (!['CONDITIONAL_NO_PUSH','UNCONDITIONAL'].includes(p.probabilityBasis)) reasons.add('UNKNOWN_PROBABILITY_BASIS');
  if (p.probabilityBasis === 'UNCONDITIONAL' && p.pushProbability !== null && p.modelProbability + p.pushProbability > 1) reasons.add('INVALID_PROBABILITY_MASS');
  if (!p.settlementRule?.version) reasons.add('MISSING_SETTLEMENT_RULE');
  const capture = Date.parse(p.capturedAt), start = Date.parse(p.eligibilityStartsAt), quote = Date.parse(p.quoteAt);
  if (!Number.isFinite(capture)) reasons.add('INVALID_CAPTURE_TIME');
  if (!Number.isFinite(start)) reasons.add('INVALID_START_TIME');
  if (capture >= start) reasons.add('POST_START_CAPTURE');
  if (capture > Date.parse(now)) reasons.add('FUTURE_CAPTURE');
  if (!Number.isFinite(quote)) reasons.add('UNKNOWN_QUOTE_AGE');
  else if (quote > capture) reasons.add('FUTURE_QUOTE');
  else {
    // Same market-component targets used by market-card and player-prop-card.
    const minutes = (start - capture) / 60000;
    const maxAge = minutes <= 20 ? 2 : minutes <= 90 ? 5 : minutes <= 360 ? 15 : 30;
    if ((capture - quote) / 60000 > maxAge) reasons.add('STALE_QUOTE');
  }
  p.eligibilityReasons = [...reasons].sort();
  return {...p,sourceKey:text(input.sourceKey),startsAt:time(input.startsAt)};
}
