import test from 'node:test';import assert from 'node:assert/strict';
import { sharpQuoteTimestamp } from '../../supabase/functions/_shared/sharp-quote-age.mjs';
test('rechecking old sharp quotes does not make them fresh',()=>{
 const gate={checked_at:'2026-09-30T18:00Z',raw:{sources:{circa:{valid:true,updatedAt:'2026-09-30T17:30Z'},bookmaker:{valid:true,updatedAt:'2026-09-30T17:50Z'}}}};
 assert.equal(sharpQuoteTimestamp(gate),'2026-09-30T17:30:00.000Z');
 gate.raw.sources.circa.updatedAt=null;assert.equal(sharpQuoteTimestamp(gate),null);
 assert.equal(sharpQuoteTimestamp({checked_at:'2026-09-30T18:00Z'}),null);
});
test('rejected sources do not age a valid single-source quote',()=>{
 assert.equal(sharpQuoteTimestamp({raw:{sources:{circa:{valid:true,updatedAt:'2026-09-30T18:00Z'},pinnacle:{valid:false}}}}),'2026-09-30T18:00:00.000Z');
});
