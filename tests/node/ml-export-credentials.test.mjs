import test from 'node:test';
import assert from 'node:assert/strict';
import { serverKey, trainingHeaders } from '../../supabase/functions/github-ml-training-export/credentials.mjs';

const legacy = 'eyJ.test-only.signature';
const modern = ['sb', 'secret', 'test-only'].join('_');
const env = (values) => (name) => values[name];

test('ML export uses the existing service-role JWT when both key types are provisioned', () => {
  assert.equal(serverKey(env({
    SUPABASE_SERVICE_ROLE_KEY: legacy,
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: modern }),
  })), legacy);
  assert.deepEqual(trainingHeaders(legacy, 500, 500), {
    apikey: legacy,
    accept: 'application/json',
    'range-unit': 'items',
    range: '500-999',
    authorization: `Bearer ${legacy}`,
  });
});

test('ML export supports modern-only projects without putting a secret key in the bearer header', () => {
  assert.equal(serverKey(env({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: modern }) })), modern);
  const headers = trainingHeaders(modern, 0, 500);
  assert.equal(headers.apikey, modern);
  assert.equal(headers.range, '0-499');
  assert.equal('authorization' in headers, false);
});

test('missing or malformed credentials remain unavailable', () => {
  for (const value of [undefined, '', '{', '{}', 'null', '[]', '{"default": 123}', '{"default": "  "}']) {
    assert.equal(serverKey(env({ SUPABASE_SECRET_KEYS: value })), '');
  }
  assert.equal(serverKey(env({ SUPABASE_SERVICE_ROLE_KEY: '  ' })), '');
  assert.equal(serverKey(env({ SUPABASE_SERVICE_ROLE_KEY: legacy, SUPABASE_SECRET_KEYS: '{' })), legacy);
});
