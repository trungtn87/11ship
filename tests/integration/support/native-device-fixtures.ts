import { createHash, generateKeyPairSync, KeyObject, randomBytes, randomUUID, sign as cryptoSign, X509Certificate } from 'node:crypto';
import { ClientApp } from '../../../apps/backend/src/client-auth/client-auth-constants';
import { ClientDeviceTrust } from '../../../apps/backend/src/client-device/client-device-trust';
import { authMessage, registerKeyMessage, requestMessage, sha256Hex, JOIN_KEY_PREFIX } from '../../../apps/backend/src/client-device/device-messages';
import { RevocationSnapshot } from '../../../apps/backend/src/config/client-device-config';
import { ApiResponse, AuthApp } from './auth-fixtures';

// FIXTURE attestation for the native device tests. The roots and chains below are generated here, by this file, and are injected
// into the application through the test dependency injection (AuthModuleOptions.deviceTrust). They are NOT Google's attestation
// roots and they prove NOTHING about a real phone: the real hardware proof is the Owner's phone test.

// ---- a tiny DER writer (the tests only) -----------------------------------------------------------------------------------------

function len(n: number): Buffer {
  if (n < 0x80) {
    return Buffer.from([n]);
  }
  const bytes: number[] = [];
  let value = n;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number | Buffer, content: Buffer): Buffer {
  const head = typeof tag === 'number' ? Buffer.from([tag]) : tag;
  return Buffer.concat([head, len(content.length), content]);
}

const seq = (...parts: Buffer[]): Buffer => tlv(0x30, Buffer.concat(parts));
const set = (...parts: Buffer[]): Buffer => tlv(0x31, Buffer.concat(parts));
const octets = (data: Buffer): Buffer => tlv(0x04, data);
const bool = (value: boolean): Buffer => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
const enumerated = (value: number): Buffer => tlv(0x0a, Buffer.from([value]));
function integer(value: number | Buffer): Buffer {
  if (Buffer.isBuffer(value)) {
    const padded = (value[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value;
    return tlv(0x02, padded);
  }
  if (value === 0) {
    return tlv(0x02, Buffer.from([0]));
  }
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  if ((bytes[0] ?? 0) & 0x80) {
    bytes.unshift(0);
  }
  return tlv(0x02, Buffer.from(bytes));
}
function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const out: number[] = [(parts[0] ?? 0) * 40 + (parts[1] ?? 0)];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f];
    let rest = Math.floor(part / 128);
    while (rest > 0) {
      chunk.unshift((rest & 0x7f) | 0x80);
      rest = Math.floor(rest / 128);
    }
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
function explicit(tagNumber: number, inner: Buffer): Buffer {
  if (tagNumber < 31) {
    return tlv(0xa0 | tagNumber, inner);
  }
  const digits: number[] = [];
  let rest = tagNumber;
  digits.unshift(rest & 0x7f);
  rest = Math.floor(rest / 128);
  while (rest > 0) {
    digits.unshift((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  return tlv(Buffer.from([0xbf, ...digits]), inner);
}
const utf8 = (text: string): Buffer => tlv(0x0c, Buffer.from(text, 'utf8'));
function utcTime(date: Date): Buffer {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(2, 14);
  return tlv(0x17, Buffer.from(`${iso}Z`, 'ascii'));
}
const name = (common: string): Buffer => seq(set(seq(oid('2.5.4.3'), utf8(common))));
const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));

// ---- certificates ---------------------------------------------------------------------------------------------------------------

export interface FixtureCa {
  readonly commonName: string;
  readonly privateKey: KeyObject;
  readonly certificate: X509Certificate;
}

function extension(id: string, critical: boolean, value: Buffer): Buffer {
  return seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
}

function certificate(args: {
  serial: Buffer;
  issuer: string;
  subject: string;
  subjectSpki: Buffer;
  issuerKey: KeyObject;
  extensions: Buffer[];
  notBefore: Date;
  notAfter: Date;
}): X509Certificate {
  const tbs = seq(
    explicit(0, integer(2)),
    integer(args.serial),
    ECDSA_SHA256,
    name(args.issuer),
    seq(utcTime(args.notBefore), utcTime(args.notAfter)),
    name(args.subject),
    args.subjectSpki,
    explicit(3, seq(...args.extensions)),
  );
  const signature = cryptoSign('sha256', tbs, { key: args.issuerKey, dsaEncoding: 'der' });
  const bitString = tlv(0x03, Buffer.concat([Buffer.from([0]), signature]));
  return new X509Certificate(seq(tbs, ECDSA_SHA256, bitString));
}

const caExtensions = (): Buffer[] => [extension('2.5.29.19', true, seq(bool(true)))];

export function createCa(common: string, issuer?: FixtureCa, serial: Buffer = randomBytes(8), validity?: { notBefore: Date; notAfter: Date }): FixtureCa {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const now = Date.now();
  const cert = certificate({
    serial,
    issuer: issuer?.commonName ?? common,
    subject: common,
    subjectSpki: Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' })),
    issuerKey: issuer?.privateKey ?? pair.privateKey,
    extensions: caExtensions(),
    notBefore: validity?.notBefore ?? new Date(now - 24 * 3600_000),
    notAfter: validity?.notAfter ?? new Date(now + 365 * 24 * 3600_000),
  });
  return { commonName: common, privateKey: pair.privateKey, certificate: cert };
}

export interface AttestationOptions {
  readonly app: ClientApp;
  readonly challenge: Buffer;
  readonly packageName?: string;
  readonly signerSha256?: Buffer;
  readonly securityLevel?: number;
  readonly keymasterLevel?: number;
  readonly deviceLocked?: boolean;
  readonly bootState?: number;
  readonly purposes?: number[];
  readonly omitExtension?: boolean;
  readonly serial?: Buffer;
  readonly extraPackage?: boolean;
}

export const FIXTURE_PACKAGES = { FOOD: 'vn.eleven.food.test', SHIP: 'vn.eleven.ship.test' } as const;
export const FIXTURE_SIGNER = createHash('sha256').update('fixture-persistent-signer-certificate').digest();

function keyDescription(options: AttestationOptions): Buffer {
  const level = options.securityLevel ?? 1;
  const packageInfos = [seq(octets(Buffer.from(options.packageName ?? FIXTURE_PACKAGES[options.app], 'utf8')), integer(1))];
  if (options.extraPackage === true) {
    packageInfos.push(seq(octets(Buffer.from('com.example.other', 'utf8')), integer(1)));
  }
  const applicationId = seq(set(...packageInfos), set(octets(options.signerSha256 ?? FIXTURE_SIGNER)));
  const software = seq(explicit(709, octets(applicationId)));
  const tee = seq(
    explicit(1, set(...(options.purposes ?? [2]).map((purpose) => integer(purpose)))),
    explicit(2, integer(3)),
    explicit(5, set(integer(4))),
    explicit(10, integer(1)),
    explicit(702, integer(0)),
    explicit(704, seq(octets(randomBytes(32)), bool(options.deviceLocked ?? true), enumerated(options.bootState ?? 0), octets(randomBytes(32)))),
  );
  return seq(integer(4), enumerated(level), integer(4), enumerated(options.keymasterLevel ?? level), octets(options.challenge), octets(Buffer.alloc(0)), software, tee);
}

export interface FixtureKey {
  readonly privateKey: KeyObject;
  readonly spki: Buffer;
  /** DER certificates, leaf first, up to and including the root. */
  readonly chain: Buffer[];
  readonly leafSerial: string;
}

/** An attested key as a phone would hand it over: a leaf certified by the fixture intermediate, chained to the fixture root. */
export function attestKey(ca: FixtureChainAuthority, options: AttestationOptions, existing?: { privateKey: KeyObject; spki: Buffer }): FixtureKey {
  const pair = existing === undefined ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' }) : undefined;
  const privateKey = existing?.privateKey ?? (pair as { privateKey: KeyObject }).privateKey;
  const spki = existing?.spki ?? Buffer.from((pair as { publicKey: KeyObject }).publicKey.export({ type: 'spki', format: 'der' }));
  const serial = options.serial ?? randomBytes(10);
  const now = Date.now();
  const leaf = certificate({
    serial,
    issuer: ca.intermediate.commonName,
    subject: 'Android Keystore Key',
    subjectSpki: spki,
    issuerKey: ca.intermediate.privateKey,
    extensions: options.omitExtension === true ? [] : [extension('1.3.6.1.4.1.11129.2.1.17', false, keyDescription(options))],
    notBefore: new Date(now - 3600_000),
    notAfter: new Date(now + 24 * 3600_000),
  });
  return {
    privateKey,
    spki,
    chain: [leaf.raw, ca.intermediate.certificate.raw, ca.root.certificate.raw],
    leafSerial: leaf.serialNumber.toLowerCase().replace(/^0+(?=.)/, ''),
  };
}

export interface FixtureChainAuthority {
  readonly root: FixtureCa;
  readonly intermediate: FixtureCa;
}

export function createAuthority(): FixtureChainAuthority {
  const root = createCa(`Fixture Attestation Root ${randomUUID()}`);
  return { root, intermediate: createCa(`Fixture Attestation Intermediate ${randomUUID()}`, root) };
}

// ---- trust ----------------------------------------------------------------------------------------------------------------------

export class FixtureTrust implements ClientDeviceTrust {
  readonly environment = 'fixture-env';
  readonly signers = {
    FOOD: { packageName: FIXTURE_PACKAGES.FOOD, signerSha256: FIXTURE_SIGNER.toString('hex') },
    SHIP: { packageName: FIXTURE_PACKAGES.SHIP, signerSha256: FIXTURE_SIGNER.toString('hex') },
  };
  roots: X509Certificate[];
  offsetMs = 0;
  revoked = new Set<string>();
  fetchedAtMs: number | undefined = Date.now();
  unavailable = false;

  constructor(readonly authority: FixtureChainAuthority = createAuthority()) {
    this.roots = [authority.root.certificate];
  }

  nowMs(): number {
    return Date.now() + this.offsetMs;
  }

  revocation(): Promise<RevocationSnapshot> {
    if (this.unavailable || this.fetchedAtMs === undefined) {
      return Promise.reject(new Error('unavailable'));
    }
    return Promise.resolve({ fetchedAtMs: this.fetchedAtMs, revokedSerials: new Set(this.revoked) });
  }
}

// ---- a simulated phone ----------------------------------------------------------------------------------------------------------

export interface AppKey {
  readonly app: ClientApp;
  keyId: string | undefined;
  key: FixtureKey;
}

function b64u(data: Buffer): string {
  return data.toString('base64url');
}
function sign(privateKey: KeyObject, message: Buffer): string {
  return b64u(cryptoSign('sha256', message, { key: privateKey, dsaEncoding: 'der' }));
}

export interface SignedResult {
  readonly response: ApiResponse;
  readonly sent: { headers: Record<string, string>; rawBody: string | undefined; path: string };
}

/** The Android side of the protocol, in the test: keys, challenge/registration calls and every signature. */
export class NativePhone {
  readonly keys: Partial<Record<ClientApp, AppKey>> = {};
  bindingId: string | undefined;

  constructor(
    private readonly app: AuthApp,
    private readonly trust: FixtureTrust,
  ) {}

  get environment(): string {
    return this.trust.environment;
  }

  /** A fresh attested key for an app (what Keystore does at first start, or after a clear). */
  newKey(app: ClientApp, challenge: Buffer = Buffer.alloc(32), options: Partial<AttestationOptions> = {}): AppKey {
    const key = attestKey(this.trust.authority, { app, challenge, ...options });
    const entry: AppKey = { app, keyId: undefined, key };
    this.keys[app] = entry;
    return entry;
  }

  async challenge(app: ClientApp, purpose: 'ENROLL' | 'JOIN' | 'AUTH', keyId: string | null = null): Promise<ApiResponse> {
    return this.app.call('POST', '/client-auth/device/challenges', { body: { app, purpose, key_id: keyId } });
  }

  /** ENROLL: the key is generated with the server challenge as attestation challenge, then registered. */
  async enroll(app: ClientApp, options: Partial<AttestationOptions> = {}): Promise<{ token: string; keyId: string; response: ApiResponse }> {
    const created = await this.challenge(app, 'ENROLL');
    const data = created.body.data as { challenge_id: string; nonce: string };
    const nonce = Buffer.from(data.nonce, 'base64url');
    const entry = this.newKey(app, nonce, options);
    const response = await this.register(entry, data.challenge_id, data.nonce, null);
    const result = response.body.data as { device_registration_token: string; key_id: string } | undefined;
    if (result === undefined) {
      return { token: '', keyId: '', response };
    }
    entry.keyId = result.key_id;
    return { token: result.device_registration_token, keyId: result.key_id, response };
  }

  /** AUTH: the registered key signs a fresh challenge, presenting the stored chain. */
  async reauth(app: ClientApp): Promise<{ token: string; response: ApiResponse }> {
    const entry = this.keys[app];
    if (entry === undefined || entry.keyId === undefined) {
      throw new Error('no registered key');
    }
    const created = await this.challenge(app, 'AUTH', entry.keyId);
    const data = created.body.data as { challenge_id: string; nonce: string };
    const response = await this.register(entry, data.challenge_id, data.nonce, null);
    const result = response.body.data as { device_registration_token: string } | undefined;
    return { token: result?.device_registration_token ?? '', response };
  }

  /** JOIN: the other app endorses (signs) the new key's challenge for the current binding. */
  async join(app: ClientApp, bindingId: string, authorizer: AppKey): Promise<{ token: string; keyId: string; response: ApiResponse }> {
    const created = await this.challenge(app, 'JOIN');
    const data = created.body.data as { challenge_id: string; nonce: string };
    const nonce = Buffer.from(data.nonce, 'base64url');
    const entry = this.newKey(app, nonce);
    const message = registerKeyMessage(
      {
        environment: this.environment,
        challengeId: data.challenge_id,
        nonce: data.nonce,
        app,
        spkiSha256Hex: sha256Hex(entry.key.spki),
        bindingId,
        authorizerKeyId: authorizer.keyId ?? '',
      },
      JOIN_KEY_PREFIX,
    );
    const response = await this.register(entry, data.challenge_id, data.nonce, {
      binding_id: bindingId,
      authorizer_key_id: authorizer.keyId ?? '',
      signature: sign(authorizer.key.privateKey, message),
    });
    const result = response.body.data as { device_registration_token: string; key_id: string } | undefined;
    if (result !== undefined) {
      entry.keyId = result.key_id;
    }
    return { token: result?.device_registration_token ?? '', keyId: result?.key_id ?? '', response };
  }

  async register(entry: AppKey, challengeId: string, nonceText: string, join: { binding_id: string; authorizer_key_id: string; signature: string } | null): Promise<ApiResponse> {
    const message = registerKeyMessage({
      environment: this.environment,
      challengeId,
      nonce: nonceText,
      app: entry.app,
      spkiSha256Hex: sha256Hex(entry.key.spki),
      bindingId: join?.binding_id ?? null,
      authorizerKeyId: join?.authorizer_key_id ?? null,
    });
    return this.app.call('POST', '/client-auth/device/registrations', {
      headers: { 'idempotency-key': randomUUID() },
      body: {
        challenge_id: challengeId,
        app: entry.app,
        certificate_chain: entry.key.chain.map((der) => der.toString('base64')),
        public_key_spki: entry.key.spki.toString('base64'),
        signature: sign(entry.key.privateKey, message),
        join,
      },
    });
  }

  /** login / register (public): signed with the registration token's key. */
  async authCall(
    app: ClientApp,
    path: '/client-auth/login' | '/client-auth/register',
    payload: Record<string, unknown>,
    registration: { token: string; keyId: string },
    options: { idempotencyKey?: string; time?: number; nonce?: string; tamperBody?: boolean; wrongKey?: AppKey } = {},
  ): Promise<SignedResult> {
    const entry = options.wrongKey ?? this.keys[app];
    if (entry === undefined) {
      throw new Error('no key');
    }
    const idempotencyKey = options.idempotencyKey ?? randomUUID();
    const rawBody = JSON.stringify(payload);
    const time = String(options.time ?? Math.floor(Date.now() / 1000));
    const nonce = options.nonce ?? b64u(randomBytes(32));
    const url = `/v1${path}`;
    const message = authMessage({
      environment: this.environment,
      method: 'POST',
      path: url,
      bodySha256Hex: sha256Hex(rawBody),
      idempotencyKeySha256Hex: sha256Hex(idempotencyKey),
      registrationTokenSha256Hex: sha256Hex(registration.token),
      time,
      nonce,
    });
    const headers: Record<string, string> = {
      'idempotency-key': idempotencyKey,
      'x-device-registration': registration.token,
      'x-device-time': time,
      'x-device-nonce': nonce,
      'x-device-signature': sign(entry.key.privateKey, message),
    };
    const sentBody = options.tamperBody === true ? rawBody.replace('"app":"', '"app": "') : rawBody;
    const response = await this.app.call('POST', path, { headers, rawBody: sentBody });
    return { response, sent: { headers, rawBody: sentBody, path } };
  }

  /** An authenticated request of a registered app. */
  async signedCall(
    app: ClientApp,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    options: { bearer: string; body?: unknown; idempotencyKey?: string; time?: number; nonce?: string; omitProof?: boolean; wrongKey?: AppKey; tamperUrl?: string } = { bearer: '' },
  ): Promise<SignedResult> {
    const entry = options.wrongKey ?? this.keys[app];
    if (entry === undefined || entry.keyId === undefined) {
      throw new Error('no registered key');
    }
    const rawBody = options.body === undefined ? undefined : JSON.stringify(options.body);
    const time = String(options.time ?? Math.floor(Date.now() / 1000));
    const nonce = options.nonce ?? b64u(randomBytes(32));
    const url = `/v1${path}`;
    const idempotencyKey = options.idempotencyKey ?? '';
    const message = requestMessage({
      environment: this.environment,
      keyId: entry.keyId,
      time,
      nonce,
      method,
      url: options.tamperUrl ?? url,
      bodySha256Hex: sha256Hex(rawBody ?? ''),
      bearerSha256Hex: sha256Hex(options.bearer),
      idempotencyKey,
    });
    const headers: Record<string, string> = options.omitProof === true
      ? {}
      : {
          'x-device-key-id': entry.keyId,
          'x-device-time': time,
          'x-device-nonce': nonce,
          'x-device-signature': sign(entry.key.privateKey, message),
        };
    if (idempotencyKey !== '') {
      headers['idempotency-key'] = idempotencyKey;
    }
    const response = await this.app.call(method, path, {
      headers,
      bearer: options.bearer,
      ...(rawBody === undefined ? {} : { rawBody }),
    });
    return { response, sent: { headers, rawBody, path } };
  }
}
