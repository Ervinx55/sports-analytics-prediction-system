import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Optional disposable PostgreSQL runtime; never connects to a production database.
// Usage: node tests/supabase/run-performance-ledger.mjs /absolute/path/to/pglite/dist/index.js
const modulePath = process.argv[2];
if (!modulePath) throw new Error('Pass the installed PGlite module path; no database URL is accepted.');
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);
const db = new PGlite();
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261005000000_prediction_performance_ledger.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('./performance-ledger.sql', import.meta.url), 'utf8'));
  console.log('Ledger SQL assertions passed (all fixture transactions rolled back).');
} catch (error) {
  console.error(error.message, error.code, error.where ?? '');
  process.exitCode = 1;
} finally {
  await db.close();
}
