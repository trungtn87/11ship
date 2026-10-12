#!/usr/bin/env node
// Checks of the local HTTPS runtime for the launcher and for people (M00.05). Prints ONE JSON line and exits 0 (ok) or 1.
//
//   node scripts/client-web-check.mjs cert  [--cert <file> --key <file>]
//   node scripts/client-web-check.mjs probe --app <food-web|ship-web|admin-web> --port <n> --cert <file>
//                                           [--expect-sha <40 hex> --expect-fingerprint <64 hex>] [--no-health]
//
// `cert` validates the certificate files (exists, readable, in date, names localhost and 127.0.0.1, key belongs to it).
// `probe` asks the running front for /__11ship/runtime over TLS, accepting only the pinned leaf of --cert (no verification
// switched off, no trust store touched), checks it is the expected app and build, and then reads /v1/health/live and
// /v1/health/ready THROUGH the front and requires the agreed bodies. Nothing secret is read or printed.
// Web Admin (--app admin-web, M00.08) does not forward health: its front forwards only the admin API, so instead of health the
// probe sends ONE cookie-less GET /v1/admin-auth/state through it and requires the backend's own 401 ADMIN_SESSION_INVALID -
// which only a running backend with administration login enabled and a reachable database answers (a disabled login is 404).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CLIENT_RUNTIMES, RUNTIME_PATH } from './client-web-dev.mjs';
import { defaultTlsPaths, inspectTlsFiles, leafFingerprint, pinnedGet } from './lib/local-tls.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function result(ok, code, message, extra = {}) {
  return { ok, code, message, ...extra };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** @returns {Promise<{ok: boolean, code: string, message: string}>} */
export async function probeRuntime({ app, port, certPath, expectSha, expectFingerprint, health = true, timeoutMs = 5000 }) {
  const runtime = CLIENT_RUNTIMES[app];
  if (runtime === undefined) {
    return result(false, 'APP_UNKNOWN', `unknown app: ${String(app)}`);
  }
  let pinned;
  try {
    pinned = leafFingerprint(certPath);
  } catch {
    return result(false, 'TLS_CERT_UNREADABLE', 'the certificate file to pin cannot be read');
  }
  const get = async (path) => {
    try {
      return { answer: await pinnedGet({ port, path, pinnedFingerprint256: pinned, timeoutMs }) };
    } catch (error) {
      const code = String(error?.code ?? '');
      if (code === 'TLS_PIN_MISMATCH') {
        return { failure: result(false, 'TLS_PIN_MISMATCH', 'the server on that port does not present the expected certificate') };
      }
      if (code === 'REQUEST_TIMEOUT') {
        return { failure: result(false, 'PROBE_TIMEOUT', `no answer within ${String(timeoutMs)} ms`) };
      }
      return { failure: result(false, 'PROBE_UNREACHABLE', `the server on port ${String(port)} cannot be reached over HTTPS (${code || 'error'})`) };
    }
  };
  const runtimeAnswer = await get(RUNTIME_PATH);
  if (runtimeAnswer.failure) {
    return runtimeAnswer.failure;
  }
  const identity = runtimeAnswer.answer.status === 200 ? parseJson(runtimeAnswer.answer.body)?.data : undefined;
  if (typeof identity !== 'object' || identity === null) {
    return result(false, 'PROBE_BAD_RESPONSE', `${RUNTIME_PATH} did not answer with the agreed JSON (HTTP ${String(runtimeAnswer.answer.status)})`);
  }
  if (identity.app_id !== runtime.runtimeAppId) {
    return result(false, 'PROBE_IDENTITY_MISMATCH', `the server on port ${String(port)} is not ${runtime.name} (it reports another app)`);
  }
  if ((expectSha !== undefined && identity.source_sha !== expectSha) || (expectFingerprint !== undefined && identity.build_fingerprint !== expectFingerprint)) {
    return result(false, 'PROBE_IDENTITY_MISMATCH', `${runtime.name} on port ${String(port)} runs another build than the expected one`);
  }
  const base = { app_id: identity.app_id, source_sha: identity.source_sha, build_fingerprint: identity.build_fingerprint, design_version: identity.design_version };
  if (!health) {
    return result(true, 'OK', 'identity verified', base);
  }
  if (app === 'admin-web') {
    return probeAdminAuth(get, base);
  }
  const expected = [['/v1/health/live', 'ok'], ['/v1/health/ready', 'ready']];
  for (const [path, status] of expected) {
    const reply = await get(path);
    if (reply.failure) {
      return reply.failure;
    }
    const body = parseJson(reply.answer.body);
    if (reply.answer.status === 503 && path.endsWith('/ready')) {
      return result(false, 'HEALTH_NOT_READY', 'the backend answered through the front, but it is not ready (HTTP 503)', base);
    }
    if (reply.answer.status !== 200 || body?.data?.status !== status) {
      return result(false, 'HEALTH_FAILED', `${path} through the front did not answer HTTP 200 with the agreed body (HTTP ${String(reply.answer.status)})`, base);
    }
  }
  return result(true, 'OK', 'identity and health through the front verified', base);
}

/** The backend behind the Admin front, seen through it: no cookie, no credential, no write. */
async function probeAdminAuth(get, base) {
  const path = '/v1/admin-auth/state';
  const reply = await get(path);
  if (reply.failure) {
    return reply.failure;
  }
  const { status, body } = reply.answer;
  if (status === 401 && parseJson(body)?.error?.code === 'ADMIN_SESSION_INVALID') {
    return result(true, 'OK', 'identity verified and the administration login answers through the front', base);
  }
  if (status === 404) {
    return result(false, 'ADMIN_AUTH_UNAVAILABLE', 'the backend does not serve the administration login (it was started without ADMIN_AUTH_ENABLED=true, or is an older build)', base);
  }
  if (status === 502 || status === 503 || status === 504) {
    return result(false, 'HEALTH_NOT_READY', `the front is up but the backend did not answer ${path} (HTTP ${String(status)})`, base);
  }
  return result(false, 'HEALTH_FAILED', `${path} through the front did not answer the agreed HTTP 401 ADMIN_SESSION_INVALID (HTTP ${String(status)})`, base);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, ...args] = process.argv.slice(2);
  let outcome;
  if (command === 'cert') {
    const defaults = defaultTlsPaths(root);
    const inspected = inspectTlsFiles({ cert: option(args, '--cert') ?? defaults.cert, key: option(args, '--key') ?? defaults.key });
    outcome = inspected.ok ? result(true, 'OK', 'certificate usable', { valid_to: inspected.validTo }) : result(false, inspected.code, inspected.message);
  } else if (command === 'probe') {
    const port = Number(option(args, '--port'));
    const certPath = option(args, '--cert') ?? defaultTlsPaths(root).cert;
    outcome = Number.isInteger(port) && port > 0 && port < 65_536
      ? await probeRuntime({
          app: option(args, '--app'),
          port,
          certPath,
          expectSha: option(args, '--expect-sha'),
          expectFingerprint: option(args, '--expect-fingerprint'),
          health: !args.includes('--no-health'),
        })
      : result(false, 'USAGE', '--port must be a port number');
  } else {
    outcome = result(false, 'USAGE', 'usage: client-web-check <cert|probe> ...');
  }
  console.log(JSON.stringify(outcome));
  process.exit(outcome.ok ? 0 : 1);
}
