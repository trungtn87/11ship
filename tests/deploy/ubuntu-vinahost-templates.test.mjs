// Static checks of the Ubuntu/VinaHost deployment templates (M00-VPS-01, gói B). Nothing here touches a server or a database.
// The env template is also run through the REAL configuration loader of the compiled application (placeholders replaced
// with throwaway valid values), so the template cannot drift from what the service accepts.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const path = (relative) => fileURLToPath(new URL(`../../${relative}`, import.meta.url));
const read = (relative) => readFileSync(path(relative), 'utf8');

const HOST = '103.9.78.67.sslip.io';
const service = read('ops/vinahost/11ship-staging.service');
const envExample = read('ops/vinahost/staging.env.example');
const nginxFull = read('ops/vinahost/nginx-11ship-staging.conf');
const nginxBootstrap = read('ops/vinahost/nginx-11ship-staging-bootstrap.conf');
const runbook = read('ops/runbooks/ubuntu-vinahost-staging.md');

/** The text without comment lines: comments may name what is forbidden (to explain it). */
function code(text) {
  return text.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
}

function parseEnv(text) {
  const env = {};
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      continue;
    }
    const at = line.indexOf('=');
    env[line.slice(0, at)] = line.slice(at + 1);
  }
  return env;
}

describe('systemd unit', () => {
  test('runs as the unprivileged service user from the release root, with no secret inline', () => {
    assert.match(service, /^User=ship11$/m);
    assert.match(service, /^Group=ship11$/m);
    assert.match(service, /^WorkingDirectory=\/opt\/11ship\/current$/m);
    assert.match(service, /^EnvironmentFile=\/etc\/11ship\/staging\.env$/m);
    assert.match(service, /^ExecStart=\/usr\/bin\/env node apps\/backend\/dist\/main\.js$/m);
    assert.match(service, /^NoNewPrivileges=true$/m);
    assert.match(service, /^ProtectSystem=strict$/m);
    assert.match(service, /^Restart=on-failure$/m);
    assert.match(service, /^RestartSec=5$/m);
    const inline = service.split('\n').filter((l) => /^Environment=/.test(l));
    assert.deepEqual(inline, ['Environment=NODE_OPTIONS=--max-old-space-size=384']);
    assert.doesNotMatch(code(service), /password|secret|DATABASE_URL|KEYRING/i);
  });
});

describe('systemd restart limit (review F4)', () => {
  const value = (key) => Number((new RegExp(`^${key}=(\\d+)$`, 'm').exec(service) ?? [])[1]);

  test('the unit bounds its own restart loop, whatever the provider systemd.conf says', () => {
    assert.match(service, /^\[Unit\][\s\S]*^StartLimitIntervalSec=\d+$/m);
    assert.match(service, /^StartLimitBurst=\d+$/m);
    const interval = value('StartLimitIntervalSec');
    const burst = value('StartLimitBurst');
    const restartSec = value('RestartSec');
    assert.ok(interval > 0 && burst > 0 && restartSec > 0);
    // The limit must be reachable: `burst` restarts, each `restartSec` apart, fit inside the interval. (systemd's default of
    // 5 starts in 10 s is NOT reachable with RestartSec=5.)
    assert.ok(burst * restartSec < interval, `${burst} x ${restartSec} s must fit in ${interval} s`);
    // And it is finite and small: at most one restart per minute on average would be weaker than the intent.
    assert.ok(burst <= 10);
    assert.match(service, /reset-failed 11ship-staging/, 'the recovery command is next to the limit');
  });

  test('the runbook tells the operator how to read the error, fix the environment and recover', () => {
    for (const needle of ['start-limit-hit', 'reset-failed', 'journalctl -u 11ship-staging', '/etc/11ship/staging.env']) {
      assert.ok(runbook.includes(needle), `runbook must mention ${needle}`);
    }
  });
});

describe('env template', () => {
  const env = parseEnv(envExample);

  test('is staging, loopback, small pool and contains no real value', () => {
    assert.equal(env.APP_ENV, 'staging');
    assert.equal(env.NODE_ENV, 'production');
    assert.equal(env.HOST, '127.0.0.1');
    assert.equal(env.PORT, '3000');
    assert.equal(env.DB_POOL_MAX, '2');
    for (const key of ['DATABASE_URL', 'AUTH_STAGING_ALLOWED_PHONES', 'AUTH_OTP_HMAC_SECRET', 'CRYPTO_KEYRING', 'ADMIN_RATE_LIMIT_HMAC_KEY']) {
      assert.match(env[key], /<[^>]+>/, `${key} must stay a placeholder`);
    }
  });

  test('uses the runtime role only, over the local verified-TLS endpoint', () => {
    assert.match(env.DATABASE_URL, /^postgres:\/\/ship11_app:<[^>]+>@localhost:5432\/ship11_staging$/);
    assert.doesNotMatch(code(envExample), /ship11_migrator|MIGRATION_|DB_REMOTE_TARGET|sslmode|NODE_TLS_REJECT_UNAUTHORIZED/);
    assert.equal(env.DB_SSL_CA_FILE, '/etc/11ship/db-ca.crt');
    assert.equal(env.DB_SSL_CA, undefined);
  });

  test('keeps the public-host closures: no test OTP provider, activation off, fixtures only', () => {
    assert.equal(env.ADMIN_ACTIVATION_ENABLED, 'false');
    assert.equal(env.OTP_PROVIDER, undefined);
    assert.equal(env.ADMIN_ACTIVATION_OTP_MODE, undefined);
    assert.doesNotMatch(code(envExample), /TEST_INBOX|TEST_DISPLAY|FAKE/);
    assert.equal(env.AUTH_STAGING_FIXTURES_ENABLED, 'true');
    assert.notEqual(env.APP_ENV, 'development');
  });

  test('names one exact https origin, and the activation origin is in the allowlist', () => {
    const origins = JSON.parse(env.ADMIN_AUTH_ALLOWED_ORIGINS);
    assert.deepEqual(origins, [`https://${HOST}`]);
    assert.ok(origins.includes(env.ADMIN_ACTIVATION_ORIGIN));
    assert.deepEqual(JSON.parse(env.ADMIN_AUTH_TRUSTED_PROXY_IPS), ['127.0.0.1']);
  });

  test('is accepted by the real configuration loader once placeholders are filled', () => {
    const configFile = path('apps/backend/dist/config/app-config.js');
    assert.ok(existsSync(configFile), 'the compiled application is missing: run "npm run build" first');
    const { loadConfig } = require(configFile);
    const key32 = Buffer.alloc(32, 7).toString('base64');
    const filled = {
      ...env,
      DATABASE_URL: 'postgres://ship11_app:0123456789abcdef@localhost:5432/ship11_staging',
      DB_SSL_CA_FILE: path('tests/fixtures/selfhosted-test-ca.pem'),
      AUTH_STAGING_ALLOWED_PHONES: '["+84900000001"]',
      AUTH_OTP_HMAC_SECRET: key32,
      CRYPTO_KEYRING: `staging-1:${key32}`,
      ADMIN_RATE_LIMIT_HMAC_KEY: key32,
    };
    const result = loadConfig(filled);
    assert.deepEqual(result.ok ? [] : result.invalid, []);
    assert.equal(result.ok, true);
    // Sanity: the loader really is strict about the things this template promises.
    assert.equal(loadConfig({ ...filled, ADMIN_ACTIVATION_ORIGIN: 'https://other.example' }).ok, false);
    assert.equal(loadConfig({ ...filled, ADMIN_AUTH_ALLOWED_ORIGINS: `["http://${HOST}"]` }).ok, false);
  });
});

describe('nginx', () => {
  test('proxies to loopback and overwrites the forwarding headers', () => {
    assert.match(nginxFull, /proxy_pass http:\/\/127\.0\.0\.1:3000;/);
    assert.match(nginxFull, /proxy_set_header X-Forwarded-For \$remote_addr;/);
    assert.match(nginxFull, /proxy_set_header Forwarded "";/);
    assert.doesNotMatch(nginxFull, /proxy_add_x_forwarded_for/);
    assert.match(nginxFull, new RegExp(`server_name ${HOST.replaceAll('.', '\\.')};`));
    assert.match(nginxFull, /Strict-Transport-Security/);
    assert.match(nginxFull, /server_tokens off;/);
  });

  test('closes unknown Host headers and uses syntax valid for nginx 1.24 (Ubuntu 24.04)', () => {
    assert.ok((nginxFull.match(/return 444;/g) ?? []).length >= 2);
    assert.doesNotMatch(nginxFull, /^\s*http2 on;/m);
    assert.match(nginxFull, /listen 443 ssl http2;/);
    assert.doesNotMatch(nginxFull, /ssl_protocols[^;]*TLSv1(\.1)?\b(?!\.)/);
  });

  test('the HTTP bootstrap serves only the ACME challenge and proxies nothing', () => {
    assert.match(nginxBootstrap, /\.well-known\/acme-challenge/);
    assert.doesNotMatch(nginxBootstrap, /proxy_pass|ssl_certificate/);
  });

  test('the HTTP site of the full config only redirects and answers the challenge', () => {
    const httpBlock = nginxFull.split('server {').filter((b) => /listen 80;/.test(b)).join('');
    assert.match(httpBlock, /return 301 https:\/\/\$host\$request_uri;/);
    assert.doesNotMatch(httpBlock, /proxy_pass/);
  });
});

describe('runbook', () => {
  test('carries the contract and no secret', () => {
    for (const needle of [HOST, '/opt/11ship/releases/', '/opt/11ship/current', 'ship11', '127.0.0.1:3000', 'DB_POOL_MAX', 'sha256sum -c', 'systemctl', 'certbot', 'ADMIN_ACTIVATION_ENABLED=false', 'Rollback']) {
      assert.ok(runbook.includes(needle), `runbook must mention ${needle}`);
    }
    assert.doesNotMatch(runbook, /-----BEGIN|postgres:\/\/[^\s<]+:[^\s<]{4,}@/);
    assert.match(runbook, /CHƯA thực thi trên VPS/);
    const fenced = [...runbook.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
    assert.doesNotMatch(fenced, /APP_ENV=development|NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized/);
  });

  test('every file the runbook tells the operator to install exists in the repository', () => {
    for (const file of ['11ship-staging.service', 'staging.env.example', 'nginx-11ship-staging.conf', 'nginx-11ship-staging-bootstrap.conf']) {
      assert.ok(runbook.includes(file), `runbook must reference ${file}`);
      assert.ok(existsSync(path(`ops/vinahost/${file}`)), `${file} must exist`);
    }
  });
});

describe('build script inputs', () => {
  test('every path the artifact copies exists in the repository or is a build output', async () => {
    const { COPY_ENTRIES, OPERATOR_TOOLS } = await import('../../scripts/deploy/build-ubuntu-artifact.mjs');
    const buildOutputs = new Set(['apps/backend/dist', 'apps/admin-web/dist']);
    for (const [from] of COPY_ENTRIES) {
      assert.ok(buildOutputs.has(from) || existsSync(path(from)), `${from} must exist`);
    }
    assert.deepEqual(OPERATOR_TOOLS, ['node-pg-migrate']);
    const rootManifest = JSON.parse(read('package.json'));
    assert.ok(rootManifest.devDependencies['node-pg-migrate'], 'the operator tool must be a declared dependency');
  });
});

// ---- the real operating build (Owner decision 2026-10-14) -----------------------------------------------------------------------
describe('production env template', () => {
  const production = read('ops/vinahost/production.env.example');
  const env = parseEnv(production);

  test('is the real build: production, loopback, no fixture / test / bypass switch, no secret, no migration credential', () => {
    assert.equal(env.APP_ENV, 'production');
    assert.equal(env.HOST, '127.0.0.1');
    assert.doesNotMatch(code(production), /AUTH_STAGING|DISABLED_TEST|TEST_INBOX|TEST_DISPLAY|FAKE|ship11_migrator|MIGRATION_|DB_REMOTE_TARGET|NODE_TLS_REJECT_UNAUTHORIZED|sslmode/);
    assert.equal(env.ADMIN_ACTIVATION_OTP_MODE, 'SMS');
    assert.equal(env.ACCOUNT_RECOVERY_MODE, 'SMS_OTP');
    assert.equal(env.SMS_GATEWAY_RECIPIENT_MODE, 'ALLOWLIST', 'OPEN is a separate, explicit Owner action');
  });

  test('is accepted by the real configuration loader once placeholders are filled (trust files, keys, CA)', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const configFile = path('apps/backend/dist/config/app-config.js');
    assert.ok(existsSync(configFile), 'the compiled application is missing: run "npm run build" first');
    const { loadConfig } = require(configFile);
    const dir = mkdtempSync(join(tmpdir(), 'prod-env-'));
    const signer = 'ab'.repeat(32);
    writeFileSync(join(dir, 'signers.json'), JSON.stringify({ FOOD: { package_name: 'vn.eleven.food.test', signer_sha256: signer }, SHIP: { package_name: 'vn.eleven.ship.test', signer_sha256: signer } }));
    writeFileSync(join(dir, 'roots.pem'), read('tests/fixtures/selfhosted-test-ca.pem'));
    writeFileSync(join(dir, 'revocation.json'), JSON.stringify({ fetched_at: '2026-10-14T00:00:00Z', entries: {} }));
    const key32 = Buffer.alloc(32, 7).toString('base64');
    const filled = {
      ...env,
      DATABASE_URL: 'postgres://ship11_app:0123456789abcdef@localhost:5432/ship11_staging',
      DB_SSL_CA_FILE: path('tests/fixtures/selfhosted-test-ca.pem'),
      AUTH_OTP_HMAC_SECRET: key32,
      CRYPTO_ACTIVE_KEY_ID: 'prod-1',
      CRYPTO_KEYRING: `prod-1:${key32}`,
      ADMIN_RATE_LIMIT_KEY_ID: 'prod-1',
      ADMIN_RATE_LIMIT_HMAC_KEY: key32,
      SMS_GATEWAY_ALLOWLIST: '0912345678',
      CLIENT_DEVICE_ALLOWED_SIGNERS_FILE: join(dir, 'signers.json'),
      CLIENT_DEVICE_ATTESTATION_ROOTS_FILE: join(dir, 'roots.pem'),
      CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE: join(dir, 'revocation.json'),
    };
    const result = loadConfig(filled);
    assert.deepEqual(result.ok ? [] : result.invalid, []);
    assert.equal(result.ok, true);
    // The guards are real: dropping a trust input, or opening a bypass, stops the start.
    const { CLIENT_DEVICE_ATTESTATION_ROOTS_FILE: _roots, ...withoutRoots } = filled;
    assert.equal(loadConfig(withoutRoots).ok, false);
    assert.equal(loadConfig({ ...filled, CLIENT_AUTH_PHONE_VERIFICATION_MODE: 'DISABLED_TEST' }).ok, false);
    assert.equal(loadConfig({ ...filled, HOST: '0.0.0.0' }).ok, false);
  });
});
