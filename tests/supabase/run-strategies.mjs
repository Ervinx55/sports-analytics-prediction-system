import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {openAccountsFixture} from './accounts-fixture.mjs';
const fixture=await openAccountsFixture(process.argv[2]);const {db}=fixture;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const entry={id:'e',accountId:'a',source:'manual',sourceId:null,kind:'cash',status:'won',sport:'NBA',description:'Synthetic',placedAt:'2026-01-02T00:00:00.000Z',settledAt:'2026-01-03T00:00:00.000Z',stakeCents:100,returnCents:190,feeCents:0,feeIncluded:false,predictionId:null,legs:[],supersedes:null};
const metadata={version:1,strategy:'value',league:'NBA',market:'total',calculationRef:'manual-1',assignment:'entry'};
try{
 await db.exec(`do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;end $$;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../../supabase/migrations/',import.meta.url);
 for(const name of readdirSync(dir).filter(n=>/private_accounts|account_strategy_metadata/.test(n)).sort())await db.exec(readFileSync(new URL(name,dir),'utf8'));
 await db.query('insert into private_accounts.owner_config(owner_id) values ($1)',[owner]);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
 const write=(action,payload,id)=>db.query('select public.accounts_write($1,$2,$3)',[action,id,payload]);
 await write('create-account',{account:{id:'a',provider:'bovada',name:'A',openingAt:'2026-01-01T00:00:00.000Z',openingBalanceCents:0,historyComplete:true,archived:false}},'a');
 await write('add-entry',{entry},'old');
 await write('correct',{entry:{...entry,id:'new',supersedes:'e',strategyMetadata:metadata}},'new');
 const snapshot=(await db.query('select public.accounts_snapshot() as data')).rows[0].data;assert.deepEqual(snapshot.entries.find(e=>e.id==='new').strategyMetadata,metadata);
 for(const m of [null,[],{}, {...metadata,version:2},{...metadata,strategy:'invented'},{...metadata,market:''},{...metadata,assignment:'leg'},{...metadata,extra:true}])await assert.rejects(()=>write('add-entry',{entry:{...entry,id:'invalid',strategyMetadata:m}},'invalid'));
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await db.exec('set role authenticated');await assert.rejects(()=>write('add-entry',{entry:{...entry,id:'attack',strategyMetadata:metadata}},'attack'));await assert.rejects(()=>db.query('select public.accounts_snapshot()'));assert.equal((await db.query('select count(*)::int n from private_accounts.entries')).rows[0].n,0);
 await db.exec('reset role;set role anon');await assert.rejects(()=>db.query('select public.accounts_snapshot()'));await assert.rejects(()=>write('add-entry',{entry:{...entry,strategyMetadata:metadata}},'anon'));
 console.log('Strategy SQL backward compatibility, metadata validation, corrections and RLS passed.');
}finally{await fixture.close();}
