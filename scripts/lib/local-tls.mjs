// The local HTTPS certificate of the three PC entries (Admin 8443, Food 8444, Ship 8445), shared by the servers, the
// launcher's pre-flight and the readiness probe. LOCAL USE ONLY.
//
// One leaf certificate for `localhost` and `127.0.0.1` serves every port (a certificate does not name a port), so the
// certificate procedure of the Admin front (`npm run admin-web:cert`, or mkcert files) is also the one for Food and Ship.
// Nothing here installs a certificate authority, edits a trust store or switches TLS verification off. Trust in the
// browser is an Owner decision made once (see ops/runbooks/local-https-runtime.md).
//
// The probe does not turn verification off either: it PINS the leaf. It reads the certificate file the server was started
// with and accepts the peer only when its fingerprint is exactly that certificate's, for this one connection.
import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { connect as tlsConnect } from 'node:tls';

/** Where the certificate lives unless told otherwise: the directory `npm run admin-web:cert` writes. */
export function defaultTlsPaths(root, env = process.env) {
  const directory = join(root, '.local', 'admin-web-tls');
  return {
    cert: env.CLIENT_WEB_TLS_CERT ?? env.ADMIN_WEB_TLS_CERT ?? join(directory, 'cert.pem'),
    key: env.CLIENT_WEB_TLS_KEY ?? env.ADMIN_WEB_TLS_KEY ?? join(directory, 'key.pem'),
  };
}

function problem(code, message) {
  return { ok: false, code, message };
}

/**
 * Checks the certificate and key files WITHOUT printing any of their content. Closed list of codes:
 * TLS_CERT_MISSING, TLS_KEY_MISSING, TLS_CERT_UNREADABLE, TLS_KEY_UNREADABLE, TLS_CERT_EXPIRED, TLS_CERT_NOT_YET_VALID,
 * TLS_CERT_SAN_MISMATCH (must name `localhost` and `127.0.0.1`), TLS_KEY_MISMATCH (key is not the certificate's).
 */
export function inspectTlsFiles({ cert, key, now = new Date() }) {
  if (!existsSync(cert)) {
    return problem('TLS_CERT_MISSING', 'the certificate file does not exist');
  }
  if (!existsSync(key)) {
    return problem('TLS_KEY_MISSING', 'the private key file does not exist');
  }
  let certificate;
  try {
    certificate = new X509Certificate(readFileSync(cert));
  } catch {
    return problem('TLS_CERT_UNREADABLE', 'the certificate file cannot be read as an X.509 certificate');
  }
  let privateKey;
  try {
    privateKey = createPrivateKey(readFileSync(key));
  } catch {
    return problem('TLS_KEY_UNREADABLE', 'the private key file cannot be read');
  }
  if (now < new Date(certificate.validFrom)) {
    return problem('TLS_CERT_NOT_YET_VALID', `the certificate is valid only from ${new Date(certificate.validFrom).toISOString()}`);
  }
  if (now > new Date(certificate.validTo)) {
    return problem('TLS_CERT_EXPIRED', `the certificate expired on ${new Date(certificate.validTo).toISOString()}`);
  }
  if (certificate.checkHost('localhost', { subject: 'never' }) === undefined || certificate.checkIP('127.0.0.1') === undefined) {
    return problem('TLS_CERT_SAN_MISMATCH', 'the certificate must name both localhost and 127.0.0.1 in subjectAltName (the common name alone does not count)');
  }
  if (!certificate.checkPrivateKey(privateKey)) {
    return problem('TLS_KEY_MISMATCH', 'the private key is not the key of this certificate');
  }
  return {
    ok: true,
    validTo: new Date(certificate.validTo).toISOString(),
    fingerprint256: certificate.fingerprint256,
  };
}

/** Fingerprint (SHA-256 of the DER form) of the leaf in a PEM/DER file. */
export function leafFingerprint(certPath) {
  return new X509Certificate(readFileSync(certPath)).fingerprint256;
}

/**
 * GET over HTTPS to 127.0.0.1:<port> with `Host: localhost:<port>`, accepting ONLY the pinned leaf. The TLS socket is
 * opened first, its peer certificate is compared with the pinned one, and only then is the HTTP request written on that very
 * socket; a different certificate ends the attempt before any request leaves. The answer is capped at `maxBytes`.
 * Resolves { status, headers, body } or rejects with an Error whose `code` is TLS_PIN_MISMATCH, REQUEST_TIMEOUT,
 * RESPONSE_TOO_LARGE or the socket's own code (ECONNREFUSED, ...).
 */
export function pinnedGet({ port, path, pinnedFingerprint256, timeoutMs = 5000, maxBytes = 65_536 }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
    const fail = (code, message) => finish(Object.assign(new Error(message), { code }));
    const socket = tlsConnect({ host: '127.0.0.1', port, servername: 'localhost', rejectUnauthorized: false, minVersion: 'TLSv1.2' });
    const timer = setTimeout(() => fail('REQUEST_TIMEOUT', 'no complete answer within the time limit'), timeoutMs);
    socket.once('error', (error) => finish(error));
    socket.once('secureConnect', () => {
      const peer = socket.getPeerCertificate();
      const fingerprint = peer?.raw === undefined ? '' : createHash('sha256').update(peer.raw).digest('hex').toUpperCase().replace(/(..)(?=.)/g, '$1:');
      if (fingerprint !== pinnedFingerprint256.toUpperCase()) {
        fail('TLS_PIN_MISMATCH', 'the server presented a certificate other than the pinned one');
        return;
      }
      const request = httpRequest({ createConnection: () => socket, host: 'localhost', port, path, method: 'GET', headers: { host: `localhost:${String(port)}`, accept: 'application/json', connection: 'close' } }, (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            fail('RESPONSE_TOO_LARGE', 'the answer is larger than the limit');
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => finish(undefined, { status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', (error) => finish(error));
      });
      request.on('error', (error) => finish(error));
      request.end();
    });
  });
}
