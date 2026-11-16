// Read-only source evidence for the seven unresolved NBA games. No database or
// model imports. JWT signature verification is required at the Supabase gateway.
const EVENT_IDS=Object.freeze([
  'BDgz9hcfzcEGwQDlPcLM','Vr1VbRYZaiOVKjBTTK6W','lifymi4jrXCpckkBVDDC',
  'eZJHrEb25QaGPXmVUaF0','OeymLe7wQY2zwKedvCrU','P85upZIi5P758SI7lZPk',
  'ViYMGlG1xRWQ2J4jAhph'
]);
const ALLOWED_IDS=new Set(EVENT_IDS);
const EVENT_FIELDS=['eventID','status','teams','players','results','info','type','leagueID'];
const PRIVATE_KEYS=new Set(['odds','metadata','meta','headers','authorization','apikey','accesstoken','refreshtoken','secret','token','__proto__','constructor','prototype']);
const sourceUrl=eventID=>'https://api.sportsgameodds.com/v2/events?'+new URLSearchParams({
  eventIDs:eventID,expandResults:'true',limit:'1',leagueID:'NBA',type:'match',oddID:'points-home-game-ml-home'
});
const reply=(body,status)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const fail=code=>{throw Error(code);};

function isServiceRole(authorization){
  const match=/^Bearer ([A-Za-z0-9_-]+={0,2})\.([A-Za-z0-9_-]+={0,2})\.([A-Za-z0-9_-]+={0,2})$/.exec(authorization||'');
  if(!match)return false;
  try{
    const decode=value=>JSON.parse(atob(value.replace(/-/g,'+').replace(/_/g,'/')));
    const header=decode(match[1]),claims=decode(match[2]);
    return header?.alg==='HS256'&&claims?.role==='service_role';
  }catch{return false;}
}

async function readBytes(response,maxBytes,signal,errorCode){
  const length=Number(response.headers.get('content-length'));
  if(Number.isFinite(length)&&length>maxBytes)fail(errorCode);
  const reader=response.body?.getReader();
  if(!reader)return new Uint8Array();
  const cancel=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  const chunks=[];let size=0;
  try{
    for(;;){
      if(signal.aborted)fail('NBA_SOURCE_TIMEOUT');
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>maxBytes){cancel();fail(errorCode);}
      chunks.push(value);
    }
    if(signal.aborted)fail('NBA_SOURCE_TIMEOUT');
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return bytes;
  }finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
}

async function validateBody(req,signal){
  try{
    const bytes=await readBytes(req,256,signal,'NBA_AUDIT_INVALID_BODY');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    const body=JSON.parse(text);
    if(!body||Array.isArray(body)||typeof body!=='object')fail('NBA_AUDIT_INVALID_BODY');
    const keys=Object.keys(body);
    if(keys.length===1&&keys[0]==='eventID'&&ALLOWED_IDS.has(body.eventID))return body.eventID;
  }catch(error){if(signal.aborted)throw error;}
  fail('NBA_AUDIT_INVALID_BODY');
}

function sanitizeEvidence(value,apiKey,depth=0){
  if(depth>40)fail('NBA_SOURCE_INVALID_EVENTS');
  if(typeof value==='string')return value.split(apiKey).join('[REDACTED]');
  if(Array.isArray(value))return value.map(item=>sanitizeEvidence(item,apiKey,depth+1));
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.entries(value)
      .filter(([key])=>!PRIVATE_KEYS.has(key.toLowerCase().replace(/[-_]/g,''))&&!key.includes(apiKey))
      .map(([key,item])=>[key,sanitizeEvidence(item,apiKey,depth+1)]));
  }
  return value;
}

/** Pure allowlist projection; identity ambiguity rejects the whole response. */
export function projectNbaOutcomeEvidence(body,apiKey,eventID){
  if(!apiKey||!ALLOWED_IDS.has(eventID))fail('NBA_SOURCE_INVALID_EVENTS');
  if(body?.success!==true)fail('NBA_SOURCE_INVALID_SUCCESS');
  if(!Array.isArray(body.data))fail('NBA_SOURCE_INVALID_EVENTS');
  if(body.nextCursor!=null&&typeof body.nextCursor!=='string')fail('NBA_SOURCE_INVALID_EVENTS');
  const paginationCursorPresent=typeof body.nextCursor==='string'&&body.nextCursor!=='';
  const seen=new Set();
  const events=body.data.map(event=>{
    if(!event||event.eventID!==eventID)fail('NBA_SOURCE_UNEXPECTED_ID');
    if(seen.has(event.eventID))fail('NBA_SOURCE_DUPLICATE_ID');
    if(event.leagueID!=='NBA')fail('NBA_SOURCE_INVALID_LEAGUE');
    seen.add(event.eventID);
    return sanitizeEvidence(Object.fromEntries(EVENT_FIELDS.filter(key=>Object.hasOwn(event,key)).map(key=>[key,event[key]])),apiKey);
  });
  if(paginationCursorPresent&&!seen.has(eventID))fail('NBA_SOURCE_PAGINATED_MISSING_EVENT');
  // A cursor cannot hide another requested event: exactly one ID was requested,
  // and duplicate/unexpected IDs were rejected before reaching this point.
  return {events,missingEventIDs:seen.has(eventID)?[]:[eventID],paginationCursorPresent};
}

async function collectEvidence({apiKey,eventID,fetchImpl,clock,cryptoImpl,signal}){
  if(typeof apiKey!=='string'||!apiKey.trim())fail('NBA_SOURCE_CONFIGURATION');
  const url=sourceUrl(eventID);let response;
  try{response=await fetchImpl(url,{method:'GET',headers:{accept:'application/json','x-api-key':apiKey},redirect:'error',signal});}
  catch{fail(signal.aborted?'NBA_SOURCE_TIMEOUT':'NBA_SOURCE_FETCH_FAILED');}
  if(!response.ok)fail('NBA_SOURCE_HTTP_'+response.status);
  const bytes=await readBytes(response,4*1024*1024,signal,'NBA_SOURCE_TOO_LARGE');
  const receivedAt=clock();
  if(typeof receivedAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(receivedAt)||!Number.isFinite(Date.parse(receivedAt)))fail('NBA_SOURCE_INVALID_CLOCK');
  let body;
  try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('NBA_SOURCE_INVALID_JSON');}
  const projected=projectNbaOutcomeEvidence(body,apiKey,eventID);
  const rawSha256=Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  return {
    ok:true,schemaVersion:'nba-outcome-source-evidence-v1',
    source:{provider:'SportsGameOdds',url,requestedEventIDs:[eventID],receivedAt,rawSha256,rawBytes:bytes.byteLength,eventCount:projected.events.length,missingEventIDs:projected.missingEventIDs,paginationCursorPresent:projected.paginationCursorPresent},
    events:projected.events
  };
}

/** Fixed evidence request only. Signature authentication belongs to the gateway. */
export async function handleNbaOutcomeSourceRequest(req,{
  apiKey,fetchImpl=fetch,clock=()=>new Date().toISOString(),cryptoImpl=globalThis.crypto
}={}){
  if(req.method!=='POST')return reply({ok:false,error:'POST_REQUIRED'},405);
  if(!isServiceRole(req.headers.get('authorization')))return reply({ok:false,error:'SERVICE_AUTHENTICATION_REQUIRED'},401);
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('NBA_SOURCE_TIMEOUT'));},12000);});
  try{
    const work=(async()=>{
      const eventID=await validateBody(req,controller.signal);
      return collectEvidence({apiKey,eventID,fetchImpl,clock,cryptoImpl,signal:controller.signal});
    })();
    return reply(await Promise.race([work,deadline]),200);
  }catch(error){
    const code=/^(NBA_AUDIT_INVALID_BODY|NBA_SOURCE_(?:HTTP_\d{3}|TOO_LARGE|INVALID_JSON|INVALID_EVENTS|INVALID_SUCCESS|UNEXPECTED_ID|DUPLICATE_ID|INVALID_LEAGUE|PAGINATED_MISSING_EVENT|INVALID_CLOCK|TIMEOUT|FETCH_FAILED|CONFIGURATION))$/.test(error?.message||'')?error.message:'NBA_SOURCE_FETCH_FAILED';
    return reply({ok:false,error:code},code==='NBA_AUDIT_INVALID_BODY'?400:code==='NBA_SOURCE_CONFIGURATION'?503:502);
  }finally{clearTimeout(timer);}
}

