import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('model capture includes afternoon and evening games before their final-input window', () => {
  const source = fs.readFileSync(new URL('../../supabase/functions/capture-model-audit/index.ts', import.meta.url), 'utf8');
  const match = source.match(/const startsBefore = new Date\(Date\.now\(\) \+ ([\d_ *]+)\)\.toISOString\(\);/);
  assert.ok(match, 'capture has an explicit bounded lookahead');
  const duration = match[1].split('*').reduce((value, factor) => value * Number(factor.trim().replaceAll("_", "")), 1);
  assert.ok(duration >= 18 * 3600000, 'morning capture must include evening markets');
  assert.ok(duration <= 24 * 3600000, 'capture must remain bounded to one day');
  assert.match(source, /const startsAfter = new Date\(\)\.toISOString\(\)/);
  assert.match(source, /includeWatch: "true"/);
});

