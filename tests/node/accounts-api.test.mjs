import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountsHandler } from '../../sharp-service/handlers/accounts.js';
const owner = '11111111-1111-4111-8111-111111111111';
const env = { ACCOUNTS_ENABLED: 'true', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic', ACCOUNTS_OWNER_ID: owner };
function response() {
    return { headers: {}, setHeader(k, v) {
            this.headers[k] = v;
        }, status(n) {
            this.code = n;
            return this;
        }, json(v) {
            this.body = v;
            return this;
        } };
}
async function call(req, opts = {}) {
    const res = response();
    await createAccountsHandler({ env, ...opts })({ method: 'GET', query: { view: 'snapshot' }, headers: {}, ...req }, res);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    assert.deepEqual(Object.keys(res.body).sort(), ['data', 'error', 'ok']);
    return res;
}
test('missing setup exposes readiness only', async () => {
    const r = await call({ query: { view: 'config' } }, { env: {} });
    assert.deepEqual(r.body.data, { ready: false, status: 'setup-needed' });
    assert.equal((await call({}, { env: {} })).code, 503);
});
test('anonymous and forged callers never reach data', async () => {
    let calls = 0;
    const fetchImpl = async () => {
        calls++;
        return { ok: false };
    };
    assert.equal((await call({}, { fetchImpl })).code, 401);
    assert.equal((await call({ headers: { authorization: 'Bearer forged' } }, { fetchImpl })).code, 401);
    assert.equal(calls, 1);
});
test('verified second user denied before data access', async () => {
    let calls = 0;
    const fetchImpl = async () => {
        calls++;
        return { ok: true, json: async () => ({ id: '22222222-2222-4222-8222-222222222222', email_confirmed_at: '2026-01-01' }) };
    };
    assert.equal((await call({ headers: { authorization: 'Bearer synthetic' } }, { fetchImpl })).code, 403);
    assert.equal(calls, 1);
});
test('owner JWT forwarded to invoker RPC and public config hides identity', async () => {
    const calls = [];
    const fetchImpl = async (url, opt) => {
        calls.push({ url, opt });
        return { ok: true, json: async () => url.includes('/auth/') ? { id: owner, email_confirmed_at: '2026-01-01' } : { accounts: [], entries: [], movements: [] } };
    };
    const r = await call({ headers: { authorization: 'Bearer synthetic' } }, { fetchImpl });
    assert.equal(r.code, 200);
    assert.equal(calls[1].opt.headers.Authorization, 'Bearer synthetic');
    assert.equal(calls[1].opt.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
    const c = await call({ query: { view: 'config' } }, { fetchImpl });
    assert.deepEqual(c.body.data, { ready: true, status: 'ready', supabaseUrl: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY });
});
test('unsupported actions, oversized body, CSV errors reject before data RPC', async () => {
    let dataCalls = 0;
    const fetchImpl = async (url) => {
        if (!url.includes('/auth/'))
            dataCalls++;
        return { ok: true, json: async () => ({ id: owner, email_confirmed_at: '2026-01-01' }) };
    };
    for (const body of [{ action: 'delete' }, { action: 'import', requestId: 'r1', csv: 'bad,header\nx,y' }, { action: 'add-entry', entry: { source: 'kalshi' } }, 'x'.repeat(1100000)]) {
        assert.equal((await call({ method: 'POST', headers: { authorization: 'Bearer synthetic' }, body }, { fetchImpl })).code, 400);
    }
    assert.equal(dataCalls, 0);
});
test('upstream errors never echo secrets and every method is no-store', async () => {
    const fetchImpl = async () => {
        throw Error('secret bearer and private row');
    };
    const r = await call({ headers: { authorization: 'Bearer synthetic' } }, { fetchImpl });
    assert.equal(r.code, 503);
    assert.doesNotMatch(JSON.stringify(r.body), /secret|bearer|private row/);
    assert.equal((await call({ method: 'DELETE' })).code, 405);
});
test('ready config returns vetted OTP public settings and rejects credential misconfiguration', async () => {
    const r = await call({query:{view:'config'}});
    assert.equal(r.body.data.supabaseUrl, env.SUPABASE_URL);
    assert.equal(r.body.data.publishableKey, env.SUPABASE_PUBLISHABLE_KEY);
    for (const overrides of [{SUPABASE_URL:'https://evil.example'}, {SUPABASE_URL:'https://example.supabase.co:444'}, {SUPABASE_PUBLISHABLE_KEY:'sb_secret_synthetic'}, {SUPABASE_PUBLISHABLE_KEY:'eyJhbGciOiJIUzI1NiJ9.synthetic.service-role'}]) {
        const bad = await call({query:{view:'config'}}, {env:{...env,...overrides}});
        assert.deepEqual(bad.body.data,{ready:false,status:'setup-needed'});
    }
});


test('capacity rejection is actionable without exposing upstream data', async () => {
 const fetchImpl=async url=>({ok:url.includes('/auth/'),status:400,json:async()=>url.includes('/auth/')?{id:owner,email_confirmed_at:'2026-01-01'}:{code:'P0001',message:'Ledger capacity exceeded',details:'private'}});
 const r=await call({method:'POST',headers:{authorization:'Bearer synthetic'},body:{action:'archive',requestId:'r-limit',accountId:'a1',archived:true}},{fetchImpl});
 assert.equal(r.code,409);assert.equal(r.body.error,'LEDGER_CAPACITY_EXCEEDED');
 assert.doesNotMatch(JSON.stringify(r.body),/private/);
});
