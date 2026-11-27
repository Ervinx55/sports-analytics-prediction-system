// The recommendation journal is service-only. This endpoint publishes only
// explicitly opted-in card fields; it never publishes conversation evidence,
// tickets, model approvals, or a claim that a recorded price is still available.
const CONTRACT='edge-reviewed-picks-v1';
const LIMIT=500;
const sports=new Set(['NBA','NFL','NHL','MLB','CFB','NCAAF']);
const decisions=new Set(['BUY','AVOID','PASS','WATCH','REVERSED','SELECT_RESEARCH','SELECT_RESEARCH_PRICE_CONDITIONAL','RETAIN','REPORTED_SELECTION']);
const props=new Set(['points','rebounds','assists','threes','points_assists','points_rebounds','rebounds_assists','points_rebounds_assists','pra','rushing_yards','receiving_yards','passing_yards','receptions','passing_attempts','rushing_attempts']);
const teams=new Set(['moneyline','spread','total']);
const scopes=new Set(['FULL_GAME','FIRST_HALF','SECOND_HALF','FIRST_QUARTER','SECOND_QUARTER','THIRD_QUARTER','FOURTH_QUARTER']);
const text=(value,max=160)=>typeof value==='string'&&value.trim()&&value.length<=max?value.trim():null;
const id=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):typeof value==='string'&&/^[1-9]\d{0,19}$/.test(value)?value:null;
const timestamp=value=>typeof value==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const odds=value=>Number.isInteger(value)&&Math.abs(value)>=100&&Math.abs(value)<=100000?value:null;
const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const identity=row=>JSON.stringify([row.sport,row.event_id,timestamp(row.starts_at),row.player_id??null,row.market_type,row.market_scope]);
const newer=(a,b)=>Date.parse(a.recorded_at)-Date.parse(b.recorded_at)||(BigInt(id(a.id))-BigInt(id(b.id))>0n?1:BigInt(id(a.id))===BigInt(id(b.id))?0:-1);

function validRow(row,sport,date,now){
 const p=row?.publication,issued=timestamp(row?.issued_at),recorded=timestamp(row?.recorded_at),start=timestamp(row?.starts_at);
 if(!id(row?.id)||row.sport!==sport||row.record_kind!=='recommendation'||row.provenance!=='conversation'||
   p?.surface!==CONTRACT||p?.visibility!=='public'||!issued||!recorded||!start||Date.parse(issued)>now||Date.parse(recorded)>now||Date.parse(issued)>Date.parse(recorded)||day(start)!==date||
   !text(row.event_id)||!scopes.has(row.market_scope)||!decisions.has(row.decision)||!text(row.book)||!odds(row.odds))return false;
 if(props.has(row.market_type))return Boolean(text(row.player_id)&&text(row.player_name)&&['OVER','UNDER'].includes(row.side)&&typeof row.line==='number'&&Number.isFinite(row.line)&&row.line>=0);
 if(!teams.has(row.market_type)||row.player_id)return false;
 if(row.market_type==='moneyline')return ['HOME','AWAY'].includes(row.side)&&row.line==null;
 if(row.market_type==='spread')return ['HOME','AWAY'].includes(row.side)&&typeof row.line==='number'&&Number.isFinite(row.line);
 return ['OVER','UNDER'].includes(row.side)&&typeof row.line==='number'&&Number.isFinite(row.line)&&row.line>=0;
}

export function projectReviewedPicks(rows,{sport='NBA',now=Date.now(),amendments=[]}={}){
 const date=day(now),candidates=rows.filter(row=>validRow(row,sport,date,now));
 const byId=new Map(candidates.map(row=>[id(row.id),row])),removed=new Set(),invalid=new Set();
 for(const row of [...candidates,...amendments]){
  const previous=id(row?.previous_decision_id);if(!previous)continue;
  const prior=byId.get(previous);if(!prior)continue;
  const stamp=timestamp(row.recorded_at);
  if(!id(row.id)||!stamp||Date.parse(stamp)>now||row.record_kind!=='recommendation'||row.provenance!=='conversation'||identity(row)!==identity(prior)||newer(row,prior)<=0){invalid.add(id(row.id));continue;}
  removed.add(previous);
 }
 const latest=new Map();
 for(const row of candidates){
  if(invalid.has(id(row.id)))continue;
  const key=JSON.stringify([identity(row),row.side,row.line??null,row.book]);
  if(!latest.has(key)||newer(row,latest.get(key))>0)latest.set(key,row);
 }
 // Select the newest capture before suppressing withdrawals. Otherwise an old
 // duplicate BUY could reappear when its latest capture was withdrawn.
 const picks=[...latest.values()].filter(row=>!removed.has(id(row.id))).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at)||newer(b,a)).map(row=>({
  id:id(row.id),sport:row.sport,eventId:row.event_id,startsAt:timestamp(row.starts_at),playerId:row.player_id??null,playerName:row.player_name??null,
  marketType:row.market_type,marketScope:row.market_scope,side:row.side,line:row.line??null,book:row.book,odds:row.odds,decision:row.decision,
  issuedAt:timestamp(row.issued_at),recordedAt:timestamp(row.recorded_at),sourceLabel:'Manual review',
  matchup:text(row.publication.matchup),priceLimit:odds(row.publication.priceLimit),reviewNote:text(row.publication.reviewNote,500)
 }));
 return {contract:CONTRACT,generatedAt:new Date(now).toISOString(),date,timezone:'America/Chicago',sport,picks};
}

export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'GET required',picks:[]});}
 const sport=String(req.query?.sport??'NBA').toUpperCase();
 if(!sports.has(sport))return res.status(400).json({error:'Unsupported sport',picks:[]});
 const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key)return res.status(503).json({error:'Reviewed picks unavailable',picks:[]});
 const now=Date.now(),date=day(now),midnight=Date.parse(date+'T00:00:00Z');
 const base=(process.env.SUPABASE_URL||'https://yeoxroijaptomomshdii.supabase.co').replace(/\/$/,'');
 const headers={accept:'application/json',apikey:key};if(key.startsWith('eyJ'))headers.Authorization='Bearer '+key;
 const read=async parameters=>{
  const url=new URL(base+'/rest/v1/edge_decision_journal_v1');
  for(const [name,value] of Object.entries(parameters))url.searchParams.set(name,value);
  const response=await fetch(url,{headers,cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Read unavailable');
  const rows=await response.json();if(!Array.isArray(rows)||rows.length>LIMIT)throw Error('Incomplete read');return rows;
 };
 try{
  const common={sport:'eq.'+sport,record_kind:'eq.recommendation',provenance:'eq.conversation',limit:String(LIMIT+1)};
  const rows=await read({...common,
   select:'id,recorded_at,issued_at,sport,event_id,starts_at,player_id,player_name,market_type,market_scope,side,line,odds,book,decision,previous_decision_id,record_kind,provenance,publication:context->publication',
   'context->publication->>visibility':'eq.public','context->publication->>surface':'eq.'+CONTRACT,
   // Chicago midnight is UTC05 or UTC06; a narrow envelope covers both DST
   // boundaries. The projection applies the exact local date independently.
   and:`(starts_at.gte.${new Date(midnight+5*3600000).toISOString()},starts_at.lt.${new Date(midnight+30*3600000).toISOString()})`,
   order:'recorded_at.desc,id.desc'
  });
  const ids=rows.map(row=>id(row?.id)).filter(Boolean);
  // A later private amendment must still remove its public predecessor. Read
  // only the identity/link metadata needed for that removal, never its contents.
  const amendments=ids.length?await read({...common,select:'id,previous_decision_id,recorded_at,sport,event_id,starts_at,player_id,market_type,market_scope,record_kind,provenance',previous_decision_id:'in.('+ids.join(',')+')'}):[];
  return res.status(200).json(projectReviewedPicks(rows,{sport,now,amendments}));
 }catch{return res.status(503).json({error:'Reviewed picks unavailable',picks:[]});}
}
