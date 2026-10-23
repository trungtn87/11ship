import { Inject, Injectable, Optional } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AppError, TechnicalError } from '../common/app-errors';
import { ClientApp } from '../client-auth/client-auth-constants';
import { parseIdempotencyKey } from '../idempotency/idempotency-key';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionManager } from '../transaction/transaction-manager';
import { digestBytes, isNativeSession } from './client-device-constants';
import { CLIENT_DEVICE_TRUST, ClientDeviceTrust } from './client-device-trust';
import { ClientDeviceRepository, GrantRow, KeyRow, SessionBindingRow } from './client-device-repository';
import {
  authMessage,
  fromBase64Url,
  publicKeyFromSpki,
  requestMessage,
  sha256Hex,
  verifySignature,
} from './device-messages';

/** What the HTTP adapter hands over: the bytes and the target exactly as they arrived. */
export interface NativeRequestEvidence {
  readonly method: string;
  readonly url: string;
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** A verified registration grant presented to login / register (not consumed yet: the business transaction consumes it). */
export interface NativeAuthProof {
  readonly tokenDigest: Buffer;
  readonly keyId: string;
}

const TIME_WINDOW_SECONDS = 60;
const SIGNATURE_MAX_BYTES = 80;
const UNIX_SECONDS = /^[0-9]{1,12}$/;

function header(headers: NativeRequestEvidence['headers'], name: string): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Verification of the per-request device proof (contract11 section 8) and of the registration-token proof of login / register.
 *
 * The signature is checked first (it needs the stored public key only), then the time window against the DATABASE clock, and
 * only then the nonce is inserted, in a transaction of its own: a replayed (key, nonce) is refused, the nonce survives the
 * rollback of any later business transaction, and garbage that fails the signature cannot fill the table.
 * Every failure of a proof is the one answer DEVICE_PROOF_INVALID; a request without the headers is DEVICE_PROOF_REQUIRED.
 */
@Injectable()
export class ClientDeviceProofService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly devices: ClientDeviceRepository,
    @Optional() @Inject(CLIENT_DEVICE_TRUST) private readonly trust: ClientDeviceTrust | undefined,
  ) {}

  /**
   * Proof of a Bearer request of a NATIVE session. `allowDetached` is for logout only: the proof must still come from the key
   * the session was issued to, even when its binding was replaced meanwhile (so a stale token can still be logged out).
   */
  async verifyBearerRequest(
    evidence: NativeRequestEvidence,
    token: string,
    session: { sessionId: string; platform: string | undefined; app: string | undefined },
    options: { allowDetached?: boolean } = {},
  ): Promise<void> {
    if (!isNativeSession(session.platform, session.app)) {
      return;
    }
    const keyIdHeader = header(evidence.headers, 'x-device-key-id');
    const timeHeader = header(evidence.headers, 'x-device-time');
    const nonceHeader = header(evidence.headers, 'x-device-nonce');
    const signatureHeader = header(evidence.headers, 'x-device-signature');
    if (keyIdHeader === undefined && timeHeader === undefined && nonceHeader === undefined && signatureHeader === undefined) {
      throw new AppError('DEVICE_PROOF_REQUIRED');
    }
    const trust = this.#requireTrust();
    const nonce = fromBase64Url(nonceHeader, 32);
    const signature = fromBase64Url(signatureHeader, SIGNATURE_MAX_BYTES);
    if (
      !isCanonicalUuid(keyIdHeader) ||
      timeHeader === undefined ||
      !UNIX_SECONDS.test(timeHeader) ||
      nonce === undefined ||
      nonce.length !== 32 ||
      signature === undefined
    ) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }

    const { binding, key } = await this.transactions.withTransaction(async (context) => {
      const found = await this.devices.sessionBinding(context, session.sessionId);
      const bound = found === undefined ? undefined : await this.devices.findKeyById(context, found.keyId);
      return { binding: found, key: bound };
    });
    if (binding === undefined || key === undefined || binding.keyId !== keyIdHeader) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }
    if (!binding.usable && options.allowDetached !== true) {
      throw new AppError('SESSION_REVOKED');
    }
    if (key.revoked && options.allowDetached !== true) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }

    const publicKey = publicKeyFromSpki(key.publicKeySpki);
    const idempotencyKey = header(evidence.headers, 'idempotency-key') ?? '';
    const message = requestMessage({
      environment: trust.environment,
      keyId: keyIdHeader,
      time: timeHeader,
      nonce: nonceHeader ?? '',
      method: evidence.method.toUpperCase(),
      url: evidence.url,
      bodySha256Hex: sha256Hex(evidence.rawBody),
      bearerSha256Hex: sha256Hex(token),
      idempotencyKey,
    });
    if (publicKey === undefined || !verifySignature(publicKey, message, signature)) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }
    await this.#freshAndUnique(key.keyId, Number(timeHeader), nonce);
  }

  /**
   * Proof of a login / register request: the registration token from POST /device/registrations, the key behind it, and the
   * AUTH message over environment, method, path, body, Idempotency-Key and token (plus this request's time and nonce).
   * The grant is NOT consumed here: a replay of a committed request presents the same, already consumed, token; only the first
   * execution consumes it, inside its own business transaction.
   */
  async verifyAuthRequest(
    evidence: NativeRequestEvidence,
    app: ClientApp,
    idempotencyKeyHeader: string | readonly string[] | undefined,
  ): Promise<NativeAuthProof> {
    const trust = this.#requireTrust();
    const registration = header(evidence.headers, 'x-device-registration');
    const timeHeader = header(evidence.headers, 'x-device-time');
    const nonceHeader = header(evidence.headers, 'x-device-nonce');
    const signatureHeader = header(evidence.headers, 'x-device-signature');
    if (registration === undefined && signatureHeader === undefined) {
      throw new AppError('DEVICE_PROOF_REQUIRED');
    }
    const token = fromBase64Url(registration, 32);
    const nonce = fromBase64Url(nonceHeader, 32);
    const signature = fromBase64Url(signatureHeader, SIGNATURE_MAX_BYTES);
    // Validate the shape (canonical UUID) but sign over the bytes exactly as sent.
    parseIdempotencyKey(idempotencyKeyHeader);
    const idempotencyKey = typeof idempotencyKeyHeader === 'string' ? idempotencyKeyHeader : '';
    if (
      token === undefined ||
      token.length !== 32 ||
      timeHeader === undefined ||
      !UNIX_SECONDS.test(timeHeader) ||
      nonce === undefined ||
      nonce.length !== 32 ||
      signature === undefined
    ) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }

    const tokenDigest = digestBytes(token);
    const { grant, key } = await this.transactions.withTransaction(async (context) => {
      const found: GrantRow | undefined = await this.devices.findGrantByDigest(context, tokenDigest, false);
      const bound: KeyRow | undefined = found === undefined ? undefined : await this.devices.findKeyById(context, found.keyId);
      return { grant: found, key: bound };
    });
    if (grant === undefined || key === undefined || key.revoked || key.app !== app) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }
    const publicKey = publicKeyFromSpki(key.publicKeySpki);
    const message = authMessage({
      environment: trust.environment,
      method: evidence.method.toUpperCase(),
      path: evidence.url,
      bodySha256Hex: sha256Hex(evidence.rawBody),
      idempotencyKeySha256Hex: sha256Hex(idempotencyKey),
      registrationTokenSha256Hex: sha256Hex(registration ?? ''),
      time: timeHeader,
      nonce: nonceHeader ?? '',
    });
    if (publicKey === undefined || !verifySignature(publicKey, message, signature)) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }
    await this.#freshAndUnique(key.keyId, Number(timeHeader), nonce);
    return { tokenDigest, keyId: key.keyId };
  }

  /** Window of +-60 s on the database clock, then the nonce barrier, both outside any business transaction. */
  async #freshAndUnique(keyId: string, time: number, nonce: Buffer): Promise<void> {
    const accepted = await this.transactions.withTransaction(async (context) => {
      const now = await this.devices.nowSeconds(context);
      if (!Number.isSafeInteger(time) || Math.abs(now - time) > TIME_WINDOW_SECONDS) {
        return false;
      }
      return this.devices.insertRequestNonce(context, keyId, digestBytes(nonce));
    });
    if (!accepted) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }
  }

  #requireTrust(): ClientDeviceTrust {
    if (this.trust === undefined) {
      throw new TechnicalError('unavailable', 'The Android device proof verifier is not available');
    }
    return this.trust;
  }
}

export function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export type { SessionBindingRow };
