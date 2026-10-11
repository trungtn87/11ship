#!/usr/bin/env node
// Creates a self-signed certificate for the LOCAL admin web front (https://localhost:8443) in .local/admin-web-tls,
// valid 30 days, for localhost and 127.0.0.1. Needs the openssl command. A browser will warn about it once; a locally
// trusted certificate (for example from mkcert) can be used instead through ADMIN_WEB_TLS_CERT/ADMIN_WEB_TLS_KEY.
// The key never leaves .local/ (git-ignored).
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Writes key.pem and cert.pem into `directory` and returns their paths. */
export function createLocalCertificate(directory, days = 30) {
  mkdirSync(directory, { recursive: true });
  const key = join(directory, 'key.pem');
  const cert = join(directory, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', key, '-out', cert, '-days', String(days),
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-addext', 'extendedKeyUsage=serverAuth',
    ],
    { stdio: 'pipe' },
  );
  chmodSync(key, 0o600);
  return { key, cert };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Optional arguments (used by the browser integration test): target directory and validity in days.
  const directory = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '.local', 'admin-web-tls');
  const days = process.argv[3] === undefined ? 30 : Number(process.argv[3]);
  const { cert } = createLocalCertificate(directory, days);
  console.log(`certificate written to ${cert} (self-signed, localhost + 127.0.0.1, ${String(days)} days)`);
}
