#!/usr/bin/env node
// Self-signed certificate for the LOCAL native gateway (scripts/native-gateway.mjs), in .local/native-gateway-tls (git-ignored).
// Usage: node scripts/native-gateway-cert.mjs <lan-ip-or-host> [days]
// The certificate names localhost, 127.0.0.1 and the address you pass (the one in the phone's API_BASE_URL). It is a CA certificate
// on purpose: copy cert.pem to the phone and install it as a CA certificate (mobile/README.md), so the phone verifies the server
// NORMALLY against it. Needs the openssl command. TEST PACKAGE ONLY - not a production certificate policy.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const host = process.argv[2];
if (host === undefined || !/^[A-Za-z0-9.-]{1,253}$/.test(host)) {
  console.error('usage: node scripts/native-gateway-cert.mjs <lan-ip-or-host> [days]');
  process.exit(2);
}
const days = process.argv[3] === undefined ? 30 : Number(process.argv[3]);
const directory = join(dirname(fileURLToPath(import.meta.url)), '..', '.local', 'native-gateway-tls');
mkdirSync(directory, { recursive: true });
const key = join(directory, 'key.pem');
const cert = join(directory, 'cert.pem');
const isIp = /^[0-9.]+$/.test(host);
execFileSync(
  'openssl',
  [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
    '-keyout', key, '-out', cert, '-days', String(days),
    '-subj', '/CN=11Ship local native gateway',
    '-addext', `subjectAltName=DNS:localhost,IP:127.0.0.1,${isIp ? 'IP' : 'DNS'}:${host}`,
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'extendedKeyUsage=serverAuth',
  ],
  { stdio: 'pipe' },
);
chmodSync(key, 0o600);
console.log(`certificate written to ${cert} (${String(days)} days, localhost + 127.0.0.1 + ${host}); the key stays in ${key}`);
