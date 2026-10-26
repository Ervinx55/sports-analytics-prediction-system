import assert from 'node:assert/strict';
// Exercise lock waits with independent native PostgreSQL connections; PGlite is single-session.
export async function accountsConcurrency(pool, owner, entry) {
    if (!pool)
        return;
    const a = await pool.reserve();
    const b = await pool.reserve();
    async function beginBoth() {
        for (const connection of [a, b]) {
            await connection `begin`;
            await connection `set local role authenticated`;
            await connection `select set_config('request.jwt.claim.sub',${owner},true)`;
        }
    }
    async function waitForLock(pid) {
        for (let i = 0; i < 100; i++) {
            const [state] = await pool `select wait_event_type from pg_stat_activity where pid=${pid}`;
            if (state?.wait_event_type === 'Lock')
                return;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw Error('Independent second connection did not wait for a ledger lock');
    }
    try {
        const [{ pid: pidA }] = await a `select pg_backend_pid() as pid`;
        const [{ pid: pidB }] = await b `select pg_backend_pid() as pid`;
        assert.notEqual(pidA, pidB);
        await beginBoth();
        const payload = { entries: [{ ...entry, id: 'race-import', sourceId: 'race-import' }] };
        const first = await a `select public.accounts_write('import','race-retry',${a.json(payload)}::jsonb) as data`;
        const retry = b `select public.accounts_write('import','race-retry',${b.json(payload)}::jsonb) as data`.then(rows => ({ rows }), error => ({ error }));
        await waitForLock(pidB);
        await a `commit`;
        const replay = await retry;
        assert.equal(replay.error, undefined);
        assert.deepEqual(replay.rows, first);
        await b `commit`;
        // Direct table inserts also serialize; bypassing the façade cannot race source uniqueness.
        await beginBoth();
        const left = { ...entry, id: 'race-source-a', sourceId: 'race-source' };
        const right = { ...entry, id: 'race-source-b', sourceId: 'race-source' };
        await a `insert into private_accounts.entries(id,account_id,payload) values(${left.id},${left.accountId},${a.json(left)}::jsonb)`;
        const duplicate = b `insert into private_accounts.entries(id,account_id,payload) values(${right.id},${right.accountId},${b.json(right)}::jsonb)`.then(rows => ({ rows }), error => ({ error }));
        await waitForLock(pidB);
        await a `commit`;
        assert.ok((await duplicate).error, 'Concurrent source identity duplicate was accepted');
        await b `rollback`;
        // Only one successor can correct a live entry, even with different request IDs.
        await beginBoth();
        const correctedA = { ...entry, id: 'race-correction-a', supersedes: 'e2' };
        const correctedB = { ...entry, id: 'race-correction-b', supersedes: 'e2' };
        await a `select public.accounts_write('correct','race-correction-a',${a.json({ entry: correctedA })}::jsonb)`;
        const fork = b `select public.accounts_write('correct','race-correction-b',${b.json({ entry: correctedB })}::jsonb)`.then(rows => ({ rows }), error => ({ error }));
        await waitForLock(pidB);
        await a `commit`;
        assert.ok((await fork).error, 'Concurrent correction fork was accepted');
        await b `rollback`;
        console.log('Native accounts independent-session retry, direct source identity and correction races passed.');
    }
    finally {
        await a `rollback`;
        await b `rollback`;
        a.release();
        b.release();
    }
}
