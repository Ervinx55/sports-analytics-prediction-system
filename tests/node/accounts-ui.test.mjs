import test from 'node:test';
import assert from 'node:assert/strict';
import {dollarsToCents,createAccountsClient,centsToDollars,historyPage,localDateInput,preserveLegs} from '../../sharp-service/lib/accounts/client.js';
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
const config={ready:true,supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_test'};
function fixture(){
 const calls=[];let pending;let failure=false;
 const fetchImpl=async(url,opt={})=>{calls.push({url,opt});
 if(url.endsWith('config'))return response({data:config});
 if(url.endsWith('/otp'))return response({});
 if(url.endsWith('/verify'))return response({access_token:'synthetic',expires_in:3600});
 if(url.includes('/logout'))return response({});
 if(pending)return pending;
 if(failure)return response({error:'ACCESS_DENIED'},401);
 return response({ok:true,data:{accounts:[],entries:[],movements:[]}});
 };
 const client=createAccountsClient({fetchImpl});
 return {client,calls,delay:p=>pending=p,fail:()=>failure=true};
}
test('dollar input uses exact cents and rejects silently rounded amounts',()=>{
 assert.equal(dollarsToCents('0.29'),29);assert.equal(dollarsToCents('-1.01',true),-101);
 for(const value of ['1.001','1e3','Infinity','', '90071992547409.92','-1']) assert.throws(()=>dollarsToCents(value));
});
test('existing-user OTP only and session never appears in render state',async()=>{
 const {client,calls}=fixture();await client.init();await client.sendCode('owner@example.com');
 assert.equal(JSON.parse(calls.at(-1).opt.body).create_user,false);
 await client.verifyCode('owner@example.com','123456');await client.refresh();
 assert.equal(client.state.signedIn,true);assert.deepEqual(client.state.snapshot.accounts,[]);
 assert.doesNotMatch(JSON.stringify(client.state),/synthetic|access_token/);
});
test('logout prevents late snapshot response from restoring private data',async()=>{
 const f=fixture();await f.client.init();await f.client.verifyCode('owner@example.com','123456');
 let resolve;f.delay(new Promise(r=>resolve=r));const request=f.client.refresh();
 await f.client.logout();resolve(response({ok:true,data:{accounts:[{name:'private'}],entries:[],movements:[]}}));await request;
 assert.equal(f.client.state.snapshot,null);assert.equal(f.client.state.signedIn,false);
});
test('expired server session removes loaded records',async()=>{
 const f=fixture();await f.client.init();await f.client.verifyCode('owner@example.com','123456');await f.client.refresh();
 f.fail();await assert.rejects(()=>f.client.refresh());assert.equal(f.client.state.snapshot,null);assert.equal(f.client.state.signedIn,false);
});
test('CSV requires reviewed valid content and stable retry request',async()=>{
 const f=fixture();await f.client.init();await f.client.verifyCode('owner@example.com','123456');
 assert.throws(()=>f.client.prepareImport('bad,header'));
 await assert.rejects(()=>f.client.saveImport());
 const prepared=f.client.prepareWrite({action:'archive',accountId:'a1',archived:true});
 await f.client.save(prepared);await f.client.save(prepared);
 const writes=f.calls.filter(c=>c.url==='/api/accounts');assert.equal(writes.length,2);
 assert.equal(JSON.parse(writes[0].opt.body).requestId,JSON.parse(writes[1].opt.body).requestId);
});

test('correction helpers preserve cents, instant precision and structured legs',()=>{
 assert.equal(centsToDollars(9007199254740982),'90071992547409.82');
 const timestamp='2026-10-25T12:34:56.789Z';assert.equal(new Date(localDateInput(timestamp)).toISOString(),timestamp);
 const legs=[{player:'Synthetic',line:25.5}];assert.deepEqual(preserveLegs(JSON.stringify(legs[0]),legs),legs);
});
test('every active historical entry remains reachable in chronological pages',()=>{
 const entries=Array.from({length:205},(_,i)=>({id:String(205-i),placedAt:new Date(1000*i).toISOString()}));
 assert.equal(historyPage(entries,0).rows[0].id,'1');assert.equal(historyPage(entries,1).rows.length,5);
 assert.equal(new Set([...historyPage(entries,0).rows,...historyPage(entries,1).rows].map(e=>e.id)).size,205);
});
test('ambiguous write failure preserves retry form state and request identity',async()=>{
 let fail=false;const base=fixture();const fetchImpl=async(url,opt)=>{
 if(url.endsWith('config'))return response({data:config});if(url.endsWith('/verify'))return response({access_token:'synthetic',expires_in:3600});
 if(fail)throw Error('network interrupted');return response({data:{accounts:[],entries:[],movements:[]}});
 };const client=createAccountsClient({fetchImpl});await client.init();await client.verifyCode('x@example.com','123456');await client.refresh();const before=client.state.snapshot;
 fail=true;await assert.rejects(()=>client.save(client.prepareWrite({action:'archive',accountId:'a1',archived:true})));
 assert.equal(client.state.snapshot,before);assert.equal(client.state.signedIn,true);
});
