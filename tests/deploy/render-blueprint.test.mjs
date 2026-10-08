// M00-D1: the shipped render.yaml stays inside what the Owner authorized. Pure Node, no dependencies; runs with
// `npm run deploy:test` (also in CI). This is a structural check, not Render's own Blueprint validation.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateRenderBlueprint, REQUIRED_SECRET_KEYS } from '../../scripts/deploy/validate-render-blueprint.mjs';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(fileURLToPath(new URL(path, root)), 'utf8');
const shipped = read('render.yaml');
const nodeVersion = read('.node-version').trim();

const problemsOf = (text) => validateRenderBlueprint(text, { nodeVersion });
// Replaces exactly one occurrence; a typo in the test fails loudly instead of testing nothing.
const mutate = (from, to) => {
  assert.ok(shipped.includes(from), `fixture drifted: ${from}`);
  return shipped.replace(from, to);
};
const expectProblem = (text, pattern) => {
  const problems = problemsOf(text);
  assert.ok(problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}, got:\n- ${problems.join('\n- ')}`);
};

describe('shipped render.yaml', () => {
  test('is within the authorized scope', () => {
    assert.deepEqual(problemsOf(shipped), []);
  });

  test('pins the Node version of .node-version', () => {
    assert.match(shipped, new RegExp(`key: NODE_VERSION\\s+value: "${nodeVersion.replaceAll('.', '\\.')}"`));
  });

  test('declares every required secret with sync: false and no value', () => {
    for (const key of REQUIRED_SECRET_KEYS) {
      assert.match(shipped, new RegExp(`- key: ${key}\\n\\s+sync: false\\n`), key);
    }
  });
});

describe('the validator rejects a widened Blueprint', () => {
  test('a Render database or any other top-level resource', () => {
    expectProblem(`${shipped}\ndatabases:\n  - name: db\n    plan: free\n`, /only a top-level "services"/);
  });

  test('a second service (worker, cron, anything)', () => {
    expectProblem(
      `${shipped}  - type: worker\n    name: dispatcher\n    runtime: node\n    plan: starter\n`,
      /exactly one service/,
    );
  });

  test('a paid plan, a disk, more instances', () => {
    expectProblem(mutate('plan: free', 'plan: starter'), /plan must be free/);
    expectProblem(mutate('    plan: free\n', '    plan: free\n    disk:\n      name: d\n      sizeGB: 1\n'), /"disk" is not authorized/);
    expectProblem(mutate('    plan: free\n', '    plan: free\n    numInstances: 2\n'), /"numInstances" is not authorized/);
  });

  test('automatic deploys', () => {
    expectProblem(mutate('autoDeployTrigger: "off"', 'autoDeployTrigger: commit'), /autoDeployTrigger must be "off"/);
    expectProblem(mutate('autoDeployTrigger: "off"', 'autoDeployTrigger: "off"\n    autoDeploy: true'), /autoDeploy must not be enabled/);
  });

  test('a migration in build or start', () => {
    expectProblem(mutate('run build\n', 'run build && npm run db:migrate\n'), /buildCommand must not run migrations/);
    expectProblem(mutate('startCommand: npm start', 'startCommand: npm run db:migrate && npm start'), /startCommand/);
  });

  test('a build that would skip the TypeScript compiler', () => {
    expectProblem(mutate('ci --include=dev', 'ci'), /--include=dev/);
  });

  test('the wrong health check, host or environment', () => {
    expectProblem(mutate('/v1/health/ready', '/v1/health/live'), /healthCheckPath/);
    expectProblem(mutate('value: 0.0.0.0', 'value: 127.0.0.1'), /HOST must be set/);
    expectProblem(mutate('key: APP_ENV\n        value: staging', 'key: APP_ENV\n        value: development'), /APP_ENV must be set/);
    expectProblem(mutate('key: APP_ENV\n        value: staging', 'key: APP_ENV\n        value: development'), /never be development/);
  });

  test('a secret written into the file instead of sync: false', () => {
    expectProblem(
      mutate('key: AUTH_OTP_HMAC_SECRET\n        sync: false', 'key: AUTH_OTP_HMAC_SECRET\n        value: "abc"'),
      /AUTH_OTP_HMAC_SECRET.*sync: false/,
    );
    expectProblem(
      mutate('key: CRYPTO_KEYRING\n        sync: false', 'key: CRYPTO_KEYRING\n        generateValue: true'),
      /CRYPTO_KEYRING/,
    );
  });

  test('a missing secret declaration', () => {
    expectProblem(mutate('      - key: DB_SSL_CA\n        sync: false\n', ''), /DB_SSL_CA must be declared/);
  });

  test('connection URLs, PEM blocks and tokens anywhere in the file, comments included', () => {
    expectProblem(`${shipped}# postgresql://user:pw@host:5432/postgres\n`, /connection URL/);
    expectProblem(`${shipped}# -----BEGIN CERTIFICATE-----\n`, /PEM block/);
    expectProblem(`${shipped}# eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef\n`, /JWT-like/);
    expectProblem(`${shipped}# sb_secret_abcdefghij\n`, /Supabase key/);
  });

  test('the migration credential on the running service, and a PORT override', () => {
    expectProblem(mutate('      - key: DB_SSL_CA\n', '      - key: MIGRATION_DATABASE_URL\n        sync: false\n      - key: DB_SSL_CA\n'), /must not hold migration credentials/);
    expectProblem(mutate('      - key: DB_POOL_MAX\n', '      - key: PORT\n        value: "3000"\n      - key: DB_POOL_MAX\n'), /PORT is supplied by Render/);
  });

  test('an unquoted number would reach Render as a number, not a string', () => {
    expectProblem(mutate('value: "2"', 'value: 2'), /(DB_POOL_MAX must be set|quoted strings)/);
  });
});
