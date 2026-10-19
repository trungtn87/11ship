#!/usr/bin/env node
// Internal only. Uses the application's own parsers, trust provider and freshness guard.
const { readFileSync, realpathSync } = require('node:fs');
const { resolve, isAbsolute } = require('node:path');

class DiagnosticError extends Error {}

async function checkAndroid(env = process.env, root = process.env.SHIP11_DIAGNOSTIC_ROOT ?? resolve(__dirname, '../..'), now = Date.now()) {
  const { parseClientDevice } = require(`${root}/apps/backend/dist/config/client-device-config.js`);
  const { trustFromConfig } = require(`${root}/apps/backend/dist/client-device/client-device-trust.js`);
  const { currentSnapshot } = require(`${root}/apps/backend/dist/client-device/android-attestation.js`);
  const result = parseClientDevice({ appEnv: env.APP_ENV, host: env.HOST ?? '127.0.0.1', env });
  if (!result.ok) throw new DiagnosticError(`invalid variables: ${result.invalid.join(', ')}`);
  if (env.APP_ENV !== 'production' || !result.config) throw new DiagnosticError('production Android trust is unavailable');
  for (const name of ['CLIENT_DEVICE_ALLOWED_SIGNERS_FILE', 'CLIENT_DEVICE_ATTESTATION_ROOTS_FILE', 'CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE', 'DB_SSL_CA_FILE', 'PUSH_FCM_SERVICE_ACCOUNT_FILE']) {
    if (!env[name]) continue;
    const file = realpathSync(env[name]);
    if (!isAbsolute(env[name]) || file.startsWith('/opt/11ship/releases/') || /^\/(tmp|run|dev|proc|sys)(\/|$)/.test(file) || file.startsWith(`${realpathSync(root)}/`)) {
      throw new DiagnosticError(`persistent path required: ${name}`);
    }
    readFileSync(file);
  }
  if (env.SHIP11_EXPECT_REVOCATION && realpathSync(result.config.revocationFile) !== realpathSync(env.SHIP11_EXPECT_REVOCATION)) throw new DiagnosticError('refresh target differs from runtime snapshot');
  const trust = trustFromConfig(result.config);
  trust.nowMs = () => now;
  // Same guard used BEFORE certificate verification; no synthetic device certificate is accepted.
  let snapshot;
  if (currentSnapshot) {
    try { snapshot = await currentSnapshot(trust); }
    catch { throw new DiagnosticError('snapshot unreadable, invalid, expired or future-dated'); }
  } else {
    const { verifyAttestation } = require(`${root}/apps/backend/dist/client-device/android-attestation.js`);
    try { await verifyAttestation(trust, { chain: [], app: 'FOOD', expectedSpki: Buffer.alloc(0) }); }
    catch (error) { if (error.code !== 'DEVICE_PROOF_INVALID') throw new DiagnosticError('snapshot unavailable or stale'); }
    snapshot = await trust.revocation();
  }
  const ageHours = (now - snapshot.fetchedAtMs) / 3600000;
  if (!trust.roots.some(root => root.ca && Date.parse(root.validFrom) <= now && Date.parse(root.validTo) >= now)) {
    throw new DiagnosticError('no currently valid pinned root');
  }
  if (ageHours >= 18) throw new DiagnosticError('snapshot approaching expiry (18h); refresh required');
  return { androidTrust: 'ready', signers: Object.values(trust.signers).map(s => ({ packageName: s.packageName, certificateSha256: s.signerSha256 })), pinnedRootFingerprints: trust.roots.map(root => root.fingerprint256), snapshotAgeHours: Math.round(ageHours * 100) / 100 };
}

async function main() {
  const root = process.env.SHIP11_DIAGNOSTIC_ROOT ?? resolve(__dirname, '../..');
  const mode = process.argv[2] ?? 'check';
  if (mode === 'plan' || mode === 'apply') {
    if (process.env.DB_REMOTE_TARGET !== 'SELF_HOSTED' || process.env.APP_ENV !== 'production') throw new DiagnosticError('production SELF_HOSTED target required');
    const { main } = require(`${root}/scripts/db-migrate-remote.js`);
    const lines = [];
    const code = await main({ argv: mode === 'apply' ? ['--apply'] : [], env: process.env, out: line => lines.push(line), err: () => {} });
    if (code !== 0) throw new Error('migration preflight failed; run db:migrate:remote for safe diagnostics');
    if (mode === 'apply') { console.log('reviewed migrations applied'); return; }
    console.log(JSON.stringify(lines.filter(line => line.startsWith('db:migrate:remote:   pending ')).map(line => line.slice('db:migrate:remote:   pending '.length))));
    return;
  }
  if (mode !== 'check') throw new Error('unknown mode');
  const { loadConfig } = require(`${root}/apps/backend/dist/config/app-config.js`);
  const config = loadConfig(process.env);
  if (!config.ok) throw new DiagnosticError(`invalid variables: ${config.invalid.join(', ')}`);
  const result = await checkAndroid();
  const { Client } = require(`${root}/node_modules/pg`);
  const db = config.config.database;
  const client = new Client({ connectionString: db.url, ssl: db.tls, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
  client.on('error', () => {});
  try { await client.connect(); await client.query('SELECT 1'); } finally { await client.end(); }
  console.log(JSON.stringify({ ...result, database: 'reachable', uid: process.getuid() }));
}
module.exports = { checkAndroid };
if (require.main === module) main().catch(error => {
  // Never forward arbitrary I/O/DB errors, which can contain connection strings or file contents.
  console.error(error instanceof DiagnosticError ? `11ship-readiness: ${error.message}` : '11ship-readiness: FAILED (configuration/file read/DB); no secrets logged');
  process.exitCode = 1;
});
