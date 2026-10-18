import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PushConfig } from '../config/push-config';

// The outbound edge of M08 for Android. A push is "SENT" only when the provider ACCEPTED the message (HTTP 200 with a message name); that says nothing about
// the phone showing it or the user reading it. Nothing here logs or returns the token, the credential or a provider response body: errors are reduced to a fixed
// code and a short, token-free evidence string the Administration can show.

export interface PushMessage {
  readonly token: string;
  readonly title: string;
  readonly body: string;
  readonly notificationId: string;
  readonly kind: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly sound: boolean;
  readonly vibrate: boolean;
  readonly ttlSeconds: number;
  readonly collapseKey: string | null;
  readonly highPriority: boolean;
}

export type PushResult =
  | { readonly kind: 'SENT' }
  | { readonly kind: 'RETRYABLE'; readonly code: string; readonly evidence: string }
  | { readonly kind: 'INVALID_TOKEN' }
  | { readonly kind: 'REJECTED'; readonly code: string; readonly evidence: string };

export interface PushProvider {
  /** False when the operator has not supplied the provider configuration: every push is then recorded as skipped, never as sent. */
  readonly configured: boolean;
  send(message: PushMessage, signal: AbortSignal): Promise<PushResult>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

/** What the operator's configuration check found. Fixed codes only: never a token, a key, a project secret or a provider response body. */
export type PushCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'CREDENTIAL_UNAVAILABLE' | 'PROVIDER_AUTH' | 'PROJECT_NOT_FOUND' | 'PERMISSION_DENIED' | 'NETWORK' | 'REJECTED'; readonly evidence: string };

export class UnconfiguredPushProvider implements PushProvider {
  readonly configured = false;
  send(): Promise<PushResult> {
    return Promise.resolve({ kind: 'REJECTED', code: 'PROVIDER_NOT_CONFIGURED', evidence: 'Chưa cấu hình dịch vụ đẩy thông báo' });
  }
}

/** The Android notification channel the app creates for each sound/vibration choice (see the Android app). Sound off never stops the notification. */
export function channelId(sound: boolean, vibrate: boolean): string {
  return `n11_${sound ? 's' : 'q'}${vibrate ? 'v' : 'n'}`;
}

interface ServiceAccount {
  readonly clientEmail: string;
  readonly privateKey: string;
  readonly tokenUri: string;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

export class FcmPushProvider implements PushProvider {
  readonly configured = true;
  #account: ServiceAccount | undefined;
  #access: { readonly token: string; readonly expiresAtMs: number } | undefined;

  constructor(
    private readonly config: PushConfig,
    private readonly now: () => number = Date.now,
  ) {}

  async send(message: PushMessage, signal: AbortSignal): Promise<PushResult> {
    let account: ServiceAccount;
    try {
      account = await this.#loadAccount();
    } catch {
      return { kind: 'RETRYABLE', code: 'CREDENTIAL_UNAVAILABLE', evidence: 'Không đọc được tệp khóa dịch vụ đẩy thông báo' };
    }
    let result = await this.#post(account, message, signal, false);
    if (result === 'UNAUTHENTICATED') {
      result = await this.#post(account, message, signal, true);
    }
    return result === 'UNAUTHENTICATED' ? { kind: 'RETRYABLE', code: 'PROVIDER_AUTH', evidence: 'Dịch vụ đẩy thông báo từ chối xác thực' } : result;
  }

  /**
   * Operator check (`npm run push:check`): signs in with the service account and asks FCM to VALIDATE a message (validate_only: nothing is delivered to anybody).
   * It proves the credential file, the project id and the FCM API permission together; it cannot prove that a phone will receive anything.
   */
  async check(signal: AbortSignal): Promise<PushCheckResult> {
    let account: ServiceAccount;
    try {
      account = await this.#loadAccount();
    } catch {
      return { ok: false, code: 'CREDENTIAL_UNAVAILABLE', evidence: 'Không đọc được hoặc sai định dạng tệp khóa dịch vụ' };
    }
    try {
      const token = await this.#accessToken(account, signal, true);
      if (token === undefined) {
        return { ok: false, code: 'PROVIDER_AUTH', evidence: 'Google không cấp mã truy cập cho khóa dịch vụ này' };
      }
      const response = await fetch(`${this.config.apiOrigin}/v1/projects/${this.config.projectId}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ validate_only: true, message: { topic: 'n11-config-check', notification: { title: 'Kiểm tra cấu hình', body: 'Không gửi cho ai.' } } }),
        signal,
      });
      if (response.ok) {
        return { ok: true };
      }
      const detail = await errorStatus(response);
      if (response.status === 404) {
        return { ok: false, code: 'PROJECT_NOT_FOUND', evidence: 'Không tìm thấy dự án Firebase với mã đã cấu hình' };
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, code: 'PERMISSION_DENIED', evidence: `Khóa dịch vụ chưa có quyền gửi FCM cho dự án này (mã ${String(response.status)}${detail === '' ? '' : `, ${detail}`})` };
      }
      return { ok: false, code: 'REJECTED', evidence: `Dịch vụ đẩy từ chối kiểm tra: mã ${String(response.status)}${detail === '' ? '' : ` (${detail})`}` };
    } catch (error) {
      return { ok: false, code: 'NETWORK', evidence: `Không kết nối được tới Google${error instanceof Error ? ` (${error.name})` : ''}` };
    }
  }

  async #loadAccount(): Promise<ServiceAccount> {
    if (this.#account !== undefined) {
      return this.#account;
    }
    const parsed: unknown = JSON.parse(await readFile(this.config.serviceAccountFile, 'utf8'));
    const o = parsed as Record<string, unknown>;
    if (typeof o.client_email !== 'string' || typeof o.private_key !== 'string' || typeof o.token_uri !== 'string') {
      throw new Error('service account shape');
    }
    const tokenUrl = new URL(o.token_uri);
    if (tokenUrl.protocol !== 'https:' && !this.config.apiOrigin.startsWith('http://')) {
      throw new Error('token uri');
    }
    this.#account = { clientEmail: o.client_email, privateKey: o.private_key, tokenUri: o.token_uri };
    return this.#account;
  }

  async #accessToken(account: ServiceAccount, signal: AbortSignal, force: boolean): Promise<string | undefined> {
    const now = this.now();
    if (!force && this.#access !== undefined && this.#access.expiresAtMs - 60_000 > now) {
      return this.#access.token;
    }
    const iat = Math.floor(now / 1000);
    const claims = b64url(JSON.stringify({ iss: account.clientEmail, scope: SCOPE, aud: account.tokenUri, iat, exp: iat + 3600 }));
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${claims}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(account.privateKey);
    const response = await fetch(account.tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }),
      signal,
    });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string') {
      return undefined;
    }
    const lifetime = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    this.#access = { token: body.access_token, expiresAtMs: now + lifetime * 1000 };
    return body.access_token;
  }

  async #post(account: ServiceAccount, message: PushMessage, signal: AbortSignal, refresh: boolean): Promise<PushResult | 'UNAUTHENTICATED'> {
    try {
      const token = await this.#accessToken(account, signal, refresh);
      if (token === undefined) {
        return { kind: 'RETRYABLE', code: 'PROVIDER_AUTH', evidence: 'Không lấy được mã truy cập dịch vụ đẩy thông báo' };
      }
      const response = await fetch(`${this.config.apiOrigin}/v1/projects/${this.config.projectId}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({
          message: {
            token: message.token,
            notification: { title: message.title, body: message.body },
            data: { notification_id: message.notificationId, kind: message.kind, target_type: message.targetType, ...(message.targetId === null ? {} : { target_id: message.targetId }) },
            android: {
              priority: message.highPriority ? 'HIGH' : 'NORMAL',
              ttl: `${String(Math.max(1, Math.floor(message.ttlSeconds)))}s`,
              ...(message.collapseKey === null ? {} : { collapse_key: message.collapseKey }),
              notification: { channel_id: channelId(message.sound, message.vibrate) },
            },
          },
        }),
        signal,
      });
      if (response.ok) {
        return { kind: 'SENT' };
      }
      const detail = await errorStatus(response);
      if (response.status === 401) {
        return 'UNAUTHENTICATED';
      }
      if (response.status === 404 || detail === 'UNREGISTERED') {
        return { kind: 'INVALID_TOKEN' };
      }
      if (response.status === 400 && detail === 'INVALID_ARGUMENT') {
        // A malformed token is a dead token; a malformed message would be our bug and is reported as such by the evidence.
        return { kind: 'INVALID_TOKEN' };
      }
      if (response.status === 429 || response.status >= 500) {
        return { kind: 'RETRYABLE', code: `HTTP_${String(response.status)}`, evidence: `Dịch vụ đẩy thông báo trả mã ${String(response.status)}${detail === '' ? '' : ` (${detail})`}` };
      }
      return { kind: 'REJECTED', code: `HTTP_${String(response.status)}`, evidence: `Dịch vụ đẩy thông báo từ chối: mã ${String(response.status)}${detail === '' ? '' : ` (${detail})`}` };
    } catch (error) {
      if (signal.aborted) {
        return { kind: 'RETRYABLE', code: 'TIMEOUT', evidence: 'Hết thời gian chờ dịch vụ đẩy thông báo' };
      }
      return { kind: 'RETRYABLE', code: 'NETWORK', evidence: `Lỗi kết nối tới dịch vụ đẩy thông báo${error instanceof Error ? ` (${error.name})` : ''}` };
    }
  }
}

/** The provider's error status word (for example UNREGISTERED), restricted to capital letters and underscores; anything else reads as empty. Never the message. */
async function errorStatus(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { status?: unknown; details?: { errorCode?: unknown }[] } };
    const code = body.error?.details?.find((d) => typeof d.errorCode === 'string')?.errorCode ?? body.error?.status;
    return typeof code === 'string' && /^[A-Z_]{1,40}$/.test(code) ? code : '';
  } catch {
    return '';
  }
}
