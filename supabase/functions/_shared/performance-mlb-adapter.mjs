import { normalizePrediction } from './performance-contract.mjs';
export const MLB_TABLES = ['model_audit_observations','market_grade_observations','player_prop_observations'];
const numeric = v => (typeof v === 'number' || typeof v === 'string' && v.trim()) && Number.isFinite(Number(v)) ? Number(v) : null;
const official = v => numeric(v) !== null && Number.isSafeInteger(Number(v)) && Number(v) > 0 ? String(Number(v)) : null;
export function adaptLegacyObservation(row, kind) {
  if (!MLB_TABLES.includes(kind) || !official(row.id)) throw new Error('Unsupported observation identity');
  const prop = kind === 'player_prop_observations', audit = kind === 'model_audit_observations';
  const raw = row.raw ?? {}, event = official(row.game_pk), player = prop ? official(row.mlb_player_id) : null;
  const modelProbability = numeric(audit ? row.final_probability : row.model_probability);
  const marketProbability = numeric(row.market_fair_probability) ?? (audit && modelProbability !== null && numeric(row.edge_pct_points) !== null ? modelProbability - Number(row.edge_pct_points)/100 : null);
  const originalDecision = prop ? row.status ?? null : audit ? row.verification_status ?? row.model_decision ?? null : row.non_sharp_status ?? row.status ?? null;
  return normalizePrediction({
    sourceKey: `${kind}:${row.id}`, sport:'MLB', eventKey:event ? `mlb:${event}` : null,
    playerKey:player ? `mlb:${player}` : null, marketType:prop ? `player_${row.stat_id ?? 'unknown'}` : audit ? 'moneyline' : row.market_type,
    side:prop ? row.side : audit ? row.side_key : row.market_side, line:row.line ?? null,
    modelVersion:row.model_version, modelMode:'LIVE', modelAvailable:modelProbability !== null,
    capturedAt:row.captured_at, startsAt:row.starts_at, eligibilityStartsAt:raw.originalStartsAt ?? row.starts_at,
    quoteAt:raw.quoteAt ?? null, odds:row.best_odds, book:row.best_book,
    modelProbability, marketProbability, pushProbability:row.push_probability ?? raw.pushProbability ?? null,
    probabilityBasis:raw.probabilityBasis ?? null, settlementRule:raw.settlementRule ?? null,
    eligibilityReasons:!prop && row.market_type !== "moneyline" && numeric(raw.quoteLine) !== null && numeric(raw.quoteLine) !== numeric(row.line) ? ["QUOTE_LINE_MISMATCH"] : [],
    sourceIds:{provider:"mlb-statsapi",event,player,oddsEvent:row.event_id ?? null,oddsPlayer:row.player_id ?? null,observation:String(row.id),table:kind},
    provenance:{table:kind,observationId:row.id,statId:row.stat_id ?? null,resultReference:{table:prop?"player_prop_results":audit?"candidate_grades":"team_market_results",observationId:row.id,foreignKey:audit?"audit_id":"observation_id"},originalDecision,legacyReconstructed:raw.performanceCapture !== true,raw:structuredClone(raw)},
  }, {now:row.captured_at});
}
export function qualifiedDecision(prediction, gateEvidence, issuedAt) {
  const p = normalizePrediction(prediction,{now:issuedAt});
  const issued=Date.parse(issuedAt), start=Date.parse(p.eligibilityStartsAt), capture=Date.parse(p.capturedAt), quote=Date.parse(p.quoteAt);
  const minutes=(start-issued)/60000, maxAge=minutes<=20 ? 2 : minutes<=90 ? 5 : minutes<=360 ? 15 : 30;
  if(!prediction.id || gateEvidence?.finalQualification !== true || gateEvidence.status !== 'PLAY' || p.modelMode !== 'LIVE' || p.eligibilityReasons.length || !p.book || p.odds === null || Math.abs(p.odds)<100 || !Number.isFinite(issued) || issued<capture || issued>=start || !Number.isFinite(quote) || quote>issued || (issued-quote)/60000>maxAge) return null;
  return {sourceKey:`${p.sourceKey}:final`,predictionId:prediction.id,issuedAt,status:'PLAY',qualified:true,evidence:structuredClone(gateEvidence),legacyReconstructed:false};
}
export function serviceAuthorized(header, secret) { return typeof secret === 'string' && secret.length>0 && header === `Bearer ${secret}`; }
export async function capturePersistedRows(client, rows, kind, expectedCount=rows.length) {
  const faults=[]; let tracked=0;
  if(rows.length !== expectedCount) faults.push({sourceTable:kind,error:`Original persistence IDs incomplete: received ${rows.length} of ${expectedCount}`});
  for(const row of rows) {
    try {const payload=adaptLegacyObservation(row,kind); const {error}=await client.rpc('ingest_prediction_v1',{payload}); if(error) throw error; tracked++;}
    catch(error) {faults.push({sourceKey:`${kind}:${row.id}`,error:error.message ?? String(error)});}
  }
  return {tracked,faults};
}
export async function importHistoryPage({table,cursor=0,fetchPage,write,dryRun=false}) {
  if(!MLB_TABLES.includes(table) || !Number.isSafeInteger(cursor) || cursor<0) throw Error('Invalid import cursor/table');
  const rows=await fetchPage(table,cursor,500);
  if(!Array.isArray(rows) || rows.length>500) throw Error('Incomplete or invalid page response');
  let last=cursor; const exclusions={};
  for(const row of rows) {
    if(!official(row.id) || Number(row.id)<=last) throw Error('Import page must be ordered by increasing ID');
    const p=adaptLegacyObservation(row,table); for(const reason of p.eligibilityReasons) exclusions[reason]=(exclusions[reason]??0)+1;
    if(!dryRun) await write(p); last=Number(row.id);
  }
  return {table,cursor,nextCursor:last,count:rows.length,complete:rows.length<500,dryRun,exclusions};
}
export function publicationState(card, publication, {enabled=false,kind='market_grade_observations',now=new Date().toISOString()}={}) {
  if(!enabled || card.status !== 'PLAY') return card;
  const p=publication?.prediction;
  const matches=publication?.qualified === true && publication.status==='PLAY' && publication.legacy_reconstructed===false && p?.source_key===`${kind}:${card.id}` && numeric(p.odds)===numeric(card.best_odds) && p.book===card.best_book;
  if(matches) return {...card,tracking:{tracked:true,decisionId:publication.id,predictionId:publication.prediction_id,issuedAt:publication.issued_at}};
  const finalWindow=Date.parse(card.starts_at)-Date.parse(now)<=20*60000;
  return {...card,status:finalWindow?'PASS':'PENDING',reason:`${card.reason ?? ''} Final qualification publication is not recorded for this snapshot and price.`,tracking:{tracked:false,fault:'PUBLICATION_NOT_READY'}};
}
/** Authenticated callers supply freshly evaluated cards; never accepts qualification from HTTP bodies. */
export async function reconcilePublications(client,cards,kind,{publish=false,now=new Date().toISOString()}={}) {
  const qualified=cards.filter(card=>card.status==='PLAY');
  const publications=new Map(),faults=[];
  for(let offset=0;offset<qualified.length;offset+=500) {
    const keys=qualified.slice(offset,offset+500).map(card=>`${kind}:${card.id}`);
    const {data,error}=await client.from('performance_decisions').select('*,prediction:performance_predictions!inner(*)').in('prediction.source_key',keys).eq('qualified',true).eq('legacy_reconstructed',false);
    if(error) {faults.push({error:error.message??String(error)});continue;}
    for(const decision of data??[]) publications.set(decision.prediction.source_key,decision);
  }
  for(const card of qualified) {
    const sourceKey=`${kind}:${card.id}`;
    if(publish && !publications.has(sourceKey)) {
      try {
        const prediction=adaptLegacyObservation(card,kind);
        const evidence={status:card.status,finalQualification:true,freshness:card.freshness,sharpGate:card.sharpGate??null,verificationGate:card.verificationGate??null,weatherParkImpact:card.weatherParkImpact??null,qualificationVersion:'mlb-existing-final-gates-v1',quoteAgeMinutes:prediction.quoteAt ? (Date.parse(now)-Date.parse(prediction.quoteAt))/60000 : null};
        if(!qualifiedDecision({...prediction,id:'pending'},evidence,now)) throw Error('Snapshot lacks eligible contemporary prediction, price or quote provenance');
        const {data,error}=await client.rpc('publish_mlb_performance_v1',{payload:{prediction,evidence,issuedAt:now}});
        if(error) throw error;
        // Transaction returned only after prediction and qualification are both durable.
        publications.set(sourceKey,{...data,prediction:{source_key:sourceKey,odds:prediction.odds,book:prediction.book}});
      } catch(error) {faults.push({sourceKey,error:error.message??String(error)});}
    }
  }
  const rows=cards.map(card=>publicationState(card,publications.get(`${kind}:${card.id}`),{enabled:true,kind,now}));
  return {rows,faults};
}
