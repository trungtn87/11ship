import { createPublicKey, generateKeyPairSync, KeyObject, sign } from 'node:crypto';

/**
 * Throwaway TLS material for unit tests (M00-D1), generated in memory on every run with Node's own crypto.
 * Nothing here is committed as a key or certificate, so there is no key material in the repository to leak or to
 * expire: a CA, a server certificate for "localhost" signed by it, and an unrelated second CA that must NOT
 * verify that server certificate.
 *
 * It is a minimal DER/X.509 v3 writer (ECDSA P-256 with SHA-256). It exists only so the tests can run a real TLS
 * handshake without a CA library or an openssl binary. Never use it outside tests.
 */

// --- DER primitives --------------------------------------------------------------------------------------

function derLength(length: number): Buffer {
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const bytes: number[] = [];
  let rest = length;
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, ...parts: Buffer[]): Buffer {
  const content = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

const sequence = (...parts: Buffer[]): Buffer => der(0x30, ...parts);
const set = (...parts: Buffer[]): Buffer => der(0x31, ...parts);

function integer(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value;
  do {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  } while (rest > 0);
  if ((bytes[0] ?? 0) & 0x80) {
    bytes.unshift(0);
  }
  return der(0x02, Buffer.from(bytes));
}

function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const first = (parts[0] ?? 0) * 40 + (parts[1] ?? 0);
  const bytes: number[] = [first];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f];
    let rest = Math.floor(part / 128);
    while (rest > 0) {
      chunk.unshift((rest & 0x7f) | 0x80);
      rest = Math.floor(rest / 128);
    }
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
}

const utf8String = (text: string): Buffer => der(0x0c, Buffer.from(text, 'utf8'));
const utcTime = (text: string): Buffer => der(0x17, Buffer.from(text, 'ascii'));
const octetString = (content: Buffer): Buffer => der(0x04, content);
const bitString = (content: Buffer, unusedBits = 0): Buffer =>
  der(0x03, Buffer.from([unusedBits]), content);
const boolTrue = (): Buffer => der(0x01, Buffer.from([0xff]));

const OID_COMMON_NAME = '2.5.4.3';
const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_KEY_USAGE = '2.5.29.15';
const OID_SUBJECT_ALT_NAME = '2.5.29.17';

const name = (commonName: string): Buffer =>
  sequence(set(sequence(oid(OID_COMMON_NAME), utf8String(commonName))));

function extension(id: string, value: Buffer, critical: boolean): Buffer {
  return sequence(oid(id), ...(critical ? [boolTrue()] : []), octetString(value));
}

// --- Certificate -----------------------------------------------------------------------------------------

interface CertificateSpec {
  readonly serial: number;
  readonly subjectCommonName: string;
  readonly subjectKey: KeyObject;
  readonly issuerCommonName: string;
  readonly issuerPrivateKey: KeyObject;
  readonly isCa: boolean;
  /** DNS names for subjectAltName (leaf certificates). */
  readonly dnsNames?: readonly string[];
}

function createCertificatePem(spec: CertificateSpec): string {
  const spki = createPublicKey(spec.subjectKey).export({ type: 'spki', format: 'der' });
  const extensions: Buffer[] = [
    // basicConstraints: CA:TRUE for the CA, an empty sequence (CA:FALSE) for the leaf.
    extension(
      OID_BASIC_CONSTRAINTS,
      sequence(...(spec.isCa ? [boolTrue()] : [])),
      true,
    ),
    // keyUsage: keyCertSign + cRLSign (bits 5,6) for the CA; digitalSignature (bit 0) for the leaf.
    extension(
      OID_KEY_USAGE,
      spec.isCa ? bitString(Buffer.from([0x06]), 1) : bitString(Buffer.from([0x80]), 7),
      true,
    ),
  ];
  if (spec.dnsNames !== undefined && spec.dnsNames.length > 0) {
    const generalNames = spec.dnsNames.map((dns) => der(0x82, Buffer.from(dns, 'ascii')));
    extensions.push(extension(OID_SUBJECT_ALT_NAME, sequence(...generalNames), false));
  }

  const signatureAlgorithm = sequence(oid(OID_ECDSA_SHA256));
  const tbs = sequence(
    der(0xa0, integer(2)), // version v3
    integer(spec.serial),
    signatureAlgorithm,
    name(spec.issuerCommonName),
    sequence(utcTime('200101000000Z'), utcTime('491231235959Z')),
    name(spec.subjectCommonName),
    spki,
    der(0xa3, sequence(...extensions)),
  );
  const signature = sign('sha256', tbs, { key: spec.issuerPrivateKey, dsaEncoding: 'der' });
  const certificate = sequence(tbs, signatureAlgorithm, bitString(signature));

  const base64 = certificate.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${base64.join('\n')}\n-----END CERTIFICATE-----\n`;
}

export interface TestPki {
  /** Trusted CA (PEM). Signed the server certificate. */
  readonly caPem: string;
  /** An unrelated CA (PEM). Must NOT verify the server certificate. */
  readonly otherCaPem: string;
  /** Server certificate for "localhost" (SAN DNS:localhost only, no IP address), signed by caPem. */
  readonly serverCertPem: string;
  readonly serverKeyPem: string;
}

export function createTestPki(): TestPki {
  const ec = { namedCurve: 'P-256' } as const;
  const ca = generateKeyPairSync('ec', ec);
  const other = generateKeyPairSync('ec', ec);
  const server = generateKeyPairSync('ec', ec);

  const caPem = createCertificatePem({
    serial: 1,
    subjectCommonName: 'Test DB CA',
    subjectKey: ca.privateKey,
    issuerCommonName: 'Test DB CA',
    issuerPrivateKey: ca.privateKey,
    isCa: true,
  });
  const otherCaPem = createCertificatePem({
    serial: 2,
    subjectCommonName: 'Unrelated Test CA',
    subjectKey: other.privateKey,
    issuerCommonName: 'Unrelated Test CA',
    issuerPrivateKey: other.privateKey,
    isCa: true,
  });
  const serverCertPem = createCertificatePem({
    serial: 3,
    subjectCommonName: 'localhost',
    subjectKey: server.privateKey,
    issuerCommonName: 'Test DB CA',
    issuerPrivateKey: ca.privateKey,
    isCa: false,
    dnsNames: ['localhost'],
  });
  const serverKeyPem = server.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  return { caPem, otherCaPem, serverCertPem, serverKeyPem };
}
