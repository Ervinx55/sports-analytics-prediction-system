import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../sharp-service/api/dashboard.js';
import {projectReviewedPicks} from '../../sharp-service/handlers/reviewed-picks.js';

const NOW=Date.parse('2026-11-27T20:30:00.000Z');
const stamp=offset=>new Date(NOW+offset).toISOString();
const published={surface:'edge-reviewed-picks-v1',visibility:'public',matchup:'Philadelphia at Indiana',priceLimit:-120,reviewNote:'Only the reviewed line at the stated price limit.'};
const row=(patch={})=>({id:101,recorded_at:stamp(-1000),issued_at:stamp(-600000),sport:'NBA',event_id:'sgo:pacers',starts_at:'2026-11-28T00:30:00.000Z',player_id:'ANDREW_NEMBHARD_1_NBA',player_name:'Andrew Nembhard',market_type:'points_assists',market_scope:'FULL_GAME',side:'OVER',line:23.5,odds:-115,book:'betrivers',decision:'BUY',previous_decision_id:null,record_kind:'recommendation',provenance:'conversation',publication:published,...patch});
const response=()=>({headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
function setup(t,rows){
 const saved=process.env.SUPABASE_SECRET_KEY;process.env.SUPABASE_SECRET_KEY='test-only-private-key';
 t.after(()=>{if(saved===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=saved;});
 t.mock.method(Date,'now',()=>NOW);
 const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url:String(url),options});return Response.json(rows);});
 return calls;
}
async function invoke(query={},method='GET'){const res=response();await handler({method,query:{reviewedPicks:'1',sport:'NBA',...query}},res);return res;}

test('published manual BUY reaches its own feed even without an automated model approval',async t=>{
 setup(t,[row()]);const res=await invoke();
 assert.equal(res.code,200);assert.equal(res.body.contract,'edge-reviewed-picks-v1');
 assert.equal(res.body.date,'2026-11-27');assert.equal(res.body.timezone,'America/Chicago');
 assert.equal(res.headers['Cache-Control'],'no-store');
 assert.deepEqual(res.body.picks.map(p=>[p.playerName,p.marketType,p.side,p.line,p.book,p.odds,p.priceLimit,p.sourceLabel]),[['Andrew Nembhard','points_assists','OVER',23.5,'betrivers',-115,-120,'Manual review']]);
 assert.equal(res.body.picks[0].decision,'BUY');
 for(const name of ['approvalId','productionEligible','productionWeight','modelProbability'])assert.ok(!Object.hasOwn(res.body.picks[0],name));
});

test('private journal records and raw evidence never appear in the public response',async t=>{
 const privateText='private conversation and ticket details';
 const calls=setup(t,[row({context:{privateText},evidence:{privateText},source_reference:privateText}),row({id:102,publication:null}),row({id:103,publication:{...published,visibility:'private'}}),row({id:104,record_kind:'documented_ticket'}),row({id:105,provenance:'historical_backfill'})]);
 const res=await invoke();assert.equal(res.code,200);assert.deepEqual(res.body.picks.map(p=>p.id),['101']);
 assert.ok(!JSON.stringify(res.body).includes(privateText));assert.ok(!JSON.stringify(res.body).includes('test-only-private-key'));
 const url=new URL(calls[0].url);assert.equal(url.pathname,'/rest/v1/edge_decision_journal_v1');
 assert.equal(url.searchParams.get('context->publication->>visibility'),'eq.public');
 assert.equal(url.searchParams.get('context->publication->>surface'),'eq.edge-reviewed-picks-v1');
 const columns=url.searchParams.get('select').split(',');
 for(const name of ['*','context','evidence','source_reference','model_probability'])assert.ok(!columns.includes(name));
 assert.ok(columns.includes('publication:context->publication'));
});

test('today means the Chicago game date and retains started games without inventing a new decision',async t=>{
 setup(t,[row(),row({id:102,event_id:'started',starts_at:stamp(-3600000),issued_at:stamp(-7200000),recorded_at:stamp(-7000000)}),row({id:103,event_id:'tomorrow',starts_at:'2026-11-28T06:30:00.000Z'}),row({id:104,event_id:'yesterday',starts_at:'2026-11-27T05:30:00.000Z'}),row({id:105,sport:'NFL'}),row({id:106,issued_at:stamp(60000)}),row({id:107,starts_at:'unknown'})]);
 const res=await invoke();assert.equal(res.code,200);assert.deepEqual(res.body.picks.map(p=>p.id).sort(),['101','102']);
 assert.equal(res.body.picks.find(p=>p.id==='102').decision,'BUY');
});

test('a later withdrawal replaces the original BUY and cannot be hidden by quote or side changes',async t=>{
 setup(t,[row(),row({id:102,previous_decision_id:101,recorded_at:stamp(-500),issued_at:stamp(-500),decision:'REVERSED',side:'UNDER',line:24.5,odds:-110})]);
 const res=await invoke();assert.equal(res.code,200);assert.deepEqual(res.body.picks.map(p=>[p.id,p.decision]),[['102','REVERSED']]);
});

test('newest capture wins duplicate selections while distinct books and lines stay separate',async t=>{
 setup(t,[row(),row({id:102,recorded_at:stamp(-500),odds:-120}),row({id:103,book:'draftkings'}),row({id:104,line:24.5})]);
 const res=await invoke();assert.equal(res.code,200);assert.deepEqual(res.body.picks.map(p=>p.id).sort(),['102','103','104']);
});

test('a revision cannot suppress another event or unknown identity',async t=>{
 setup(t,[row(),row({id:102,event_id:'different',previous_decision_id:101,recorded_at:stamp(-500),decision:'REVERSED'}),row({id:103,player_id:null}),row({id:104,line:NaN})]);
 const res=await invoke();assert.equal(res.code,200);assert.deepEqual(res.body.picks.map(p=>p.id),['101']);
});

test('a private later amendment withdraws its public predecessor without revealing private fields',async t=>{
 setup(t,[row()]);
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(input);
  return Response.json(url.searchParams.has('previous_decision_id')?[row({id:102,previous_decision_id:101,recorded_at:stamp(-500),publication:null,evidence:{secret:'private withdrawal reason'}})]:[row()]);
 });
 const res=await invoke();assert.equal(res.code,200);assert.deepEqual(res.body.picks,[]);assert.ok(!JSON.stringify(res.body).includes('private withdrawal reason'));
});

test('withdrawing the newest duplicate never resurrects an older BUY capture',async t=>{
 setup(t,[]);
 const captures=[row(),row({id:102,recorded_at:stamp(-500)})];
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(input);
  return Response.json(url.searchParams.has('previous_decision_id')?
   [row({id:103,previous_decision_id:102,recorded_at:stamp(-100),publication:null})]:captures);
 });
 const res=await invoke();assert.equal(res.code,200);assert.deepEqual(res.body.picks,[]);
});

test('a published reversal with changed terms does not expose an older duplicate BUY',async t=>{
 setup(t,[row(),row({id:102,recorded_at:stamp(-500)}),row({id:103,previous_decision_id:102,recorded_at:stamp(-100),decision:'REVERSED',side:'UNDER',line:24.5,book:'draftkings'})]);
 const res=await invoke();assert.equal(res.code,200);assert.deepEqual(res.body.picks.map(p=>[p.id,p.decision]),[['103','REVERSED']]);
});

test('a prior-day review is shown on its Chicago game date while invalid chronology is withheld',async t=>{
 setup(t,[row({issued_at:'2026-11-26T18:00:00.000Z'}),row({id:102,recorded_at:stamp(1000)}),row({id:103,issued_at:stamp(-100),recorded_at:stamp(-500)}),row({id:104,issued_at:null})]);
 const res=await invoke();assert.equal(res.code,200);assert.deepEqual(res.body.picks.map(p=>p.id),['101']);assert.equal(res.body.picks[0].issuedAt,'2026-11-26T18:00:00.000Z');
});

test('Chicago date boundaries include the entire fall-back day and exclude adjacent days',()=>{
 const now=Date.parse('2026-11-01T20:00:00.000Z');
 const make=(id,starts_at)=>row({id,starts_at,issued_at:'2026-10-31T18:00:00.000Z',recorded_at:'2026-10-31T19:00:00.000Z'});
 const result=projectReviewedPicks([
  make(101,'2026-11-01T04:59:59.999Z'),make(102,'2026-11-01T05:00:00.000Z'),
  make(103,'2026-11-02T05:59:59.999Z'),make(104,'2026-11-02T06:00:00.000Z'),
 ],{sport:'NBA',now});
 assert.equal(result.date,'2026-11-01');assert.deepEqual(result.picks.map(p=>p.id),['102','103']);
});

test('conditional and reported recommendations preserve their exact decision vocabulary',async t=>{
 const labels=['SELECT_RESEARCH','SELECT_RESEARCH_PRICE_CONDITIONAL','RETAIN','REPORTED_SELECTION','WATCH','REVERSED'];
 setup(t,labels.map((decision,index)=>row({id:101+index,decision,line:20.5+index})));
 const res=await invoke();assert.equal(res.code,200);assert.deepEqual(res.body.picks.map(p=>p.decision).sort(),labels.sort());assert.ok(res.body.picks.every(p=>p.sourceLabel==='Manual review'));
});

test('publication metadata is projected from explicit bounded fields only',async t=>{
 setup(t,[row({publication:{...published,matchup:{private:'object'},reviewNote:'x'.repeat(501),priceLimit:'-120',internalConversation:'not public',arbitrary:{secret:'not public'}}})]);
 const res=await invoke();assert.equal(res.code,200);const pick=res.body.picks[0];
 assert.equal(pick.matchup,null);assert.equal(pick.reviewNote,null);assert.equal(pick.priceLimit,null);assert.ok(!JSON.stringify(res.body).includes('not public'));
});

test('amendment lookup is unfiltered by publication or date and selects only suppression metadata',async t=>{
 const calls=setup(t,[row()]);const res=await invoke();assert.equal(res.code,200);assert.equal(calls.length,2);
 const first=new URL(calls[0].url),second=new URL(calls[1].url);
 assert.equal(first.searchParams.get('and'),'(starts_at.gte.2026-11-27T05:00:00.000Z,starts_at.lt.2026-11-28T06:00:00.000Z)');
 assert.equal(second.searchParams.get('previous_decision_id'),'in.(101)');assert.ok(!second.searchParams.has('and'));
 assert.ok(!second.searchParams.has('context->publication->>visibility'));assert.ok(!second.searchParams.has('context->publication->>surface'));
 const columns=second.searchParams.get('select').split(',');
 assert.deepEqual(columns.sort(),['id','previous_decision_id','recorded_at','sport','event_id','starts_at','player_id','market_type','market_scope','record_kind','provenance'].sort());
 assert.equal(calls[0].options.headers.apikey,'test-only-private-key');assert.ok(!Object.hasOwn(calls[0].options.headers,'Authorization'));
 assert.equal(calls[0].options.method??'GET','GET');assert.equal(calls[1].options.method??'GET','GET');
});

test('malformed, oversized or failed amendment reads cannot return a verified partial slate',async t=>{
 setup(t,[]);
 for(const invalid of [{error:'private database failure'},null,Array.from({length:501},(_,index)=>row({id:index+1}))]){
  t.mock.method(globalThis,'fetch',async()=>Response.json(invalid));
  const res=await invoke();assert.equal(res.code,503);assert.deepEqual(res.body.picks,[]);assert.ok(!JSON.stringify(res.body).includes('private database failure'));
 }
 t.mock.method(globalThis,'fetch',async input=>new URL(input).searchParams.has('previous_decision_id')?new Response('private error',{status:500}):Response.json([row()]));
 const res=await invoke();assert.equal(res.code,503);assert.deepEqual(res.body.picks,[]);assert.ok(!JSON.stringify(res.body).includes('private error'));
});

test('the feed is read-only, rejects unsupported sports, and hides upstream failures',async t=>{
 const calls=setup(t,[]);
 let res=await invoke({},'POST');assert.equal(res.code,405);assert.equal(calls.length,0);
 res=await invoke({sport:'invalid'});assert.equal(res.code,400);assert.equal(calls.length,0);
 t.mock.method(globalThis,'fetch',async()=>{throw Error('test-only-private-key');});
 res=await invoke();assert.equal(res.code,503);assert.deepEqual(res.body.picks,[]);assert.ok(!JSON.stringify(res.body).includes('test-only-private-key'));
});

test('team picks preserve valid moneyline, spread and total sides and reject impossible combinations',async t=>{
 const team={player_id:null,player_name:null};
 setup(t,[row({...team,id:201,market_type:'moneyline',side:'HOME',line:null}),row({...team,id:202,market_type:'spread',side:'AWAY',line:5.5}),row({...team,id:203,market_type:'total',side:'UNDER',line:220.5}),row({...team,id:204,market_type:'spread',side:'OVER'}),row({...team,id:205,market_type:'total',side:'HOME'}),row({...team,id:206,market_type:'moneyline',side:'HOME',line:3.5}),row({...team,id:207,market_type:'total',side:'OVER',line:-1})]);
 const res=await invoke();assert.equal(res.code,200);assert.deepEqual(res.body.picks.map(p=>p.id).sort(),['201','202','203']);
});
