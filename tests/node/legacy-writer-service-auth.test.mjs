import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const repo = new URL('../../', import.meta.url);
const functions = [
  [
    "capture-model-audit",
    "adf1d7d314da60f2d4dd137ef83b1717d057b9040c30daddf71c5423af66e3ad",
    "const body ="
  ],
  [
    "capture-player-props",
    "cc0925710e336d0a2ddff033a7da380e1f4b5c4b5686bbb2ce8a576674a4a9a4",
    "const body ="
  ],
  [
    "capture-sharp-clv",
    "f107877c86dae9ae3fd39a4639de9c99c3b30e2ba7d6cc7afb16603ac9f91b27",
    "const supabase ="
  ],
  [
    "evaluate-sharp-gate",
    "72e065f9012545f8f649e8c98e332490b8e6b371bc774be6c5754a552d9b7d25",
    "const body ="
  ],
  [
    "ingest-sharp-board",
    "fb904461827a94a630468ea330f3227fcb6799b17c5a17bde560f0c23aa9e68b",
    "const body ="
  ]
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
  const marker = /Deno\.serve\(async\s*\(req\)\s*=>\s*\{\s*try\s*\{/.exec(source);
  const start = marker?.index ?? -1;
  const end = source.indexOf(firstWork, start);
  assert.ok(start >= 0 && end > start, `${slug}: actual handler boundary is identifiable`);
  const prefix = source.slice(start + marker[0].length, end);
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

for (const [slug, baselineHash, firstWork] of functions) {
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
    const current = readFileSync(new URL('index.ts', directory), 'utf8');
    const withoutGuard = current
      .replace('import { isServiceRoleRequest } from "./service-role-auth.mjs";\n', '')
      .replace(/    if \(!isServiceRoleRequest\(req\)\) \{[\s\S]*?\n    \}\n\n/, '');
    assert.equal(createHash('sha256').update(withoutGuard).digest('hex'), baselineHash, 'only the import and authorization boundary change from the exact reviewed deployment');
    assert.equal(createHash('sha256').update(readFileSync(new URL('service-role-key.mjs', directory))).digest('hex'), '49421acce8f99faf6f7c61a024abff54f891deb39b0cde01f01424472431098d', 'server credential helper remains unchanged');
  });
}

test('all five role guards use the same small implementation and retain gateway trust explicitly', () => {
  const guards = functions.map(([slug]) => readFileSync(new URL(`supabase/functions/${slug}/service-role-auth.mjs`, repo), 'utf8'));
  assert.equal(new Set(guards).size, 1);
  assert.match(guards[0], /verify_jwt=true/);
  assert.match(guards[0], /signature/i);
});
