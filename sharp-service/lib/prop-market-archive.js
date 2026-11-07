/**
 * Append-only research quote archive. Verified real-time observations only.
 * This does NOT backfill historical model probabilities or authorize BUY decisions.
 * Enabled explicitly via EDGE_LAB_PROP_ARCHIVE_ENABLED=true.
 */
const STALE_LIMIT = 15 * 60_000;
const LIMIT = 200;
const valid = x => typeof x === 'number' && Number.isFinite(x);
const positiveInt = x => typeof x === 'string' && x.trim().length > 0;
const normalizeOdds = x => {
  const n = Number(x);
  return Number.isInteger(n) && (n <= -100 || n >= 100) ? n : null;
};
const iso = x => {
  const t = Date.parse(x || '');
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const nowMs = () => Date.now();

export function mapNbaArchiveQuotes(events, { now=nowMs() } = {}) {
  const rows = [];
  for (const e of events || []) {
    if (!e || e.league !== 'NBA' || !e.eventID) continue;
    const starts = iso(e.startsAt);
    if (!starts || Date.parse(starts) <= now + 10_000) continue;
    for (const p of e.players || []) {
      const prop = p.prop || {};
      const playerId = prop.espnPlayerID && prop.identityStatus === 'ROSTER_MATCHED'
        ? String(prop.espnPlayerID) : prop.playerID ? String(prop.playerID) : null;
      if (!playerId || !positiveInt(prop.playerName) || !positiveInt(prop.statID)) continue;
      for (const side of ['over','under']) {
        for (const [book, quote] of Object.entries(prop[side]?.books || {})) {
          const odds = normalizeOdds(quote.odds);
          const quoteAt = iso(quote.updatedAt);
          if (odds === null || !valid(Number(quote.line)) || Number(quote.line) < 0 ||
            quote.quoteState !== 'OBSERVED' || !quoteAt ||
            Date.parse(quoteAt)>now || now-Date.parse(quoteAt)>STALE_LIMIT ||
            Date.parse(quoteAt)>=Date.parse(starts)) continue;
          rows.push({
            sport:'NBA',event_id:String(e.eventID),event_starts_at:starts,
            player_id:playerId,player_name:String(prop.playerName),
            stat_id:String(prop.statID),side,line:Number(quote.line),book,
            american_odds:odds,source:String(e.provider || 'ODDS_PROVIDER'),
            source_quote_at:quoteAt,model_version:null,pregame_model_probability:null,
            prediction_observed_at:null,is_production_model:false,
            provenance:'LIVE_PROVIDER_OBSERVATION',raw:{
              quoteState:quote.quoteState,identityStatus:prop.identityStatus||null,
              providerEventID:e.providerEventID||null
            }
          });
        }
      }
    }
  }
  return unique(rows).slice(0,LIMIT);
}
export function mapNflArchiveQuotes(candidates, { now=nowMs() } = {}) {
  const rows=[];
  for (const c of candidates || []) {
    const starts=iso(c.startsAt),quoteAt=iso(c.updatedAt);
    const odds=normalizeOdds(c.odds);
    if(!starts || !quoteAt || Date.parse(starts)<=now+10_000 ||
      Date.parse(quoteAt)>now || now-Date.parse(quoteAt)>STALE_LIMIT ||
      Date.parse(quoteAt)>=Date.parse(starts) || !c.eventID || !c.playerID ||
      !positiveInt(c.playerName) || !positiveInt(c.statID) ||
      !['over','under'].includes(c.side) || !positiveInt(c.book) ||
      odds===null || !valid(c.line) || c.line<0) continue;
    rows.push({
      sport:'NFL',event_id:String(c.eventID),event_starts_at:starts,
      player_id:String(c.playerID),player_name:String(c.playerName),
      stat_id:String(c.statID),side:c.side,line:c.line,book:c.book,
      american_odds:odds,source:'ODDS_PROVIDER_OBSERVED',
      source_quote_at:quoteAt,model_version:null,pregame_model_probability:null,
      prediction_observed_at:null,is_production_model:false,
      provenance:'LIVE_PROVIDER_OBSERVATION',raw:{
        dataQuality:c.dataQuality||null,shadowStatus:c.shadowStatus||null,
        productionEligible:false
      }
    });
  }
  return unique(rows).slice(0,LIMIT);
}
function unique(rows){
  const seen=new Set();
  return rows.filter(r=>{
    const k=[r.sport,r.event_id,r.player_id,r.stat_id,r.side,r.line,r.book,r.source_quote_at].join('|');
    if(seen.has(k))return false;seen.add(k);return true;
  });
}
/**
 * Fail open for the original odds endpoint, fail closed for data integrity.
 * No secrets are returned. Only enabled from trusted Vercel environment.
 */
export async function capturePropResearchRows(rows, {
  env=process.env, fetcher=fetch, timeoutMs=4500
}={}) {
  if(env.EDGE_LAB_PROP_ARCHIVE_ENABLED!=='true')return {status:'DISABLED',count:0};
  const url=env.SUPABASE_URL,token=env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url || !token)return {status:'NOT_CONFIGURED',count:0};
  if(!Array.isArray(rows)||!rows.length)return {status:'NO_FRESH_VERIFIED_QUOTES',count:0};
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeoutMs);
  try{
    const endpoint=url.replace(/\/$/,'')+
      '/rest/v1/rpc/edge_lab_prop_ingest_v1';
    const response=await fetcher(endpoint,{
      method:'POST',signal:abort.signal,redirect:'error',cache:'no-store',
      headers:{
        apikey:token,Authorization:'Bearer '+token,
        'Content-Type':'application/json','Accept':'application/json'
      },body:JSON.stringify({p_rows: rows.slice(0,LIMIT)})
    });
    if(!response.ok)return {status:'ARCHIVE_UNAVAILABLE',count:0};
    const data = typeof response.json === 'function' ? await response.json() : null;
    return {status:'CAPTURED_OR_DUPLICATE',count:Number.isInteger(data?.inserted)?data.inserted:0};
  }catch{return {status:'ARCHIVE_UNAVAILABLE',count:0}}
  finally{clearTimeout(timer)}
}
