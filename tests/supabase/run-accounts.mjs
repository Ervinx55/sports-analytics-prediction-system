import { accountsConcurrency } from './accounts-concurrency.mjs';
import { readFileSync } from 'node:fs';
import { openAccountsFixture } from './accounts-fixture.mjs';
import assert from 'node:assert/strict';
const fixture = await openAccountsFixture(process.argv[2]);
const { db } = fixture;
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const account = { id: 'a1', provider: 'prizepicks', name: 'Synthetic', openingAt: '2026-01-01T00:00:00.000Z', openingBalanceCents: 0, historyComplete: false, archived: false };
const entry = { id: 'e1', accountId: 'a1', source: 'import', sourceId: 's1', kind: 'cash', status: 'pending', sport: 'NBA', description: 'Synthetic', placedAt: '2026-01-02T00:00:00.000Z', settledAt: null, stakeCents: 100, returnCents: null, feeCents: 0, feeIncluded: false, predictionId: null, legs: [], supersedes: null };
async function rpc(action, payload = {}, requestId = 'request-' + Math.random()) {
    return (await db.query('select public.accounts_write($1,$2,$3) as data', [action, requestId, payload])).rows[0].data;
}
async function denied(fn) {
    await assert.rejects(fn);
}
try {
    await db.exec(`do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;end $$;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
    await db.exec(readFileSync(new URL('../../supabase/migrations/20261025122136_private_accounts.sql', import.meta.url), 'utf8'));
    await db.query('insert into private_accounts.owner_config(owner_id) values ($1)', [owner]);
    await db.exec('set role anon');
    await denied(() => db.query('select public.accounts_snapshot()'));
    await denied(() => rpc('create-account', { account }));
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    await db.exec('set role authenticated');
    assert.equal((await db.query('select count(*)::int as count from private_accounts.owner_config')).rows[0].count, 0);
    await denied(() => rpc('create-account', { account }));
    await denied(() => db.query('insert into private_accounts.owner_config(owner_id) values ($1)', [other]));
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec('set role authenticated');
    await denied(() => rpc('create-account', { account: { ...account, id: 17 } }, 'numeric-id'));
    await rpc('create-account', { account }, 'create1');
    await denied(() => rpc('create-account', { account: { ...account, id: 17 } }, 'numeric-id'));
    await rpc('create-account', { account }, 'create1');
    await denied(() => rpc('create-account', { account: { ...account, name: 'changed' } }, 'create1'));
    await rpc('import', { entries: [entry] }, 'import1');
    await rpc('import', { entries: [entry] }, 'import1');
    await denied(() => rpc('import', { entries: [{ ...entry, id: 'e2', sourceId: 's2' }, { ...entry, id: 'e3' }] }, 'badimport'));
    assert.equal((await db.query('select count(*)::int as count from private_accounts.entries')).rows[0].count, 1);
    await denied(() => db.query("update private_accounts.entries set payload=payload || '{\"description\":\"tamper\"}'::jsonb"));
    await denied(() => db.query('delete from private_accounts.entries'));
    await rpc('correct', { entry: { ...entry, id: 'e2', supersedes: 'e1', description: 'Correction' } }, 'correct1');
    await denied(() => rpc('correct', { entry: { ...entry, id: 'e3', supersedes: 'e1' } }, 'fork'));
    await denied(() => rpc('add-entry', { entry: { ...entry, id: 'e4' } }, 'dup'));
    await denied(() => rpc('add-entry', { entry: { ...entry, id: 'e5', accountId: 'foreign', sourceId: 's5' } }, 'foreign'));
    await denied(() => rpc('add-entry', { entry: { ...entry, id: 'e6', sourceId: 's6', stakeCents: -1 } }, 'money'));
    await denied(() => rpc('add-entry', { entry: { ...entry, id: 'e7', source: 'kalshi', sourceId: 's7' } }, 'kalshi'));
    await rpc('archive', { accountId: 'a1', archived: true }, 'archive1');
    const snap = (await db.query('select public.accounts_snapshot() as data')).rows[0].data;
    assert.equal(snap.accounts.length, 1);
    assert.equal(snap.entries.length, 2);
    assert.equal(snap.accounts[0].archived, true);
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    await db.exec('set role authenticated');
    for (const table of ['accounts', 'entries', 'movements', 'requests'])
        assert.equal((await db.query(`select count(*)::int as count from private_accounts.${table}`)).rows[0].count, 0);
    await denied(() => db.query('select public.accounts_snapshot()'));
    await denied(() => rpc('add-entry', { entry: { ...entry, id: 'attack' } }, 'attack'));
    await denied(() => db.query('insert into private_accounts.accounts(owner_id,id,payload) values ($1,$2,$3)', [other, account.id, account]));
    await denied(() => db.query('insert into private_accounts.entries(owner_id,id,account_id,payload) values ($1,$2,$3,$4)', [owner, 'attack', account.id, { ...entry, id: 'attack' }]));
    await denied(() => db.query('update private_accounts.owner_config set owner_id=$1', [other]));
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec('set role authenticated');
    await denied(() => db.query('update private_accounts.accounts set owner_id=$1', [other]));
    await denied(() => db.query('delete from private_accounts.accounts'));
    await denied(() => db.query('update private_accounts.movements set payload=payload'));
    await denied(() => db.query('delete from private_accounts.requests'));
    await denied(() => rpc('delete', {}, 'unsupported'));
    await denied(() => rpc('correct', { entry: { ...entry, id: 'changed-prediction', supersedes: 'e2', predictionId: 'new-ref' } }, 'changed-prediction'));
    await denied(() => rpc('correct', { entry: { ...entry, id: 'changed-source', supersedes: 'e2', sourceId: 'new-source' } }, 'changed-source'));
    await rpc('add-movement', { movement: { id: 'm1', accountId: 'a1', type: 'deposit', amountCents: 1000, occurredAt: '2026-01-02T00:00:00.000Z' } }, 'movement1');
    await accountsConcurrency(fixture.pool, owner, entry);
    await db.query("insert into private_accounts.accounts(id,payload) select 'limit-'||i, jsonb_set($1::jsonb,'{id}',to_jsonb('limit-'||i)) from generate_series(1,99) i", [account]);
    await assert.rejects(() => rpc('create-account', {account: {...account,id:'overflow'}}, 'overflow'), /Ledger capacity exceeded/);
    assert.equal((await db.query('select public.accounts_snapshot() as data')).rows[0].data.accounts.length,100);
    await assert.rejects(() => db.query('insert into private_accounts.accounts(id,payload) values ($1,$2)', ['direct-overflow',{...account,id:'direct-overflow'}]), /Ledger capacity exceeded/);
    // Byte-heavy imports must roll back the entire batch, leaving prior history readable.
    const large = Array.from({length:30},(_,i)=>({...entry,id:`big-${i}`,sourceId:`big-${i}`,legs:['x'.repeat(30000)]}));
    for(let batch=0;batch<8;batch++) await rpc('import',{entries:large.map(e=>({...e,id:`${batch}-${e.id}`,sourceId:`${batch}-${e.sourceId}`}))});
    const before=(await db.query('select public.accounts_snapshot() as data')).rows[0].data;
    await assert.rejects(() => rpc('import',{entries:large.map(e=>({...e,id:`overflow-${e.id}`,sourceId:`overflow-${e.sourceId}`}))},'overflow-import'), /Ledger capacity exceeded/);
    assert.deepEqual((await db.query('select public.accounts_snapshot() as data')).rows[0].data,before);
    assert.equal((await db.query("select count(*)::int n from private_accounts.requests where id='overflow-import'")).rows[0].n,0);
    console.log('Private accounts SQL role/atomicity/immutability/dedupe assertions passed.');
}
catch (error) {
    console.error(error.message, error.code, error.where ?? '');
    process.exitCode = 1;
}
finally {
    await fixture.close();
}
