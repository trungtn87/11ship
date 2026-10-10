// Structural checks for render.yaml (M00-D1). This is NOT Render's own validation: it enforces what the project
// authorized (one Free web service, no database/worker, no auto deploy, secrets never inline, no migration in
// build/start) so a later edit cannot widen the scope without a failing test. Official validation with the Render
// CLI (`render blueprints validate render.yaml`) is a separate step when that tool is available.
//
//   node scripts/deploy/validate-render-blueprint.mjs [render.yaml]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../progress/yaml-subset.mjs';

// Variables that must be entered in the Render dashboard (sync: false) and never carry a value in the file.
export const REQUIRED_SECRET_KEYS = [
  'DATABASE_URL',
  'DB_SSL_CA',
  'AUTH_OTP_HMAC_SECRET',
  'CRYPTO_ACTIVE_KEY_ID',
  'CRYPTO_KEYRING',
  'AUTH_STAGING_ALLOWED_PHONES',
  'ADMIN_AUTH_ALLOWED_ORIGINS',
  'ADMIN_RATE_LIMIT_HMAC_KEY',
];

// Any key that looks like a secret must be sync: false, whatever its name is spelled like.
const SECRET_LOOKING_KEY = /(SECRET|PASSWORD|TOKEN|KEYRING|DATABASE_URL|DB_SSL_CA|PRIVATE|CREDENTIAL)/i;
// Literals that must never appear anywhere in the file, comments included.
const FORBIDDEN_LITERALS = [
  [/postgres(ql)?:\/\//i, 'a database connection URL'],
  [/-----BEGIN [A-Z ]+-----/, 'a PEM block'],
  [/\beyJ[A-Za-z0-9_-]{20,}/, 'a JWT-like token'],
  [/\bsb_(secret|publishable)_[A-Za-z0-9_-]+/, 'a Supabase key'],
];

/** Returns a list of problems (empty when the Blueprint is within the authorized scope). */
export function validateRenderBlueprint(text, { nodeVersion } = {}) {
  const problems = [];
  const bad = (message) => problems.push(message);

  for (const [pattern, what] of FORBIDDEN_LITERALS) {
    if (pattern.test(text)) bad(`the file contains ${what}`);
  }

  let blueprint;
  try {
    blueprint = parseYaml(text);
  } catch (error) {
    return [...problems, `not parseable: ${error.message}`];
  }

  const topKeys = Object.keys(blueprint ?? {});
  if (topKeys.length !== 1 || topKeys[0] !== 'services') {
    bad(`only a top-level "services" key is authorized (found: ${topKeys.join(', ') || 'nothing'})`);
  }
  const services = Array.isArray(blueprint?.services) ? blueprint.services : [];
  if (services.length !== 1) {
    bad(`exactly one service is authorized (found ${services.length})`);
    return problems;
  }

  const service = services[0];
  if (service.type !== 'web') bad(`service type must be web (found ${service.type})`);
  if (service.plan !== 'free') bad(`plan must be free (found ${service.plan})`);
  if (service.runtime !== 'node') bad(`runtime must be node (found ${service.runtime})`);
  for (const forbidden of ['disk', 'numInstances', 'scaling', 'dockerfilePath', 'image', 'cronJob', 'schedule']) {
    if (Object.hasOwn(service, forbidden)) bad(`"${forbidden}" is not authorized on the free staging service`);
  }

  if (service.healthCheckPath !== '/v1/health/ready') bad('healthCheckPath must be /v1/health/ready');
  if (service.startCommand !== 'npm start') bad('startCommand must be exactly "npm start"');

  const build = String(service.buildCommand ?? '');
  if (!/\bci\b[^&|;]*--include=dev/.test(build)) bad('buildCommand must run npm ci with --include=dev');
  if (!/\brun build\b/.test(build)) bad('buildCommand must run npm run build');
  for (const [label, command] of [['buildCommand', build], ['startCommand', String(service.startCommand ?? '')]]) {
    if (/migrat/i.test(command)) bad(`${label} must not run migrations (they run explicitly, never at build or start)`);
  }

  // Automatic deploys stay off until the exact reviewed commit has passed remote acceptance.
  if (service.autoDeployTrigger !== 'off') bad('autoDeployTrigger must be "off"');
  if (service.autoDeploy === true) bad('autoDeploy must not be enabled');

  const envVars = Array.isArray(service.envVars) ? service.envVars : [];
  const byKey = new Map();
  for (const entry of envVars) {
    if (typeof entry?.key !== 'string') {
      bad('every envVars entry needs a string key');
      continue;
    }
    if (byKey.has(entry.key)) bad(`duplicate env var ${entry.key}`);
    byKey.set(entry.key, entry);
  }

  const expectValue = (key, value) => {
    const entry = byKey.get(key);
    if (entry === undefined || entry.value !== value) bad(`${key} must be set to ${JSON.stringify(value)}`);
  };
  expectValue('APP_ENV', 'staging');
  expectValue('NODE_ENV', 'production');
  expectValue('HOST', '0.0.0.0');
  expectValue('DB_POOL_MAX', '2');
  if (nodeVersion !== undefined) expectValue('NODE_VERSION', nodeVersion);
  if (byKey.has('PORT')) bad('PORT is supplied by Render and must not be set here');

  for (const entry of byKey.values()) {
    if (entry.value !== undefined && typeof entry.value !== 'string') {
      bad(`${entry.key}: values must be quoted strings`);
    }
    if (SECRET_LOOKING_KEY.test(entry.key) && !(entry.sync === false && entry.value === undefined)) {
      bad(`${entry.key} looks like a secret and must be "sync: false" with no value`);
    }
    if (entry.generateValue !== undefined || entry.fromDatabase !== undefined || entry.fromService !== undefined) {
      bad(`${entry.key}: generateValue/fromDatabase/fromService are not authorized`);
    }
  }
  for (const key of REQUIRED_SECRET_KEYS) {
    const entry = byKey.get(key);
    if (entry === undefined) bad(`${key} must be declared as a secret (sync: false)`);
    else if (entry.sync !== false || entry.value !== undefined) bad(`${key} must be "sync: false" with no value`);
  }
  // The running service must never hold the migration credential.
  for (const key of byKey.keys()) {
    if (/^MIGRATION_/.test(key)) bad(`${key}: the service must not hold migration credentials`);
  }
  // Staging must never be pointed at the in-memory fake OTP path by pretending to be development.
  if (byKey.get('APP_ENV')?.value === 'development') bad('APP_ENV must never be development on Render');

  return problems;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const file = process.argv[2] ?? 'render.yaml';
  let nodeVersion;
  try {
    nodeVersion = readFileSync('.node-version', 'utf8').trim();
  } catch {
    nodeVersion = undefined;
  }
  const problems = validateRenderBlueprint(readFileSync(file, 'utf8'), { nodeVersion });
  if (problems.length > 0) {
    console.error(`${file}: ${problems.length} problem(s)\n- ${problems.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`${file}: within the authorized scope (structural check only; not Render's own validation).`);
  }
}
