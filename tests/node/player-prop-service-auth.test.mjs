import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const repo = new URL('../../', import.meta.url);
const functions = [
  ['capture-nba-player-props', 7, 'const body ='],
  ['capture-nfl-player-props', 6, 'const body ='],
  ['grade-nba-player-props', 7, 'const supabase ='],
  ['refresh-nba-player-prop-clv', 7, 'const body ='],
];
const fixtureSecret = 'local-gateway-fixture-not-a-project-secret';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function signedFixture(role, subject = 'caller-fixture') {
  const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    iss: 'supabase', ref: 'local-fixture', sub: subject, role, exp: 4102444800,
  })}`;
  return `${content}.${createHmac('sha256', fixtureSecret).update(content).digest('base64url')}`;
}

// This is only a local stand-in for the platform boundary. It demonstrates that
// validly signed anon/authenticated JWTs can pass signature validation without
// gaining the service role. Production signature validation stays at the
// Supabase gateway with verify_jwt=true; the handler authorizes the signed role.
function passesFixtureGateway(token) {
  const pieces = token.split('.');
  if (pieces.length !== 3) return false;
  const [header, payload, signature] = pieces;
  const expected = createHmac('sha256', fixtureSecret).update(`${header}.${payload}`).digest();
  const actual = Buffer.from(signature, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected)
    && JSON.parse(Buffer.from(header, 'base64url')).alg === 'HS256'
    && JSON.parse(Buffer.from(payload, 'base64url')).exp > Date.now() / 1000;
}

function authorizationBoundary(slug, firstWork) {
  const directory = new URL(`supabase/functions/${slug}/`, repo);
  const source = readFileSync(new URL('index.ts', directory), 'utf8');
  const marker = 'Deno.serve(async (req) => {\n  try {';
  const start = source.indexOf(marker);
  const end = source.indexOf(firstWork, start);
  assert.ok(start >= 0 && end > start, `${slug}: actual handler boundary is identifiable`);
  const prefix = source.slice(start + marker.length, end);
  // Execute the actual entrypoint up to its first body read/provider/DB work.
  // The remaining business body is deliberately not run; reaching it is a
  // counted sentinel. This harness needs no TypeScript transpiler in Node 20.
  const helper = new URL('service-role-auth.mjs', directory);
  const helperSource = existsSync(helper) ? readFileSync(helper, 'utf8').replace(/^export /gm, '') : '';
  const touches = { protected: 0, body: 0, provider: 0, environment: 0, database: 0 };
  const handler = vm.runInNewContext(`${helperSource}\n(async req => {${prefix}\nreturn protectedWork();})`, {
    Request, Response, atob,
    protectedWork: () => { touches.protected++; return Response.json({ reachedProtectedWork: true }); },
    fetch: () => { touches.provider++; throw Error('provider work before authorization'); },
    createClient: () => { touches.database++; throw Error('database work before authorization'); },
    Deno: { env: { get: () => { touches.environment++; throw Error('credential read before authorization'); } } },
  });
  const invoke = async ({ authorization, method = 'POST', apikey } = {}) => {
    const headers = new Headers();
    if (authorization !== undefined) headers.set('authorization', authorization);
    if (apikey !== undefined) headers.set('apikey', apikey);
    const req = new Request('https://functions.example.test/', { method, headers });
    req.json = () => { touches.body++; throw Error('body parsed before authorization'); };
    const response = await handler(req);
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  return { invoke, touches };
}

for (const [slug, version, firstWork] of functions) {
  test(`${slug}: signed anon and authenticated callers cannot reach privileged work`, async () => {
    const observed = [];
    for (const role of ['anon', 'authenticated']) {
      const token = signedFixture(role);
      assert.equal(passesFixtureGateway(token), true, 'fixture passed signature/expiry verification');
      const app = authorizationBoundary(slug, firstWork);
      const result = await app.invoke({ authorization: `Bearer ${token}` });
      observed.push({ role, token, app, result });
    }
    assert.deepEqual(observed.map(({ role, result }) => [role, result.status]), [['anon', 401], ['authenticated', 401]], 'neither signed low-privilege role may gain server privileges');
    for (const { token, app, result } of observed) {
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.deepEqual(app.touches, { protected: 0, body: 0, provider: 0, environment: 0, database: 0 });
      assert.ok(!JSON.stringify(result.body).includes(token));
    }
  });

  test(`${slug}: missing, malformed and nonservice claims fail before protected work`, async () => {
    const invalid = [
      undefined, '', 'Basic credentials', 'Bearer opaque-key', 'Bearer a.b',
      'Bearer a.b.c.d', 'Bearer a.!!!.c', 'Bearer a.bm90LWpzb24.c',
      `Bearer a.${encode(null)}.c`, `Bearer a.${encode(['service_role'])}.c`,
      ...[null, false, ['service_role'], { role: 'service_role' }, 'SERVICE_ROLE', ' service_role ']
        .map(role => `Bearer ${signedFixture(role)}`),
    ];
    for (const authorization of invalid) {
      const app = authorizationBoundary(slug, firstWork);
      const result = await app.invoke({ authorization, apikey: signedFixture('service_role') });
      assert.equal(result.status, 401, `invalid Authorization: ${authorization?.slice(0, 25)}`);
      assert.deepEqual(app.touches, { protected: 0, body: 0, provider: 0, environment: 0, database: 0 });
    }
  });

  test(`${slug}: valid service JWTs reach the unchanged body independently of backend credentials`, async () => {
    for (const subject of ['service-caller-a', 'service-caller-b']) {
      const token = signedFixture('service_role', subject);
      assert.equal(passesFixtureGateway(token), true);
      const app = authorizationBoundary(slug, firstWork);
      const result = await app.invoke({ authorization: `bEaReR ${token}` });
      assert.equal(result.status, 200);
      assert.equal(result.body.reachedProtectedWork, true);
      assert.deepEqual(app.touches, { protected: 1, body: 0, provider: 0, environment: 0, database: 0 });
    }
    const wrongMethod = authorizationBoundary(slug, firstWork);
    assert.equal((await wrongMethod.invoke({ method: 'GET' })).status, 405);
    assert.equal(wrongMethod.touches.protected, 0);
  });

  test(`${slug}: gateway verification and the recovered business implementation stay intact`, () => {
    const config = readFileSync(new URL('supabase/config.toml', repo), 'utf8');
    const block = config.split(`[functions.${slug}]`)[1]?.split(/\n\[/)[0];
    assert.match(block || '', /\bverify_jwt\s*=\s*true\b/);
    const directory = new URL(`supabase/functions/${slug}/`, repo);
    const original = new URL(`supabase/deployed-snapshots/${slug}/v${version}/`, repo);
    const current = readFileSync(new URL('index.ts', directory), 'utf8');
    const withoutGuard = current
      .replace('import { isServiceRoleRequest } from "./service-role-auth.mjs";\n', '')
      .replace(/    if \(!isServiceRoleRequest\(req\)\) \{[\s\S]*?\n    \}\n\n/, '');
    assert.equal(withoutGuard, readFileSync(new URL('index.ts', original), 'utf8'), 'only the import and authorization boundary change');
    for (const name of readdirSync(original).filter(name => name !== 'index.ts')) {
      assert.deepEqual(readFileSync(new URL(name, directory)), readFileSync(new URL(name, original)), `${name} remains exact`);
    }
  });
}

test('all four role guards use the same small implementation and retain gateway trust explicitly', () => {
  const guards = functions.map(([slug]) => readFileSync(new URL(`supabase/functions/${slug}/service-role-auth.mjs`, repo), 'utf8'));
  assert.equal(new Set(guards).size, 1);
  assert.match(guards[0], /verify_jwt=true/);
  assert.match(guards[0], /signature/i);
});
