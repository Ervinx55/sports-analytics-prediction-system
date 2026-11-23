import test from 'node:test';
import assert from 'node:assert/strict';
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

const override = 'eyJ.server-override.test-only';
const legacy = 'eyJ.injected-legacy.test-only';
const modern = ['sb', 'secret', 'test-only'].join('_');

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
