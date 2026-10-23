import { Injectable } from '@nestjs/common';
import { toSafeInteger } from '../auth/auth-db';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';

// SQL of the native device binding (contract11 section 9). One repository, seven tables, no other module writes them. Every
// instant comes from the database clock; the application clock never decides an expiry here.

export type DeviceApp = 'FOOD' | 'SHIP';
export type DevicePurpose = 'ENROLL' | 'JOIN' | 'AUTH';

export interface ChallengeRow {
  readonly challengeId: string;
  readonly nonce: Buffer;
  readonly app: DeviceApp;
  readonly purpose: DevicePurpose;
  readonly keyId: string | null;
  readonly expired: boolean;
  readonly consumed: boolean;
}

export interface KeyRow {
  readonly keyId: string;
  readonly publicKeySpki: Buffer;
  readonly app: DeviceApp;
  readonly signerSha256: Buffer;
  readonly packageName: string;
  readonly attestationLevel: 'TEE' | 'STRONGBOX';
  readonly attestationChain: Buffer[];
  readonly revoked: boolean;
}

export interface GrantRow {
  readonly grantId: string;
  readonly keyId: string;
  readonly joinBindingId: string | null;
  readonly authorizerKeyId: string | null;
  readonly expired: boolean;
  readonly consumedOperationId: string | null;
}

export interface BindingRow {
  readonly bindingId: string;
  readonly userId: string;
  readonly generation: number;
}

export interface LinkRow {
  readonly bindingId: string;
  readonly keyId: string;
  readonly app: DeviceApp;
}

export interface SessionBindingRow {
  readonly sessionId: string;
  readonly bindingId: string;
  readonly keyId: string;
  readonly app: DeviceApp;
  readonly generation: number;
  readonly current: boolean;
  /** The binding is still the user's current one and the key link is not detached and the key is not revoked. */
  readonly usable: boolean;
}

function asApp(value: unknown): DeviceApp {
  if (value === 'FOOD' || value === 'SHIP') {
    return value;
  }
  throw new TechnicalError('internal', 'Database returned an unexpected device app');
}

@Injectable()
export class ClientDeviceRepository {
  // ---- challenges -------------------------------------------------------------------------------------------------

  /** Challenges created in the last 60 seconds for the same bucket (the key for AUTH, the app + purpose otherwise). */
  async countRecentChallenges(context: TransactionContext, bucket: { app: DeviceApp; purpose: DevicePurpose; keyId: string | null }): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.client_device_challenges
        WHERE created_at > clock_timestamp() - interval '60 seconds'
          AND app = $1 AND purpose = $2 AND key_id IS NOT DISTINCT FROM $3::uuid`,
      [bucket.app, bucket.purpose, bucket.keyId],
    );
    return toSafeInteger(result.rows[0]?.n ?? '0');
  }

  async insertChallenge(
    context: TransactionContext,
    input: { challengeId: string; nonce: Buffer; app: DeviceApp; purpose: DevicePurpose; keyId: string | null; ttlSeconds: number },
  ): Promise<{ expiresAt: string }> {
    const result = await context.query<{ expires_at: string }>(
      `INSERT INTO app.client_device_challenges (challenge_id, nonce, app, purpose, key_id, expires_at, created_at)
       SELECT $1::uuid, $2::bytea, $3, $4, $5::uuid, c.t + make_interval(secs => $6::double precision), c.t
         FROM (SELECT date_trunc('milliseconds', clock_timestamp()) AS t) c
       RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at`,
      [input.challengeId, input.nonce, input.app, input.purpose, input.keyId, input.ttlSeconds],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Challenge was not written');
    }
    return { expiresAt: row.expires_at };
  }

  async lockChallenge(context: TransactionContext, challengeId: string): Promise<ChallengeRow | undefined> {
    const result = await context.query<{
      challenge_id: string;
      nonce: Buffer;
      app: string;
      purpose: DevicePurpose;
      key_id: string | null;
      expired: boolean;
      consumed: boolean;
    }>(
      `SELECT challenge_id, nonce, app, purpose, key_id, expires_at <= clock_timestamp() AS expired, consumed_at IS NOT NULL AS consumed
         FROM app.client_device_challenges WHERE challenge_id = $1::uuid FOR UPDATE`,
      [challengeId],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : { challengeId: row.challenge_id, nonce: row.nonce, app: asApp(row.app), purpose: row.purpose, keyId: row.key_id, expired: row.expired, consumed: row.consumed };
  }

  /** Read without a lock, to precompute the (expensive) chain validation outside the transaction. */
  async readChallenge(context: TransactionContext, challengeId: string): Promise<ChallengeRow | undefined> {
    const result = await context.query<{
      challenge_id: string;
      nonce: Buffer;
      app: string;
      purpose: DevicePurpose;
      key_id: string | null;
      expired: boolean;
      consumed: boolean;
    }>(
      `SELECT challenge_id, nonce, app, purpose, key_id, expires_at <= clock_timestamp() AS expired, consumed_at IS NOT NULL AS consumed
         FROM app.client_device_challenges WHERE challenge_id = $1::uuid`,
      [challengeId],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : { challengeId: row.challenge_id, nonce: row.nonce, app: asApp(row.app), purpose: row.purpose, keyId: row.key_id, expired: row.expired, consumed: row.consumed };
  }

  async consumeChallenge(context: TransactionContext, challengeId: string): Promise<void> {
    const result = await context.query(
      `UPDATE app.client_device_challenges SET consumed_at = date_trunc('milliseconds', clock_timestamp())
        WHERE challenge_id = $1::uuid AND consumed_at IS NULL`,
      [challengeId],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Challenge was not consumed');
    }
  }

  // ---- keys -------------------------------------------------------------------------------------------------------

  async findKeyById(context: TransactionContext, keyId: string): Promise<KeyRow | undefined> {
    return this.#key(context, 'key_id = $1::uuid', [keyId]);
  }

  async findKeyBySpki(context: TransactionContext, spki: Buffer): Promise<KeyRow | undefined> {
    return this.#key(context, 'public_key_spki = $1::bytea', [spki]);
  }

  async #key(context: TransactionContext, where: string, values: unknown[]): Promise<KeyRow | undefined> {
    const result = await context.query<{
      key_id: string;
      public_key_spki: Buffer;
      app: string;
      signer_sha256: Buffer;
      package_name: string;
      attestation_level: 'TEE' | 'STRONGBOX';
      attestation_chain: Buffer[];
      revoked: boolean;
    }>(
      `SELECT key_id, public_key_spki, app, signer_sha256, package_name, attestation_level, attestation_chain,
              revoked_at IS NOT NULL AS revoked
         FROM app.client_device_keys WHERE ${where}`,
      values,
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : {
          keyId: row.key_id,
          publicKeySpki: row.public_key_spki,
          app: asApp(row.app),
          signerSha256: row.signer_sha256,
          packageName: row.package_name,
          attestationLevel: row.attestation_level,
          attestationChain: row.attestation_chain,
          revoked: row.revoked,
        };
  }

  async insertKey(
    context: TransactionContext,
    input: {
      keyId: string;
      publicKeySpki: Buffer;
      app: DeviceApp;
      signerSha256: Buffer;
      packageName: string;
      attestationLevel: 'TEE' | 'STRONGBOX';
      attestationChain: readonly Buffer[];
    },
  ): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.client_device_keys (key_id, public_key_spki, app, signer_sha256, package_name, attestation_level, attestation_chain, verified_at)
       VALUES ($1::uuid, $2::bytea, $3, $4::bytea, $5, $6, $7::bytea[], date_trunc('milliseconds', clock_timestamp()))
       ON CONFLICT (public_key_spki) DO NOTHING`,
      [input.keyId, input.publicKeySpki, input.app, input.signerSha256, input.packageName, input.attestationLevel, input.attestationChain],
    );
    return result.rowCount === 1;
  }

  // ---- registration grants ----------------------------------------------------------------------------------------

  async insertGrant(
    context: TransactionContext,
    input: { grantId: string; tokenDigest: Buffer; keyId: string; joinBindingId: string | null; authorizerKeyId: string | null; ttlSeconds: number },
  ): Promise<{ expiresAt: string }> {
    const result = await context.query<{ expires_at: string }>(
      `INSERT INTO app.client_device_registration_grants (grant_id, token_digest, key_id, join_binding_id, authorizer_key_id, expires_at, created_at)
       SELECT $1::uuid, $2::bytea, $3::uuid, $4::uuid, $5::uuid, c.t + make_interval(secs => $6::double precision), c.t
         FROM (SELECT date_trunc('milliseconds', clock_timestamp()) AS t) c
       RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at`,
      [input.grantId, input.tokenDigest, input.keyId, input.joinBindingId, input.authorizerKeyId, input.ttlSeconds],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Grant was not written');
    }
    return { expiresAt: row.expires_at };
  }

  async findGrantByDigest(context: TransactionContext, tokenDigest: Buffer, lock: boolean): Promise<GrantRow | undefined> {
    const result = await context.query<{
      grant_id: string;
      key_id: string;
      join_binding_id: string | null;
      authorizer_key_id: string | null;
      expired: boolean;
      consumed_operation_id: string | null;
    }>(
      `SELECT grant_id, key_id, join_binding_id, authorizer_key_id, expires_at <= clock_timestamp() AS expired, consumed_operation_id
         FROM app.client_device_registration_grants WHERE token_digest = $1::bytea${lock ? ' FOR UPDATE' : ''}`,
      [tokenDigest],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : {
          grantId: row.grant_id,
          keyId: row.key_id,
          joinBindingId: row.join_binding_id,
          authorizerKeyId: row.authorizer_key_id,
          expired: row.expired,
          consumedOperationId: row.consumed_operation_id,
        };
  }

  async consumeGrant(context: TransactionContext, grantId: string, operationId: string): Promise<void> {
    const result = await context.query(
      `UPDATE app.client_device_registration_grants
          SET consumed_at = date_trunc('milliseconds', clock_timestamp()), consumed_operation_id = $2::uuid
        WHERE grant_id = $1::uuid AND consumed_at IS NULL`,
      [grantId, operationId],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Grant was not consumed');
    }
  }

  // ---- request nonces ---------------------------------------------------------------------------------------------

  /** False when this (key, nonce) was already seen inside its validity window. The row is the replay barrier. */
  async insertRequestNonce(context: TransactionContext, keyId: string, nonceDigest: Buffer): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.client_device_request_nonces (key_id, nonce_digest, expires_at)
       VALUES ($1::uuid, $2::bytea, clock_timestamp() + interval '120 seconds')
       ON CONFLICT (key_id, nonce_digest) DO NOTHING`,
      [keyId, nonceDigest],
    );
    return result.rowCount === 1;
  }

  /** The database clock in unix seconds, for the +-60 s window of a request. */
  async nowSeconds(context: TransactionContext): Promise<number> {
    const result = await context.query<{ s: string }>(`SELECT floor(extract(epoch FROM clock_timestamp()))::bigint::text AS s`);
    return toSafeInteger(result.rows[0]?.s);
  }

  /** The dedicated cleanup credential's work: bounded delete of EXPIRED challenges, grants and nonces only. */
  async purgeExpired(context: TransactionContext, limit: number): Promise<number> {
    const result = await context.query<{ n: string }>(
      `WITH c AS (DELETE FROM app.client_device_challenges WHERE challenge_id IN
                    (SELECT challenge_id FROM app.client_device_challenges WHERE expires_at < clock_timestamp() - interval '1 hour' LIMIT $1) RETURNING 1),
            n AS (DELETE FROM app.client_device_request_nonces WHERE (key_id, nonce_digest) IN
                    (SELECT key_id, nonce_digest FROM app.client_device_request_nonces WHERE expires_at < clock_timestamp() - interval '1 hour' LIMIT $1) RETURNING 1)
       SELECT ((SELECT count(*) FROM c) + (SELECT count(*) FROM n))::text AS n`,
      [limit],
    );
    return toSafeInteger(result.rows[0]?.n ?? '0');
  }

  // ---- bindings ---------------------------------------------------------------------------------------------------

  /** The user's current binding, locked. The caller holds the user root lock. */
  async lockCurrentBinding(context: TransactionContext, userId: string): Promise<BindingRow | undefined> {
    const result = await context.query<{ binding_id: string; user_id: string; generation: string }>(
      `SELECT binding_id, user_id, generation::text FROM app.client_device_bindings
        WHERE user_id = $1::uuid AND deactivated_at IS NULL FOR UPDATE`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { bindingId: row.binding_id, userId: row.user_id, generation: toSafeInteger(row.generation) };
  }

  async bindingById(context: TransactionContext, bindingId: string): Promise<(BindingRow & { active: boolean }) | undefined> {
    const result = await context.query<{ binding_id: string; user_id: string; generation: string; active: boolean }>(
      `SELECT binding_id, user_id, generation::text, deactivated_at IS NULL AS active FROM app.client_device_bindings WHERE binding_id = $1::uuid`,
      [bindingId],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : { bindingId: row.binding_id, userId: row.user_id, generation: toSafeInteger(row.generation), active: row.active };
  }

  async nextGeneration(context: TransactionContext, userId: string): Promise<number> {
    const result = await context.query<{ g: string }>(
      `SELECT (COALESCE(max(generation), 0) + 1)::text AS g FROM app.client_device_bindings WHERE user_id = $1::uuid`,
      [userId],
    );
    return toSafeInteger(result.rows[0]?.g);
  }

  async insertBinding(context: TransactionContext, input: { bindingId: string; userId: string; generation: number }): Promise<void> {
    await context.query(
      `INSERT INTO app.client_device_bindings (binding_id, user_id, generation, activated_at)
       VALUES ($1::uuid, $2::uuid, $3::bigint, date_trunc('milliseconds', clock_timestamp()))`,
      [input.bindingId, input.userId, input.generation],
    );
  }

  async deactivateBinding(context: TransactionContext, bindingId: string): Promise<void> {
    await context.query(
      `UPDATE app.client_device_bindings SET deactivated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE binding_id = $1::uuid AND deactivated_at IS NULL`,
      [bindingId],
    );
  }

  async currentLinks(context: TransactionContext, bindingId: string): Promise<LinkRow[]> {
    const result = await context.query<{ binding_id: string; key_id: string; app: string }>(
      `SELECT binding_id, key_id, app FROM app.client_device_key_links WHERE binding_id = $1::uuid AND detached_at IS NULL ORDER BY app`,
      [bindingId],
    );
    return result.rows.map((row) => ({ bindingId: row.binding_id, keyId: row.key_id, app: asApp(row.app) }));
  }

  /** The undetached link of a key (any user), locked: a key serves one binding at a time. */
  async lockCurrentLinkOfKey(context: TransactionContext, keyId: string): Promise<(LinkRow & { userId: string }) | undefined> {
    const result = await context.query<{ binding_id: string; key_id: string; app: string; user_id: string }>(
      `SELECT binding_id, key_id, app, user_id FROM app.client_device_key_links WHERE key_id = $1::uuid AND detached_at IS NULL FOR UPDATE`,
      [keyId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { bindingId: row.binding_id, keyId: row.key_id, app: asApp(row.app), userId: row.user_id };
  }

  async detachLinksOfBinding(context: TransactionContext, bindingId: string): Promise<void> {
    await context.query(
      `UPDATE app.client_device_key_links SET detached_at = date_trunc('milliseconds', clock_timestamp())
        WHERE binding_id = $1::uuid AND detached_at IS NULL`,
      [bindingId],
    );
  }

  async detachLinkOfKey(context: TransactionContext, keyId: string): Promise<void> {
    await context.query(
      `UPDATE app.client_device_key_links SET detached_at = date_trunc('milliseconds', clock_timestamp())
        WHERE key_id = $1::uuid AND detached_at IS NULL`,
      [keyId],
    );
  }

  async detachLinkOfApp(context: TransactionContext, bindingId: string, app: DeviceApp): Promise<void> {
    await context.query(
      `UPDATE app.client_device_key_links SET detached_at = date_trunc('milliseconds', clock_timestamp())
        WHERE binding_id = $1::uuid AND app = $2 AND detached_at IS NULL`,
      [bindingId, app],
    );
  }

  async insertLink(context: TransactionContext, input: { bindingId: string; keyId: string; userId: string; app: DeviceApp }): Promise<void> {
    await context.query(
      `INSERT INTO app.client_device_key_links (binding_id, key_id, user_id, app, linked_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, date_trunc('milliseconds', clock_timestamp()))`,
      [input.bindingId, input.keyId, input.userId, input.app],
    );
  }

  // ---- session bindings -------------------------------------------------------------------------------------------

  /** The current session of (binding, app), locked, so a relogin revokes exactly that one. */
  async lockCurrentSessionOf(context: TransactionContext, bindingId: string, app: DeviceApp): Promise<string | undefined> {
    const result = await context.query<{ session_id: string }>(
      `SELECT session_id FROM app.client_session_bindings WHERE binding_id = $1::uuid AND app = $2 AND is_current FOR UPDATE`,
      [bindingId, app],
    );
    return result.rows[0]?.session_id;
  }

  async revokeSession(context: TransactionContext, sessionId: string): Promise<void> {
    await context.query(
      `UPDATE app.sessions SET revoked_at = date_trunc('milliseconds', clock_timestamp()),
              updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE session_id = $1::uuid AND revoked_at IS NULL`,
      [sessionId],
    );
  }

  async insertSessionBinding(
    context: TransactionContext,
    input: { sessionId: string; bindingId: string; keyId: string; app: DeviceApp; generation: number },
  ): Promise<void> {
    await context.query(
      `INSERT INTO app.client_session_bindings (session_id, binding_id, key_id, app, generation, is_current)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::bigint, true)`,
      [input.sessionId, input.bindingId, input.keyId, input.app, input.generation],
    );
  }

  /**
   * Binding of a session as the guard and every business transaction see it. `usable` joins the session binding to the user's
   * CURRENT binding (same generation), the undetached key link and the unrevoked key: replacing a binding or detaching a key can
   * never leave an old session usable, and an old token never reaches an old key's data.
   */
  async sessionBinding(context: TransactionContext, sessionId: string): Promise<SessionBindingRow | undefined> {
    const result = await context.query<{
      session_id: string;
      binding_id: string;
      key_id: string;
      app: string;
      generation: string;
      is_current: boolean;
      usable: boolean;
    }>(
      `SELECT csb.session_id, csb.binding_id, csb.key_id, csb.app, csb.generation::text, csb.is_current,
              (csb.is_current
               AND b.deactivated_at IS NULL AND b.generation = csb.generation
               AND l.detached_at IS NULL AND k.revoked_at IS NULL) AS usable
         FROM app.client_session_bindings csb
         JOIN app.client_device_bindings b ON b.binding_id = csb.binding_id
         JOIN app.client_device_key_links l ON l.binding_id = csb.binding_id AND l.key_id = csb.key_id
         JOIN app.client_device_keys k ON k.key_id = csb.key_id
        WHERE csb.session_id = $1::uuid`,
      [sessionId],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : {
          sessionId: row.session_id,
          bindingId: row.binding_id,
          keyId: row.key_id,
          app: asApp(row.app),
          generation: toSafeInteger(row.generation),
          current: row.is_current,
          usable: row.usable,
        };
  }

  /**
   * One read for every business transaction (SessionAuthorizationParticipant): is this session a native one, and if so does it
   * still sit on the user's CURRENT binding with an undetached, unrevoked key? A native session without such a binding is dead,
   * whatever its own revoked_at says (the guard and the commit-time recheck compare binding id + generation, never device_id).
   */
  async nativeSessionState(context: TransactionContext, sessionId: string): Promise<'NOT_NATIVE' | 'USABLE' | 'UNBOUND'> {
    const result = await context.query<{ native: boolean; usable: boolean }>(
      `SELECT (s.platform = 'ANDROID' AND s.app IN ('FOOD', 'SHIP') AND s.auth_method <> 'PASSWORD') AS native,
              COALESCE(csb.is_current AND b.deactivated_at IS NULL AND b.generation = csb.generation
                       AND l.detached_at IS NULL AND k.revoked_at IS NULL, false) AS usable
         FROM app.sessions s
         LEFT JOIN app.client_session_bindings csb ON csb.session_id = s.session_id
         LEFT JOIN app.client_device_bindings b ON b.binding_id = csb.binding_id
         LEFT JOIN app.client_device_key_links l ON l.binding_id = csb.binding_id AND l.key_id = csb.key_id
         LEFT JOIN app.client_device_keys k ON k.key_id = csb.key_id
        WHERE s.session_id = $1::uuid`,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined || !row.native) {
      return 'NOT_NATIVE';
    }
    return row.usable ? 'USABLE' : 'UNBOUND';
  }
}
