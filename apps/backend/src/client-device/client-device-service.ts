import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { exactObject } from '../auth/auth-validation';
import { AppError, DeviceRateLimitedError, TechnicalError } from '../common/app-errors';
import { parseIdempotencyKey } from '../idempotency/idempotency-key';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionManager } from '../transaction/transaction-manager';
import { verifyAttestation, VerifiedAttestation } from './android-attestation';
import {
  CHALLENGE_TTL_SECONDS,
  AUTH_CHALLENGES_PER_MINUTE,
  KEYLESS_CHALLENGES_PER_MINUTE,
  digestBytes,
  REGISTRATION_GRANT_TTL_SECONDS,
} from './client-device-constants';
import { ChallengeRow, ClientDeviceRepository, DeviceApp, DevicePurpose, KeyRow } from './client-device-repository';
import { CLIENT_DEVICE_TRUST, ClientDeviceTrust } from './client-device-trust';
import {
  fromBase64,
  fromBase64Url,
  JOIN_KEY_PREFIX,
  publicKeyFromSpki,
  registerKeyMessage,
  sha256Hex,
  toBase64Url,
  verifySignature,
} from './device-messages';
import { sameBytes } from './client-device-proof-service';

const MAX_BODY_CHAIN_ENTRIES = 8;
const MAX_CHAIN_BYTES = 48 * 1024;
const MAX_SPKI_BYTES = 256;
const MAX_SIGNATURE_BYTES = 80;

export interface ChallengeInput {
  readonly app: DeviceApp;
  readonly purpose: DevicePurpose;
  readonly keyId: string | null;
}

export interface JoinInput {
  readonly bindingId: string;
  readonly authorizerKeyId: string;
  readonly signature: Buffer;
}

export interface RegistrationInput {
  readonly challengeId: string;
  readonly app: DeviceApp;
  readonly chain: Buffer[];
  readonly publicKeySpki: Buffer;
  readonly signature: Buffer;
  readonly join: JoinInput | null;
}

function reject(): never {
  throw new BadRequestException();
}

function parseApp(value: unknown): DeviceApp {
  return value === 'FOOD' || value === 'SHIP' ? value : reject();
}

/** POST /v1/client-auth/device/challenges: exact {app, purpose, key_id}. */
export function parseChallengeBody(body: unknown): ChallengeInput {
  const parsed = exactObject(body, ['app', 'purpose', 'key_id']);
  const purpose = parsed['purpose'];
  if (purpose !== 'ENROLL' && purpose !== 'JOIN' && purpose !== 'AUTH') {
    return reject();
  }
  const keyId = parsed['key_id'];
  if (keyId !== null && !isCanonicalUuid(keyId)) {
    return reject();
  }
  // AUTH names the registered key; ENROLL and JOIN have no key yet (a fresh one is generated), so none may be named.
  if ((purpose === 'AUTH') !== (keyId !== null)) {
    return reject();
  }
  return { app: parseApp(parsed['app']), purpose, keyId };
}

/** POST /v1/client-auth/device/registrations: exact {challenge_id, app, certificate_chain, public_key_spki, signature, join}. */
export function parseRegistrationBody(body: unknown): RegistrationInput {
  const parsed = exactObject(body, ['challenge_id', 'app', 'certificate_chain', 'public_key_spki', 'signature', 'join']);
  const challengeId = parsed['challenge_id'];
  const chainRaw = parsed['certificate_chain'];
  if (!isCanonicalUuid(challengeId) || !Array.isArray(chainRaw) || chainRaw.length < 1 || chainRaw.length > MAX_BODY_CHAIN_ENTRIES) {
    return reject();
  }
  let total = 0;
  const chain = chainRaw.map((entry: unknown) => {
    const der = fromBase64(entry, MAX_CHAIN_BYTES);
    if (der === undefined) {
      return reject();
    }
    total += der.length;
    return der;
  });
  const spki = fromBase64(parsed['public_key_spki'], MAX_SPKI_BYTES);
  const signature = fromBase64Url(parsed['signature'], MAX_SIGNATURE_BYTES);
  if (total > MAX_CHAIN_BYTES || spki === undefined || signature === undefined) {
    return reject();
  }
  const joinRaw = parsed['join'];
  let join: JoinInput | null = null;
  if (joinRaw !== null) {
    const joinParsed = exactObject(joinRaw, ['binding_id', 'authorizer_key_id', 'signature']);
    const bindingId = joinParsed['binding_id'];
    const authorizerKeyId = joinParsed['authorizer_key_id'];
    const joinSignature = fromBase64Url(joinParsed['signature'], MAX_SIGNATURE_BYTES);
    if (!isCanonicalUuid(bindingId) || !isCanonicalUuid(authorizerKeyId) || joinSignature === undefined) {
      return reject();
    }
    join = { bindingId, authorizerKeyId, signature: joinSignature };
  }
  return { challengeId, app: parseApp(parsed['app']), chain, publicKeySpki: spki, signature, join };
}

/**
 * The public device endpoints (contract11 section 7): challenges and registrations. No user is named, looked up or disclosed;
 * every refusal is a fixed generic code. The expensive part (certificate chain, revocation snapshot, signatures) runs BEFORE the
 * transaction, so no network or hashing work happens under a database lock; the transaction only rechecks what can change
 * (challenge not consumed or expired, binding still current) and writes.
 */
@Injectable()
export class ClientDeviceService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly devices: ClientDeviceRepository,
    @Optional() @Inject(CLIENT_DEVICE_TRUST) private readonly trust: ClientDeviceTrust | undefined,
  ) {}

  async createChallenge(input: ChallengeInput): Promise<{ challengeId: string; nonce: string; expiresAt: string }> {
    this.#requireTrust();
    const challengeId = randomUUID();
    const nonce = randomBytes(32);
    const written = await this.transactions.withTransaction(async (context) => {
      const recent = await this.devices.countRecentChallenges(context, input);
      if (recent >= (input.purpose === 'AUTH' ? AUTH_CHALLENGES_PER_MINUTE : KEYLESS_CHALLENGES_PER_MINUTE)) {
        return undefined;
      }
      return this.devices.insertChallenge(context, { challengeId, nonce, ...input, ttlSeconds: CHALLENGE_TTL_SECONDS });
    });
    if (written === undefined) {
      throw new DeviceRateLimitedError(60);
    }
    return { challengeId, nonce: toBase64Url(nonce), expiresAt: written.expiresAt };
  }

  async register(
    input: RegistrationInput,
    idempotencyKey: string | readonly string[] | undefined,
  ): Promise<{ token: string; keyId: string; expiresAt: string }> {
    const trust = this.#requireTrust();
    parseIdempotencyKey(idempotencyKey);

    // 1. Everything that does not need a lock. A challenge that is unknown, used, expired or for another app is refused first.
    const challenge = await this.transactions.withTransaction((context) => this.devices.readChallenge(context, input.challengeId));
    this.#assertChallengeUsable(challenge, input.app);
    const usable = challenge as ChallengeRow;
    const nonceText = toBase64Url(usable.nonce);

    const existing = await this.transactions.withTransaction((context) => this.devices.findKeyBySpki(context, input.publicKeySpki));
    let verified: VerifiedAttestation | undefined;
    let keyRow: KeyRow | undefined;
    if (usable.purpose === 'AUTH') {
      // A registered key proves itself again: same key, the chain stored at enrolment, a FRESH signature. The chain is
      // re-validated against the current roots / revocation snapshot (provenance), not against the fresh challenge.
      const stored = existing;
      if (
        stored === undefined ||
        stored.revoked ||
        stored.app !== input.app ||
        stored.keyId !== usable.keyId ||
        stored.attestationChain.length !== input.chain.length ||
        !stored.attestationChain.every((certificate, index) => sameBytes(certificate, input.chain[index] ?? Buffer.alloc(0)))
      ) {
        throw new AppError('DEVICE_PROOF_INVALID');
      }
      await verifyAttestation(trust, { chain: input.chain, app: input.app, expectedChallenge: undefined, expectedSpki: input.publicKeySpki });
      keyRow = stored;
    } else {
      // ENROLL / JOIN: a NEW attested key bound to this challenge's nonce. A key the server already knows can only AUTH.
      if (existing !== undefined) {
        throw new AppError('DEVICE_PROOF_INVALID');
      }
      verified = await verifyAttestation(trust, {
        chain: input.chain,
        app: input.app,
        expectedChallenge: usable.nonce,
        expectedSpki: input.publicKeySpki,
      });
    }

    const publicKey = publicKeyFromSpki(input.publicKeySpki);
    const message = registerKeyMessage({
      environment: trust.environment,
      challengeId: input.challengeId,
      nonce: nonceText,
      app: input.app,
      spkiSha256Hex: sha256Hex(input.publicKeySpki),
      bindingId: input.join?.bindingId ?? null,
      authorizerKeyId: input.join?.authorizerKeyId ?? null,
    });
    if (publicKey === undefined || !verifySignature(publicKey, message, input.signature)) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }
    if ((usable.purpose === 'JOIN') !== (input.join !== null)) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }
    if (input.join !== null) {
      await this.#verifyAuthorizer(trust, input, message);
    }

    // 2. The short transaction: lock the challenge, recheck, write the key (ENROLL / JOIN) and the one-use grant.
    const token = randomBytes(32);
    const written = await this.transactions.withTransaction(async (context) => {
      const locked = await this.devices.lockChallenge(context, input.challengeId);
      if (locked === undefined || locked.consumed) {
        throw new AppError('DEVICE_PROOF_INVALID');
      }
      if (locked.expired) {
        throw new AppError('DEVICE_PROOF_EXPIRED');
      }
      let keyId: string;
      if (usable.purpose === 'AUTH') {
        const current = keyRow === undefined ? undefined : await this.devices.findKeyById(context, keyRow.keyId);
        if (current === undefined || current.revoked) {
          throw new AppError('DEVICE_PROOF_INVALID');
        }
        keyId = current.keyId;
      } else {
        if (verified === undefined) {
          throw new TechnicalError('internal', 'Missing attestation result');
        }
        keyId = randomUUID();
        const inserted = await this.devices.insertKey(context, {
          keyId,
          publicKeySpki: input.publicKeySpki,
          app: input.app,
          signerSha256: verified.signerSha256,
          packageName: verified.packageName,
          attestationLevel: verified.level,
          attestationChain: input.chain,
        });
        if (!inserted) {
          throw new AppError('DEVICE_PROOF_INVALID');
        }
      }
      if (input.join !== null) {
        const binding = await this.devices.bindingById(context, input.join.bindingId);
        const links = binding === undefined || !binding.active ? [] : await this.devices.currentLinks(context, binding.bindingId);
        if (!links.some((link) => link.keyId === input.join?.authorizerKeyId && link.app !== input.app)) {
          throw new AppError('DEVICE_PROOF_INVALID');
        }
      }
      await this.devices.consumeChallenge(context, input.challengeId);
      const grant = await this.devices.insertGrant(context, {
        grantId: randomUUID(),
        tokenDigest: digestBytes(token),
        keyId,
        joinBindingId: input.join?.bindingId ?? null,
        authorizerKeyId: input.join?.authorizerKeyId ?? null,
        ttlSeconds: REGISTRATION_GRANT_TTL_SECONDS,
      });
      return { keyId, expiresAt: grant.expiresAt };
    });
    return { token: toBase64Url(token), keyId: written.keyId, expiresAt: written.expiresAt };
  }

  /** The authorizer (the OTHER app of the binding) must have signed THIS key for THIS challenge with the JOIN prefix. */
  async #verifyAuthorizer(trust: ClientDeviceTrust, input: RegistrationInput, registerMessage: Buffer): Promise<void> {
    const join = input.join;
    if (join === null) {
      return;
    }
    const authorizer = await this.transactions.withTransaction((context) => this.devices.findKeyById(context, join.authorizerKeyId));
    if (authorizer === undefined || authorizer.revoked || authorizer.app === input.app) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }
    const authorizerKey = publicKeyFromSpki(authorizer.publicKeySpki);
    // Same lines as the registration message, JOIN prefix (contract11 section 7).
    const lines = registerMessage.toString('utf8').split('\n');
    lines[0] = JOIN_KEY_PREFIX;
    const joinMessage = Buffer.from(lines.join('\n'), 'utf8');
    if (authorizerKey === undefined || !verifySignature(authorizerKey, joinMessage, join.signature)) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }
    void trust;
  }

  #assertChallengeUsable(challenge: ChallengeRow | undefined, app: DeviceApp): void {
    if (challenge === undefined || challenge.consumed || challenge.app !== app) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }
    if (challenge.expired) {
      throw new AppError('DEVICE_PROOF_EXPIRED');
    }
  }

  #requireTrust(): ClientDeviceTrust {
    if (this.trust === undefined) {
      throw new TechnicalError('unavailable', 'The Android device proof verifier is not available');
    }
    return this.trust;
  }
}
