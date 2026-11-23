import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const functionDir = new URL('../../supabase/functions/github-ml-training-export/', import.meta.url);

// Execute the real credential selector without starting a Deno server or
// contacting GitHub. Its only external dependency is the server environment.
function selectServerKey(values) {
  const source = readFileSync(new URL('index.ts', functionDir), 'utf8');
  const selector = source.match(/function adminKey\(\): string \{[\s\S]*?\n\}/)?.[0];
  assert.ok(selector, 'ML exporter must expose its server credential selector');
  const helperPath = new URL('service-role-key.mjs', functionDir);
  const helper = existsSync(helperPath)
    ? readFileSync(helperPath, 'utf8').replace(/^export /gm, '')
    : '';
  return vm.runInNewContext(`${helper}\n${selector.replace('(): string', '()')}\nadminKey()`, {
    Deno: { env: { get: name => values[name] } },
  });
}

function serviceJwt(subject) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    iss: 'supabase', role: 'service_role', sub: subject, exp: 4102444800,
  })}`;
  const signature = createHmac('sha256', 'test-fixture-signing-key').update(content).digest('base64url');
  return `${content}.${signature}`;
}

const override = serviceJwt('server-override-fixture');
const legacy = serviceJwt('injected-legacy-fixture');
const modern = ['sb', 'secret', 'test-only'].join('_');
const claims = {
  repository: 'Ervinx55/sports-analytics-prediction-system',
  ref: 'refs/heads/master',
  workflow_ref: 'Ervinx55/sports-analytics-prediction-system/.github/workflows/ml-shadow.yml@refs/heads/master',
  event_name: 'workflow_dispatch',
  run_id: 'test-run',
};

// Execute the actual Deno entry point, stripping only imports and TypeScript
// annotations. GitHub verification and the backend fetch are injected so the
// tests exercise the real claim gates, credential selector and outgoing headers
// without contacting either service. This also works in the Node 20 CI runtime.
function exporter(values, { payload = claims, verificationError = false } = {}) {
  const source = readFileSync(new URL('index.ts', functionDir), 'utf8')
    .replace(/^import [\s\S]*?;\n/gm, '')
    .replace('function adminKey(): string', 'function adminKey()')
    .replace('authorize(req: Request)', 'authorize(req)')
    .replace(/function boundedInteger\([\s\S]*?\): number/, 'function boundedInteger(value, fallback, min, max)')
    .replace('const headers: Record<string, string>', 'const headers')
    .replace('let rows: unknown;', 'let rows;');
  const helper = readFileSync(new URL('service-role-key.mjs', functionDir), 'utf8').replace(/^export /gm, '');
  const requests = [], verifications = [];
  let handler;
  vm.runInNewContext(`${helper}\n${source}`, {
    Deno: { env: { get: name => values[name] }, serve: callback => { handler = callback; } },
    URL, Request, Response,
    createRemoteJWKSet: url => ({ url: url.href }),
    jwtVerify: async (token, jwks, options) => {
      verifications.push({ token, jwks, options });
      if (verificationError) throw new Error('invalid fixture signature');
      return { payload };
    },
    fetch: async (url, options) => {
      requests.push({ url: String(url), ...options });
      return Response.json([]);
    },
  });
  assert.equal(typeof handler, 'function');
  const invoke = async ({ authorization = 'Bearer github-oidc-fixture', method = 'POST', body = {} } = {}) => {
    const response = await handler(new Request('https://exporter.example.test/', {
      method, headers: authorization == null ? {} : { authorization },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    }));
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  return { invoke, requests, verifications };
}

test('ML export preserves the deployed server override when injected keys are also present', () => {
  assert.equal(selectServerKey({
    EDGE_LAB_SERVICE_ROLE_KEY: `  ${override}  `,
    SUPABASE_SERVICE_ROLE_KEY: legacy,
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: modern }),
  }), override);
});

test('ML export supports modern-only projects and ignores an empty override', () => {
  assert.equal(selectServerKey({
    EDGE_LAB_SERVICE_ROLE_KEY: '   ',
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: modern }),
  }), modern);
});

test('ML export falls back to the injected service credential when modern configuration is unavailable', () => {
  for (const modernConfig of [undefined, '{', '{}']) {
    assert.equal(selectServerKey({
      SUPABASE_SERVICE_ROLE_KEY: `  ${legacy}  `,
      SUPABASE_SECRET_KEYS: modernConfig,
    }), legacy);
  }
});

test('ML export trims a valid modern default and keeps it ahead of the injected legacy key', () => {
  assert.equal(selectServerKey({
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: ` \t${modern}\n ` }),
    SUPABASE_SERVICE_ROLE_KEY: legacy,
  }), modern);
});

test('ML export rejects nonstring and blank modern defaults instead of coercing them into keys', () => {
  for (const value of [123, true, [], [modern], {}, { key: modern }, '', ' \t\r\n ', null, false, 0]) {
    assert.equal(selectServerKey({
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: value }),
      SUPABASE_SERVICE_ROLE_KEY: legacy,
    }), legacy, `invalid modern default: ${JSON.stringify(value)}`);
  }
});

test('invalid modern defaults without a fallback fail before any export request', async () => {
  for (const value of [123, true, [modern], {}, '', ' \t\r\n ']) {
    const app = exporter({
      SUPABASE_URL: 'https://backend.example.test',
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: value }),
    });
    const result = await app.invoke({ body: { apikey: modern, serviceRoleKey: override } });
    assert.equal(result.status, 500, `invalid modern default: ${JSON.stringify(value)}`);
    assert.equal(app.requests.length, 0);
    assert.match(result.body.error, /credential.*not configured/);
    assert.ok(!JSON.stringify(result.body).includes(modern));
  }
});

test('modern server credentials use apikey only and are never sent as Bearer tokens', async () => {
  for (const credentials of [
    { EDGE_LAB_SERVICE_ROLE_KEY: ` ${modern} `, SUPABASE_SECRET_KEYS: JSON.stringify({ default: legacy }), SUPABASE_SERVICE_ROLE_KEY: legacy },
    { SUPABASE_SECRET_KEYS: JSON.stringify({ default: ` ${modern} ` }), SUPABASE_SERVICE_ROLE_KEY: legacy },
    { SUPABASE_SERVICE_ROLE_KEY: ` ${modern} ` },
  ]) {
    const app = exporter({ SUPABASE_URL: 'https://backend.example.test', ...credentials });
    const result = await app.invoke();
    assert.equal(result.status, 200);
    assert.equal(app.requests.length, 1);
    const outgoing = app.requests[0];
    assert.equal(outgoing.headers.apikey, modern);
    assert.equal(new Headers(outgoing.headers).get('authorization'), null);
    assert.equal(outgoing.method, 'GET');
    assert.equal(new URL(outgoing.url).pathname, '/rest/v1/player_prop_training_export');
    assert.equal(outgoing.headers.range, '0-499');
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.ok(!JSON.stringify(result.body).includes(modern));
  }
});

test('valid server JWTs retain both backend headers without forwarding the GitHub token', async () => {
  for (const credentials of [
    { EDGE_LAB_SERVICE_ROLE_KEY: ` ${legacy} ` },
    { SUPABASE_SECRET_KEYS: JSON.stringify({ default: legacy }) },
    { SUPABASE_SERVICE_ROLE_KEY: ` ${legacy} ` },
  ]) {
    const app = exporter({ SUPABASE_URL: 'https://backend.example.test', ...credentials });
    const result = await app.invoke();
    assert.equal(result.status, 200);
    assert.equal(app.requests[0].headers.apikey, legacy);
    assert.equal(new Headers(app.requests[0].headers).get('authorization'), `Bearer ${legacy}`);
    assert.ok(!JSON.stringify(app.requests[0]).includes('github-oidc-fixture'));
    assert.ok(!JSON.stringify(result.body).includes(legacy));
    const verified = app.verifications[0];
    assert.equal(verified.token, 'github-oidc-fixture');
    assert.equal(verified.jwks.url, 'https://token.actions.githubusercontent.com/.well-known/jwks');
    assert.equal(verified.options.issuer, 'https://token.actions.githubusercontent.com');
    assert.equal(verified.options.audience, 'edge-lab-supabase-ml-export');
    assert.equal(verified.options.clockTolerance, 5);
  }
});

test('the exact OIDC repository, ref, workflow and allowed event gates still precede backend access', async () => {
  const values = { SUPABASE_URL: 'https://backend.example.test', SUPABASE_SECRET_KEYS: JSON.stringify({ default: modern }) };
  for (const patch of [
    { repository: 'untrusted/repository' },
    { ref: 'refs/heads/untrusted' },
    { workflow_ref: 'Ervinx55/sports-analytics-prediction-system/.github/workflows/other.yml@refs/heads/master' },
    { event_name: 'pull_request' },
  ]) {
    const app = exporter(values, { payload: { ...claims, ...patch } });
    assert.equal((await app.invoke()).status, 401);
    assert.equal(app.requests.length, 0);
  }
  for (const event_name of ['push', 'schedule', 'workflow_dispatch']) {
    const app = exporter(values, { payload: { ...claims, event_name } });
    assert.equal((await app.invoke()).status, 200);
    assert.equal(app.requests.length, 1);
  }
  const invalidSignature = exporter(values, { verificationError: true });
  assert.equal((await invalidSignature.invoke()).status, 401);
  assert.equal(invalidSignature.requests.length, 0);
  const missingToken = exporter(values);
  assert.equal((await missingToken.invoke({ authorization: null })).status, 401);
  assert.equal(missingToken.verifications.length, 0);
  assert.equal(missingToken.requests.length, 0);
  const wrongMethod = exporter(values);
  assert.equal((await wrongMethod.invoke({ method: 'GET' })).status, 405);
  assert.equal(wrongMethod.verifications.length, 0);
  assert.equal(wrongMethod.requests.length, 0);
});
