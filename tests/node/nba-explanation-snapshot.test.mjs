import test from 'node:test';
import assert from 'node:assert/strict';
import {contextForSelection,enrichLiveExplanations,enrichQuoteExplanations} from '../../sharp-service/lib/nba-explanation-snapshot.js';
import {directSgoProps} from '../../sharp-service/lib/nba-direct-props.js';
test('exact provider event roster binds quotes not yet represented in forecasts',async()=>{
 const event={eventID:'e',leagueID:'NBA',type:'match',status:{startsAt:'2026-11-12T00:00:00Z'},teams:{home:{teamID:'A_NBA'},away:{teamID:'B_NBA'}},players:{p:{playerID:'p',teamID:'A_NBA',name:'Player'}},odds:{x:{playerID:'p',sideID:'over',statID:'points',periodID:'game',betTypeID:'ou',oddID:'points-p-game-ou-over',byBookmaker:{draftkings:{overUnder:20.5,odds:-110}}}}};
 const body=await directSgoProps({clock:()=> '2026-11-11T00:00:00Z',page:async()=>({events:[event],observedAt:'2026-11-11T00:00:00Z'})});
 const binding=body.events[0].players[0].explanationBinding;assert.equal(binding.teamId,'A_NBA');assert.equal(binding.opponentTeamId,'B_NBA');
 assert.equal(contextForSelection({targets:[],history:[]},'sgo:e','p','points','2026-11-11T00:00:00Z',binding).productionWeight,0);
 assert.equal(contextForSelection({targets:[],history:[]},'sgo:other','p','points','2026-11-11T00:00:00Z',binding),null);
 assert.equal(contextForSelection({targets:[{...binding,teamId:'C_NBA'}],history:[]},'sgo:e','p','points','2026-11-11T00:00:00Z',binding),null);
});
test('ambiguous or mismatched selection binding cannot attach context',()=>{
 const t={eventID:'e',playerID:'p',teamId:'A',opponentTeamId:'B',startsAt:'2026-11-12'};
 assert.equal(contextForSelection({targets:[t]},'other','p','points'),null);
 assert.equal(contextForSelection({targets:[t,{...t,teamId:'C'}]},'e','p','points'),null);
 assert.equal(contextForSelection({targets:[t,t],history:[]},'e','p','points').productionWeight,0);
 assert.equal(contextForSelection({targets:[t],history:[null]},'e','p','points'),null);
});
test('evidence outage preserves all authoritative decisions and exact quotes',async()=>{
 const live={contract:'nba-reviewed-live-v1',decisions:[{status:'PASS',reason:'Not approved',modelProbability:.65,productionWeight:0,modelHash:'frozen'}]};
 const before=JSON.stringify(live);const enriched=await enrichLiveExplanations(live,null);
 const {context,...decision}=enriched.decisions[0];assert.deepEqual(decision,live.decisions[0]);assert.equal(context,null);assert.equal(JSON.stringify(live),before);
 const quotes={events:[{eventID:'e',players:[{prop:{playerID:'p',statID:'points',over:{books:{b:{line:20.5,odds:-110}}}}}]}]};
 const q=await enrichQuoteExplanations(quotes,null);assert.deepEqual(q.events[0].players[0].prop,quotes.events[0].players[0].prop);
});
test('evidence service outage is cached and never leaks server errors',async()=>{
 const old=globalThis.fetch,key=process.env.SUPABASE_SECRET_KEY;process.env.SUPABASE_SECRET_KEY='private-test-key';let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('private-test-key');};
 try{const {explanationSnapshot}=await import('../../sharp-service/lib/nba-explanation-snapshot.js?outage');assert.equal(await explanationSnapshot(),null);assert.equal(await explanationSnapshot(),null);assert.equal(calls,1);}finally{globalThis.fetch=old;if(key===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=key;}
});
