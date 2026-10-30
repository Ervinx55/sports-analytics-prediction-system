import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
// This runner accepts a module path, never a connection URL. Native tests are loopback-only.
export async function openAccountsFixture(modulePath) {
    if (!modulePath)
        throw Error('Pass the installed PGlite or postgres module path.');
    const runtime = await import(pathToFileURL(resolve(modulePath)).href);
    if (runtime.PGlite) {
        const db = new runtime.PGlite();
        return { db, close: () => db.close() };
    }
    if (!['127.0.0.1', 'localhost', '::1'].includes(process.env.PGHOST) || !process.env.PGPORT || !process.env.PGUSER || !process.env.PGPASSWORD_FILE) {
        throw Error('Native fixtures require explicit loopback PGHOST, PGPORT, PGUSER and PGPASSWORD_FILE.');
    }
    const config = {
        host: process.env.PGHOST, port: Number(process.env.PGPORT), username: process.env.PGUSER,
        password: readFileSync(process.env.PGPASSWORD_FILE, 'utf8').trim(), max: 5,
        onnotice() {
        }
    };
    const admin = runtime.default({ ...config, database: process.env.PGDATABASE ?? 'postgres' });
    const name = `accounts_fixture_${process.pid}_${Date.now()}`;
    await admin `create database ${admin(name)}`;
    const pool = runtime.default({ ...config, database: name });
    const session = await pool.reserve();
    const db = {
        exec: sql => session.unsafe(sql, [], { prepare: false }),
        query: async (sql, args = []) => ({ rows: await session.unsafe(sql, args, { prepare: false }) })
    };
    return {
        db, pool,
        async close() {
            session.release();
            await pool.end();
            await admin `drop database ${admin(name)}`;
            await admin.end();
        }
    };
}

