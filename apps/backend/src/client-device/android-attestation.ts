import { createHash, timingSafeEqual, X509Certificate } from 'node:crypto';
import { AppError, TechnicalError } from '../common/app-errors';
import { ClientApp } from '../client-auth/client-auth-constants';
import { RevocationSnapshot } from '../config/client-device-config';
import {
  children,
  DerError,
  DerNode,
  explicitInner,
  isUniversal,
  parseOne,
  TAG_INTEGER,
  TAG_OCTET_STRING,
  TAG_SEQUENCE,
  TAG_SET,
  toBoolean,
  toOctets,
  toOid,
  toSmallInteger,
} from './der';
import { ClientDeviceTrust } from './client-device-trust';

// Server side of Android Key Attestation (contract11 section 7). Everything here is deterministic and uses ONLY the roots the
// operator pinned (ClientDeviceTrust.roots): no OS trust store, no root supplied by the client, no accept-all path and no
// software-level fallback. A chain that does not satisfy the whole policy is DEVICE_PROOF_INVALID; a key that is genuine but
// not TEE / StrongBox / locked-verified-boot is DEVICE_PROOF_UNSUPPORTED; a stale or missing revocation snapshot is a 503.

/** id-ce attestation extension of Android Keystore. */
export const ATTESTATION_EXTENSION_OID = '1.3.6.1.4.1.11129.2.1.17';

const SECURITY_LEVEL_TEE = 1;
const SECURITY_LEVEL_STRONGBOX = 2;
const PURPOSE_SIGN = 2;
const ALGORITHM_EC = 3;
const DIGEST_SHA256 = 4;
const EC_CURVE_P256 = 1;
const ORIGIN_GENERATED = 0;
const BOOT_VERIFIED = 0;

// AuthorizationList tags (Android Keystore attestation schema).
const TAG_PURPOSE = 1;
const TAG_ALGORITHM = 2;
const TAG_DIGEST = 5;
const TAG_EC_CURVE = 10;
const TAG_ORIGIN = 702;
const TAG_ROOT_OF_TRUST = 704;
const TAG_ATTESTATION_APPLICATION_ID = 709;

const MAX_CHAIN_LENGTH = 8;
const MAX_CHAIN_BYTES = 48 * 1024;
/** The revocation snapshot and the roots are valid at most 24 hours (contract11 section 7). */
export const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type AttestationLevel = 'TEE' | 'STRONGBOX';

export interface AuthorizationFacts {
  purposes: number[] | undefined;
  algorithm: number | undefined;
  curve: number | undefined;
  digests: number[] | undefined;
  origin: number | undefined;
  rootOfTrust: { deviceLocked: boolean; verifiedBootState: number } | undefined;
  application: { packageNames: string[]; signatureDigests: Buffer[] } | undefined;
}

export interface KeyDescription {
  attestationSecurityLevel: number;
  keymasterSecurityLevel: number;
  challenge: Buffer;
  software: AuthorizationFacts;
  tee: AuthorizationFacts;
}

export interface VerifiedAttestation {
  readonly level: AttestationLevel;
  readonly packageName: string;
  readonly signerSha256: Buffer;
  readonly publicKeySpki: Buffer;
}

export interface AttestationRequest {
  /** DER certificates, leaf first. */
  readonly chain: readonly Buffer[];
  readonly app: ClientApp;
  /** The server nonce the leaf must carry as attestationChallenge (ENROLL / JOIN); undefined for AUTH (provenance only). */
  readonly expectedChallenge: Buffer | undefined;
  readonly expectedSpki: Buffer;
}

function invalid(): never {
  throw new AppError('DEVICE_PROOF_INVALID');
}

function unsupported(): never {
  throw new AppError('DEVICE_PROOF_UNSUPPORTED');
}

function equalBuffers(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The value (OCTET STRING content) of one extension of a DER certificate, or undefined. */
export function findCertificateExtension(certificateDer: Buffer, oid: string): Buffer | undefined {
  const certificate = parseOne(certificateDer);
  const tbs = children(certificate)[0];
  if (tbs === undefined || !isUniversal(tbs, TAG_SEQUENCE)) {
    throw new DerError('bad certificate');
  }
  const fields = children(tbs);
  const extensionsWrapper = fields.find((field) => field.tagClass === 2 && field.tagNumber === 3);
  if (extensionsWrapper === undefined) {
    return undefined;
  }
  const list = explicitInner(extensionsWrapper);
  let found: Buffer | undefined;
  for (const extension of children(list)) {
    const parts = children(extension);
    const id = parts[0];
    const value = parts[parts.length - 1];
    if (id === undefined || value === undefined || parts.length < 2 || parts.length > 3) {
      throw new DerError('bad extension');
    }
    if (toOid(id) === oid) {
      if (found !== undefined) {
        throw new DerError('duplicate extension');
      }
      found = toOctets(value);
    }
  }
  return found;
}

function integerSet(node: DerNode): number[] {
  if (!isUniversal(node, TAG_SET)) {
    throw new DerError('expected set');
  }
  return children(node).map(toSmallInteger);
}

function parseApplicationId(octets: Buffer): AuthorizationFacts['application'] {
  const sequence = parseOne(octets);
  if (!isUniversal(sequence, TAG_SEQUENCE)) {
    throw new DerError('bad application id');
  }
  const [packages, signatures] = children(sequence);
  if (packages === undefined || signatures === undefined || !isUniversal(packages, TAG_SET) || !isUniversal(signatures, TAG_SET)) {
    throw new DerError('bad application id');
  }
  const packageNames = children(packages).map((info) => {
    const name = children(info)[0];
    if (name === undefined || !isUniversal(info, TAG_SEQUENCE)) {
      throw new DerError('bad package info');
    }
    return toOctets(name).toString('utf8');
  });
  const signatureDigests = children(signatures).map(toOctets);
  return { packageNames, signatureDigests };
}

function parseAuthorizationList(node: DerNode): AuthorizationFacts {
  if (!isUniversal(node, TAG_SEQUENCE)) {
    throw new DerError('bad authorization list');
  }
  const facts: AuthorizationFacts = {
    purposes: undefined,
    algorithm: undefined,
    curve: undefined,
    digests: undefined,
    origin: undefined,
    rootOfTrust: undefined,
    application: undefined,
  };
  let previousTag = -1;
  for (const field of children(node)) {
    if (field.tagClass !== 2 || field.tagNumber <= previousTag) {
      throw new DerError('authorization list order');
    }
    previousTag = field.tagNumber;
    switch (field.tagNumber) {
      case TAG_PURPOSE:
        facts.purposes = integerSet(explicitInner(field));
        break;
      case TAG_ALGORITHM:
        facts.algorithm = toSmallInteger(explicitInner(field));
        break;
      case TAG_DIGEST:
        facts.digests = integerSet(explicitInner(field));
        break;
      case TAG_EC_CURVE:
        facts.curve = toSmallInteger(explicitInner(field));
        break;
      case TAG_ORIGIN:
        facts.origin = toSmallInteger(explicitInner(field));
        break;
      case TAG_ROOT_OF_TRUST: {
        const root = explicitInner(field);
        const parts = children(root);
        const locked = parts[1];
        const state = parts[2];
        if (!isUniversal(root, TAG_SEQUENCE) || locked === undefined || state === undefined) {
          throw new DerError('bad root of trust');
        }
        facts.rootOfTrust = { deviceLocked: toBoolean(locked), verifiedBootState: toSmallInteger(state) };
        break;
      }
      case TAG_ATTESTATION_APPLICATION_ID:
        facts.application = parseApplicationId(toOctets(explicitInner(field)));
        break;
      default:
        break;
    }
  }
  return facts;
}

/** Parses the KeyDescription of the attestation extension. Throws DerError on anything malformed. */
export function parseKeyDescription(extensionValue: Buffer): KeyDescription {
  const root = parseOne(extensionValue);
  if (!isUniversal(root, TAG_SEQUENCE)) {
    throw new DerError('bad key description');
  }
  const parts = children(root);
  const [version, attestationLevel, , keymasterLevel, challenge, uniqueId, software, tee] = parts;
  if (
    parts.length !== 8 ||
    version === undefined ||
    attestationLevel === undefined ||
    keymasterLevel === undefined ||
    challenge === undefined ||
    uniqueId === undefined ||
    software === undefined ||
    tee === undefined ||
    !isUniversal(version, TAG_INTEGER) ||
    !isUniversal(challenge, TAG_OCTET_STRING)
  ) {
    throw new DerError('bad key description');
  }
  return {
    attestationSecurityLevel: toSmallInteger(attestationLevel),
    keymasterSecurityLevel: toSmallInteger(keymasterLevel),
    challenge: toOctets(challenge),
    software: parseAuthorizationList(software),
    tee: parseAuthorizationList(tee),
  };
}

function normalizedSerial(certificate: X509Certificate): string {
  return certificate.serialNumber.toLowerCase().replace(/^0+(?=.)/, '');
}

function parseChain(chain: readonly Buffer[]): X509Certificate[] {
  const total = chain.reduce((sum, certificate) => sum + certificate.length, 0);
  if (chain.length === 0 || chain.length > MAX_CHAIN_LENGTH || total > MAX_CHAIN_BYTES) {
    return invalid();
  }
  try {
    return chain.map((der) => new X509Certificate(der));
  } catch {
    return invalid();
  }
}

/**
 * The chain must lead, certificate by certificate, to one of the PINNED roots: each certificate issued and signed by the next
 * one, every issuer a CA, every certificate valid now, and the last one either a pinned root itself (same fingerprint) or signed
 * by one. Returns the certificates that carry a revocation status (everything except the pinned root).
 */
export function verifyChainToPinnedRoot(chain: X509Certificate[], roots: readonly X509Certificate[], nowMs: number): X509Certificate[] {
  const now = nowMs;
  for (const certificate of chain) {
    if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) < now) {
      return invalid();
    }
  }
  for (let index = 0; index < chain.length - 1; index++) {
    const subject = chain[index];
    const issuer = chain[index + 1];
    if (subject === undefined || issuer === undefined || !issuer.ca || !subject.checkIssued(issuer) || !subject.verify(issuer.publicKey)) {
      return invalid();
    }
  }
  const top = chain[chain.length - 1];
  if (top === undefined) {
    return invalid();
  }
  const sameAsRoot = roots.find((root) => root.fingerprint256 === top.fingerprint256);
  if (sameAsRoot !== undefined) {
    return chain.slice(0, -1);
  }
  const issuingRoot = roots.find((root) => root.ca && top.checkIssued(root) && top.verify(root.publicKey) && Date.parse(root.validFrom) <= now && Date.parse(root.validTo) >= now);
  if (issuingRoot === undefined) {
    return invalid();
  }
  return chain;
}

function isRevoked(certificates: readonly X509Certificate[], snapshot: RevocationSnapshot): boolean {
  return certificates.some((certificate) => snapshot.revokedSerials.has(normalizedSerial(certificate)));
}

export async function currentSnapshot(trust: ClientDeviceTrust): Promise<RevocationSnapshot> {
  let snapshot: RevocationSnapshot;
  try {
    snapshot = await trust.revocation();
  } catch {
    throw new TechnicalError('unavailable', 'The attestation revocation snapshot is not available');
  }
  const age = trust.nowMs() - snapshot.fetchedAtMs;
  if (age > SNAPSHOT_MAX_AGE_MS || age < -5 * 60 * 1000) {
    throw new TechnicalError('unavailable', 'The attestation revocation snapshot is stale');
  }
  return snapshot;
}

/**
 * Full verification of one attested key (ENROLL / JOIN with a fresh challenge; AUTH without one).
 *  chain -> pinned root -> revocation -> extension (TEE or StrongBox, locked verified boot, P-256 SIGN-only key, app + signer) ->
 *  the certified public key is the one the client claims. The revocation snapshot is read BEFORE and outside any database lock
 *  (the caller does the whole verification before its transaction).
 */
export async function verifyAttestation(trust: ClientDeviceTrust, request: AttestationRequest): Promise<VerifiedAttestation> {
  const snapshot = await currentSnapshot(trust);
  const certificates = parseChain(request.chain);
  const checked = verifyChainToPinnedRoot(certificates, trust.roots, trust.nowMs());
  if (isRevoked(checked, snapshot)) {
    return invalid();
  }
  const leaf = certificates[0];
  const leafDer = request.chain[0];
  if (leaf === undefined || leafDer === undefined) {
    return invalid();
  }

  let description: KeyDescription;
  try {
    const extension = findCertificateExtension(leafDer, ATTESTATION_EXTENSION_OID);
    if (extension === undefined) {
      return invalid();
    }
    description = parseKeyDescription(extension);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    return invalid();
  }

  const spki = Buffer.from(leaf.publicKey.export({ type: 'spki', format: 'der' }));
  if (!equalBuffers(spki, request.expectedSpki) || leaf.publicKey.asymmetricKeyType !== 'ec' || leaf.publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    return invalid();
  }
  if (request.expectedChallenge !== undefined && !equalBuffers(description.challenge, request.expectedChallenge)) {
    return invalid();
  }

  // The security level must be hardware: Software (0) is never accepted, and the attestation and the key store agree.
  const level = description.attestationSecurityLevel;
  if (description.keymasterSecurityLevel !== level) {
    return invalid();
  }
  if (level !== SECURITY_LEVEL_TEE && level !== SECURITY_LEVEL_STRONGBOX) {
    return unsupported();
  }

  // Key properties are enforced by the TEE, not the software list.
  const tee = description.tee;
  const boot = tee.rootOfTrust;
  if (boot === undefined || !boot.deviceLocked || boot.verifiedBootState !== BOOT_VERIFIED) {
    return unsupported();
  }
  if (
    tee.algorithm !== ALGORITHM_EC ||
    (tee.curve !== undefined && tee.curve !== EC_CURVE_P256) ||
    tee.purposes === undefined ||
    tee.purposes.length !== 1 ||
    tee.purposes[0] !== PURPOSE_SIGN ||
    (tee.digests !== undefined && !tee.digests.includes(DIGEST_SHA256)) ||
    (tee.origin !== undefined && tee.origin !== ORIGIN_GENERATED)
  ) {
    return invalid();
  }

  // The package and the signer: from the TEE list when present, else from the one the Keystore service fills in.
  const application = tee.application ?? description.software.application;
  const allowed = trust.signers[request.app];
  const signer = Buffer.from(allowed.signerSha256, 'hex');
  const only = application?.signatureDigests[0];
  if (
    application === undefined ||
    application.packageNames.length !== 1 ||
    application.packageNames[0] !== allowed.packageName ||
    application.signatureDigests.length !== 1 ||
    only === undefined ||
    !equalBuffers(only, signer)
  ) {
    return invalid();
  }

  return { level: level === SECURITY_LEVEL_STRONGBOX ? 'STRONGBOX' : 'TEE', packageName: allowed.packageName, signerSha256: signer, publicKeySpki: spki };
}

export function sha256(data: Buffer | string): Buffer {
  return createHash('sha256').update(data).digest();
}
