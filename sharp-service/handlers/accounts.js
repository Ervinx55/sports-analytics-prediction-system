import { accountsConfig, verifyOwner, privateFetch } from '../lib/accounts/auth.js';
import { validateEntry, cents, iso, summarizeAccounts } from '../lib/accounts/accounting.js';
import { parseImportCsv } from '../lib/accounts/csv.js';
const MAX_BODY = 1100000;
const id = v => {
    if (typeof v !== 'string' || !v.trim() || v !== v.trim() || v.length > 200)
        throw Error('Invalid');
    return v;
};
function shape(v, keys) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)))
        throw Error('Invalid');
}
const entryKeys = ['id', 'accountId', 'source', 'sourceId', 'kind', 'status', 'sport', 'description', 'placedAt', 'settledAt', 'stakeCents', 'returnCents', 'feeCents', 'feeIncluded', 'predictionId', 'legs', 'supersedes'];
function entry(v) {
    shape(v, entryKeys);
    const e = validateEntry(v);
    for (const k of ['id', 'accountId', 'sourceId', 'predictionId', 'supersedes'])
        if (e[k] != null)
            id(e[k]);
    if (Buffer.byteLength(JSON.stringify(e)) > 32768)
        throw Error('Invalid');
    return e;
}
function payload(body) {
    shape(body, ['action', 'requestId', 'account', 'entry', 'movement', 'csv', 'accountId', 'archived']);
    id(body.requestId);
    switch (body.action) {
        case 'create-account': {
            shape(body, ['action', 'requestId', 'account']);
            const a = body.account;
            shape(a, ['id', 'provider', 'name', 'openingAt', 'openingBalanceCents', 'historyComplete', 'archived']);
            id(a.id);
            if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 100 || a.archived !== false)
                throw Error('Invalid');
            const account = { ...a, openingAt: iso(a.openingAt), openingBalanceCents: cents(a.openingBalanceCents, true) };
            summarizeAccounts({ accounts: [account] });
            return { account };
        }
        case 'add-entry':
        case 'correct': {
            shape(body, ['action', 'requestId', 'entry']);
            const e = entry(body.entry);
            if (body.action === 'correct' ? !e.supersedes : !!e.supersedes)
                throw Error('Invalid');
            return { entry: e };
        }
        case 'add-movement': {
            shape(body, ['action', 'requestId', 'movement']);
            const m = body.movement;
            shape(m, ['id', 'accountId', 'type', 'amountCents', 'occurredAt']);
            id(m.id);
            id(m.accountId);
            if (!['deposit', 'withdrawal', 'bonus', 'adjustment'].includes(m.type))
                throw Error('Invalid');
            cents(m.amountCents, m.type === 'adjustment');
            if (m.type !== 'adjustment' && !m.amountCents)
                throw Error('Invalid');
            return { movement: { ...m, occurredAt: iso(m.occurredAt) } };
        }
        case 'import': {
            shape(body, ['action', 'requestId', 'csv']);
            const parsed = parseImportCsv(body.csv);
            if (parsed.errors.length || !parsed.rows.length)
                throw Error('Invalid');
            const entries = parsed.rows.map(entry);
            if (entries.some(e => e.supersedes))
                throw Error('Invalid');
            return { entries };
        }
        case 'archive':
            shape(body, ['action', 'requestId', 'accountId', 'archived']);
            id(body.accountId);
            if (typeof body.archived !== 'boolean')
                throw Error('Invalid');
            return { accountId: body.accountId, archived: body.archived };
        default: throw Error('Invalid');
    }
}
async function readBody(req) {
    if (req.body !== undefined) {
        const text = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        if (Buffer.byteLength(text) > MAX_BODY)
            throw Error('Invalid');
        return typeof req.body === 'string' ? JSON.parse(text) : req.body;
    }
    let size = 0;
    const chunks = [];
    const controller = setTimeout(() => req.destroy?.(), 8000);
    try {
        for await (const chunk of req) {
            size += Buffer.byteLength(chunk);
            if (size > MAX_BODY)
                throw Error('Invalid');
            chunks.push(Buffer.from(chunk));
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    finally {
        clearTimeout(controller);
    }
}
export function createAccountsHandler({ env = process.env, fetchImpl = fetch } = {}) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
        res.setHeader('CDN-Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Vary', 'Authorization');
        const send = (status, data = null, error = null) => res.status(status).json({ ok: status < 400, data, error });
        const config = accountsConfig(env);
        if (!['GET', 'POST'].includes(req.method)) {
            res.setHeader('Allow', 'GET, POST');
            return send(405, null, 'METHOD_NOT_ALLOWED');
        }
        if (req.method === 'GET' && req.query?.view === 'config')
            return send(200, { ready: config.ready, status: config.ready ? 'ready' : 'setup-needed', ...(config.ready ? {supabaseUrl: config.url, publishableKey: config.key} : {}) });
        if (!config.ready)
            return send(503, null, 'SETUP_NEEDED');
        try {
            const auth = await verifyOwner(req, config, fetchImpl);
            if (auth.status)
                return send(auth.status, null, 'ACCESS_DENIED');
            let rpc, args;
            if (req.method === 'GET') {
                if (req.query?.view !== 'snapshot')
                    return send(400, null, 'INVALID_REQUEST');
                rpc = 'accounts_snapshot';
                args = {};
            }
            else {
                try {
                    const body = await readBody(req);
                    args = { action: body.action, request_id: body.requestId, payload: payload(body) };
                    rpc = 'accounts_write';
                }
                catch {
                    return send(400, null, 'INVALID_REQUEST');
                }
            }
            const response = await privateFetch(`${config.url}/rest/v1/rpc/${rpc}`, { method: 'POST', headers: { apikey: config.key, Authorization: auth.authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(args) }, fetchImpl);
            if (!response.ok && response.data?.code === 'P0001' && response.data?.message === 'Ledger capacity exceeded')
                return send(409, null, 'LEDGER_CAPACITY_EXCEEDED');
            if (!response.ok)
                return send(response.status >= 500 ? 503 : 409, null, response.status >= 500 ? 'ACCOUNTS_UNAVAILABLE' : 'WRITE_REJECTED');
            const data = response.data;
            if (rpc === 'accounts_snapshot') {
                if (!data || !Array.isArray(data.accounts) || !Array.isArray(data.entries) || !Array.isArray(data.movements))
                    return send(503, null, 'ACCOUNTS_UNAVAILABLE');
                data.summary = summarizeAccounts(data);
            }
            return send(200, data);
        }
        catch {
            return send(503, null, 'ACCOUNTS_UNAVAILABLE');
        }
    };
}
export default createAccountsHandler();

