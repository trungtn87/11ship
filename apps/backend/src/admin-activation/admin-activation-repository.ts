import { Injectable } from '@nestjs/common';
import { epochMs, toSafeInteger } from '../auth/auth-db';
import { TechnicalError } from '../common/app-errors';
import { ReplayEnvelope } from '../crypto/key-version';
import { TransactionContext } from '../transaction/transaction-context';
import { ActivationPhoneVerificationMode } from '../config/admin-activation-config';
import { AttemptStatus, ChallengeStatus, InvalidatedReason, LIVE_ATTEMPT_STATUSES } from './admin-activation-constants';

// SQL of M01-D-ADMIN-1C for app.admin_activation_attempts, app.admin_activation_otp_challenges, app.admin_profiles and
// app.admin_app_permissions. Every method receives the caller's TransactionContext; none opens, commits or rolls back a
// transaction and none takes a lock "backwards" - the lock ORDER is the coordinator's (service), the lock MODE of each
// read is in its name (lock* = FOR UPDATE, peek*/read* = no lock). Every time that takes part in a decision is read as
// integer epoch milliseconds from PostgreSQL; every time written is the single database-clock value `T` the coordinator
// read after its last lock, passed in as epoch milliseconds (never an application clock).

const LIVE_LIST = LIVE_ATTEMPT_STATUSES.map((status) => `'${status}'`).join(', ');

/** A timestamptz from an epoch-millisecond parameter, exact (no floating point). */
const ts = (parameter: string): string => `(timestamptz 'epoch' + (${parameter}::bigint * interval '1 millisecond'))`;

export interface AttemptRow {
  readonly attemptId: string;
  readonly invitationId: string;
  readonly generationId: string;
  readonly userId: string;
  readonly factorId: string;
  readonly tokenDigest: string;
  readonly csrfNonce: Buffer;
  readonly csrfKeyId: string;
  readonly status: AttemptStatus;
  /** Recorded when the attempt is created, from the server configuration; immutable (a trigger refuses a change). */
  readonly phoneVerificationMode: ActivationPhoneVerificationMode;
  readonly invalidatedReason: InvalidatedReason | null;
  readonly otpVerifiedAtMs: number | null;
  readonly passwordHash: string | null;
  readonly passwordSetAtMs: number | null;
  readonly totpKeyId: string | null;
  readonly totpEnvelope: ReplayEnvelope | null;
  readonly totpIssuedAtMs: number | null;
  readonly totpAttemptCount: number;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly completedAtMs: number | null;
  readonly invalidatedAtMs: number | null;
}

export interface ChallengeRow {
  readonly challengeId: string;
  readonly attemptId: string;
  readonly phoneNormalized: string;
  readonly otpDigest: string;
  readonly digestKeyId: string;
  readonly status: ChallengeStatus;
  readonly attemptCount: number;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly resendNotBeforeMs: number;
  readonly verifiedAtMs: number | null;
  readonly endedAtMs: number | null;
}

export interface NewAttempt {
  readonly attemptId: string;
  readonly invitationId: string;
  readonly generationId: string;
  readonly userId: string;
  readonly factorId: string;
  readonly tokenDigest: string;
  readonly csrfNonce: Buffer;
  readonly csrfKeyId: string;
  readonly phoneVerificationMode: ActivationPhoneVerificationMode;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export interface NewChallenge {
  readonly challengeId: string;
  readonly attemptId: string;
  readonly phoneNormalized: string;
  readonly otpDigest: string;
  readonly digestKeyId: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly resendNotBeforeMs: number;
}

/** What the read-only state / replay classification sees: one consistent snapshot of one statement. */
export interface AttemptSnapshot {
  readonly attempt: AttemptRow;
  readonly newestChallenge: ChallengeRow | undefined;
  readonly invitation: { readonly status: string; readonly expiresAtMs: number; readonly acceptedUserId: string | null };
  /** clock_timestamp() of the same statement, in epoch milliseconds. */
  readonly nowMs: number;
}

export interface InvitationHint {
  readonly invitationId: string;
  readonly phoneNormalized: string;
}

type Raw = Record<string, unknown>;

const optMs = (value: unknown): number | null => (value === null || value === undefined ? null : toSafeInteger(value));
const str = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new TechnicalError('internal', 'Database returned an unexpected value');
  }
  return value;
};
const optStr = (value: unknown): string | null => (value === null || value === undefined ? null : str(value));
const int = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
};
const buf = (value: unknown): Buffer => {
  if (!Buffer.isBuffer(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected value');
  }
  return value;
};

function phoneModeOf(value: unknown): ActivationPhoneVerificationMode {
  if (value === 'REQUIRED' || value === 'DISABLED_TEST') {
    return value;
  }
  throw new TechnicalError('internal', 'Database returned an unexpected value');
}

function attemptColumns(alias: string, prefix: string): string {
  const col = (name: string): string => `${alias}.${name} AS ${prefix}${name}`;
  const time = (name: string): string => `${epochMs(`${alias}.${name}`)} AS ${prefix}${name}_ms`;
  return [
    'attempt_id', 'invitation_id', 'generation_id', 'user_id', 'factor_id', 'token_digest', 'csrf_nonce', 'csrf_key_id',
    'status', 'phone_verification_mode', 'invalidated_reason', 'password_hash', 'totp_key_id', 'totp_ciphertext', 'totp_iv',
    'totp_tag', 'totp_attempt_count',
  ].map(col).concat(
    ['otp_verified_at', 'password_set_at', 'totp_issued_at', 'created_at', 'expires_at', 'completed_at', 'invalidated_at'].map(time),
  ).join(', ');
}

function toAttempt(raw: Raw, prefix = ''): AttemptRow {
  const at = (name: string): unknown => raw[`${prefix}${name}`];
  const totpKeyId = optStr(at('totp_key_id'));
  return {
    attemptId: str(at('attempt_id')),
    invitationId: str(at('invitation_id')),
    generationId: str(at('generation_id')),
    userId: str(at('user_id')),
    factorId: str(at('factor_id')),
    tokenDigest: str(at('token_digest')),
    csrfNonce: buf(at('csrf_nonce')),
    csrfKeyId: str(at('csrf_key_id')),
    status: str(at('status')) as AttemptStatus,
    phoneVerificationMode: phoneModeOf(at('phone_verification_mode')),
    invalidatedReason: optStr(at('invalidated_reason')) as InvalidatedReason | null,
    otpVerifiedAtMs: optMs(at('otp_verified_at_ms')),
    passwordHash: optStr(at('password_hash')),
    passwordSetAtMs: optMs(at('password_set_at_ms')),
    totpKeyId,
    totpEnvelope:
      totpKeyId === null
        ? null
        : { ciphertext: buf(at('totp_ciphertext')), iv: buf(at('totp_iv')), tag: buf(at('totp_tag')) },
    totpIssuedAtMs: optMs(at('totp_issued_at_ms')),
    totpAttemptCount: int(at('totp_attempt_count')),
    createdAtMs: toSafeInteger(at('created_at_ms')),
    expiresAtMs: toSafeInteger(at('expires_at_ms')),
    completedAtMs: optMs(at('completed_at_ms')),
    invalidatedAtMs: optMs(at('invalidated_at_ms')),
  };
}

function challengeColumns(alias: string, prefix: string): string {
  const col = (name: string): string => `${alias}.${name} AS ${prefix}${name}`;
  const time = (name: string): string => `${epochMs(`${alias}.${name}`)} AS ${prefix}${name}_ms`;
  return [
    'challenge_id', 'attempt_id', 'phone_normalized', 'otp_digest', 'digest_key_id', 'status', 'attempt_count',
  ].map(col).concat(['created_at', 'expires_at', 'resend_not_before', 'verified_at', 'ended_at'].map(time)).join(', ');
}

function toChallenge(raw: Raw, prefix = ''): ChallengeRow {
  const at = (name: string): unknown => raw[`${prefix}${name}`];
  return {
    challengeId: str(at('challenge_id')),
    attemptId: str(at('attempt_id')),
    phoneNormalized: str(at('phone_normalized')),
    otpDigest: str(at('otp_digest')),
    digestKeyId: str(at('digest_key_id')),
    status: str(at('status')) as ChallengeStatus,
    attemptCount: int(at('attempt_count')),
    createdAtMs: toSafeInteger(at('created_at_ms')),
    expiresAtMs: toSafeInteger(at('expires_at_ms')),
    resendNotBeforeMs: toSafeInteger(at('resend_not_before_ms')),
    verifiedAtMs: optMs(at('verified_at_ms')),
    endedAtMs: optMs(at('ended_at_ms')),
  };
}

const ATTEMPT_COLUMNS = attemptColumns('a', '');
const CHALLENGE_COLUMNS = challengeColumns('c', '');

@Injectable()
export class AdminActivationRepository {
  // ----- reads without a lock ------------------------------------------------------------------------------------

  /** The invitation behind a token digest: only the IMMUTABLE facts that choose which locks to take (a hint). */
  async peekInvitationByTokenDigest(context: TransactionContext, tokenDigest: string): Promise<InvitationHint | undefined> {
    const result = await context.query<{ invitation_id: string; phone_normalized: string }>(
      'SELECT invitation_id, phone_normalized FROM app.admin_invitations WHERE token_digest = $1',
      [tokenDigest],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { invitationId: row.invitation_id, phoneNormalized: row.phone_normalized };
  }

  /** The IMMUTABLE phone of an invitation (a hint for L3). */
  async peekInvitationPhone(context: TransactionContext, invitationId: string): Promise<string | undefined> {
    const result = await context.query<{ phone_normalized: string }>(
      'SELECT phone_normalized FROM app.admin_invitations WHERE invitation_id = $1::uuid',
      [invitationId],
    );
    return result.rows[0]?.phone_normalized;
  }

  /** The attempt of a cookie digest, plain read: only the IMMUTABLE columns of it are trusted by the caller (R0). */
  async peekAttemptByDigest(context: TransactionContext, tokenDigest: string): Promise<AttemptRow | undefined> {
    const result = await context.query<Raw>(`SELECT ${ATTEMPT_COLUMNS} FROM app.admin_activation_attempts a WHERE a.token_digest = $1`, [
      tokenDigest,
    ]);
    const row = result.rows[0];
    return row === undefined ? undefined : toAttempt(row);
  }

  /**
   * ONE statement, one snapshot: the attempt of a cookie digest, its newest challenge (any status), its invitation and
   * the database clock of that statement. Read only: no lock, no write. Used by GET state and by the read-only TX-P.
   */
  readSnapshot(context: TransactionContext, tokenDigest: string): Promise<AttemptSnapshot | undefined> {
    return this.#snapshot(context, 'a.token_digest = $1', tokenDigest);
  }

  /** The same snapshot by attempt id (an attempt the caller already holds locked). */
  readSnapshotById(context: TransactionContext, attemptId: string): Promise<AttemptSnapshot | undefined> {
    return this.#snapshot(context, 'a.attempt_id = $1::uuid', attemptId);
  }

  async #snapshot(context: TransactionContext, where: string, parameter: string): Promise<AttemptSnapshot | undefined> {
    const result = await context.query<Raw>(
      `SELECT ${attemptColumns('a', 'a_')}, ${challengeColumns('c', 'c_')},
              i.status AS i_status, ${epochMs('i.expires_at')} AS i_expires_at_ms, i.accepted_user_id AS i_accepted_user_id,
              ${epochMs('clock_timestamp()')} AS now_ms
         FROM app.admin_activation_attempts a
         JOIN app.admin_invitations i ON i.invitation_id = a.invitation_id
         LEFT JOIN LATERAL (
              SELECT * FROM app.admin_activation_otp_challenges x
               WHERE x.attempt_id = a.attempt_id ORDER BY x.created_at DESC, x.challenge_id DESC LIMIT 1
         ) c ON true
        WHERE ${where}`,
      [parameter],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      attempt: toAttempt(row, 'a_'),
      newestChallenge: row.c_challenge_id === null ? undefined : toChallenge(row, 'c_'),
      invitation: {
        status: str(row.i_status),
        expiresAtMs: toSafeInteger(row.i_expires_at_ms),
        acceptedUserId: optStr(row.i_accepted_user_id),
      },
      nowMs: toSafeInteger(row.now_ms),
    };
  }

  /** Plain read of the newest challenge (any status), no lock: the view of a row set the caller already holds locked. */
  async peekNewestChallenge(context: TransactionContext, attemptId: string): Promise<ChallengeRow | undefined> {
    const result = await context.query<Raw>(
      `SELECT ${CHALLENGE_COLUMNS} FROM app.admin_activation_otp_challenges c
        WHERE c.attempt_id = $1::uuid ORDER BY c.created_at DESC, c.challenge_id DESC LIMIT 1`,
      [attemptId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toChallenge(row);
  }

  // ----- attempt locks (L9a) -------------------------------------------------------------------------------------

  /**
   * L9a: the attempt of the cookie (if any) and the live attempt of the invitation (if any), FOR UPDATE, in ascending
   * attempt_id order (one global order, so two transactions needing the same rows cannot deadlock). The caller already
   * holds L8 on the invitation; with L8 in X mode the set of live attempts of the invitation cannot change under it.
   */
  async lockAttempts(
    context: TransactionContext,
    input: { invitationId: string; cookieAttemptId: string | undefined },
  ): Promise<AttemptRow[]> {
    const result = await context.query<Raw>(
      `SELECT ${ATTEMPT_COLUMNS} FROM app.admin_activation_attempts a
        WHERE a.attempt_id = $2::uuid OR (a.invitation_id = $1::uuid AND a.status IN (${LIVE_LIST}))
        ORDER BY a.attempt_id
          FOR UPDATE`,
      [input.invitationId, input.cookieAttemptId ?? null],
    );
    return result.rows.map((row) => toAttempt(row));
  }

  /** L9a for the routes that act on exactly the cookie's attempt (verify, password, enrollment, otp-request, complete). */
  async lockAttempt(context: TransactionContext, attemptId: string): Promise<AttemptRow | undefined> {
    const result = await context.query<Raw>(
      `SELECT ${ATTEMPT_COLUMNS} FROM app.admin_activation_attempts a WHERE a.attempt_id = $1::uuid FOR UPDATE`,
      [attemptId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toAttempt(row);
  }

  /** The live attempt of an invitation, FOR UPDATE (the 1B hook, after L8 X). */
  async lockLiveAttempt(context: TransactionContext, invitationId: string): Promise<AttemptRow | undefined> {
    const result = await context.query<Raw>(
      `SELECT ${ATTEMPT_COLUMNS} FROM app.admin_activation_attempts a
        WHERE a.invitation_id = $1::uuid AND a.status IN (${LIVE_LIST}) FOR UPDATE`,
      [invitationId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toAttempt(row);
  }

  // ----- attempt writes (all compare-and-set on the expected status) ---------------------------------------------

  async insertAttempt(context: TransactionContext, input: NewAttempt): Promise<void> {
    const result = await context.query(
      `INSERT INTO app.admin_activation_attempts
         (attempt_id, invitation_id, generation_id, user_id, factor_id, token_digest, csrf_nonce, csrf_key_id, status,
          phone_verification_mode, totp_attempt_count, created_at, expires_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, 'STARTED', $11, 0, ${ts('$9')}, ${ts('$10')})`,
      [
        input.attemptId, input.invitationId, input.generationId, input.userId, input.factorId, input.tokenDigest,
        input.csrfNonce, input.csrfKeyId, input.createdAtMs, input.expiresAtMs, input.phoneVerificationMode,
      ],
    );
    this.#one(result.rowCount, 'Attempt was not written');
  }

  /** Any live status -> INVALIDATED; the password hash and the sealed TOTP secret are removed in the same UPDATE. */
  async invalidateAttempt(
    context: TransactionContext,
    input: { attemptId: string; reason: Exclude<InvalidatedReason, 'ATTEMPTS_EXHAUSTED'>; atMs: number },
  ): Promise<void> {
    const result = await context.query(
      `UPDATE app.admin_activation_attempts
          SET status = 'INVALIDATED', invalidated_reason = $2, invalidated_at = ${ts('$3')}, password_hash = NULL,
              totp_key_id = NULL, totp_ciphertext = NULL, totp_iv = NULL, totp_tag = NULL, totp_issued_at = NULL
        WHERE attempt_id = $1::uuid AND status IN (${LIVE_LIST})`,
      [input.attemptId, input.reason, input.atMs],
    );
    this.#one(result.rowCount, 'Attempt was not invalidated');
  }

  async markOtpVerified(context: TransactionContext, input: { attemptId: string; atMs: number }): Promise<void> {
    const result = await context.query(
      `UPDATE app.admin_activation_attempts SET status = 'OTP_VERIFIED', otp_verified_at = ${ts('$2')}
        WHERE attempt_id = $1::uuid AND status = 'STARTED'`,
      [input.attemptId, input.atMs],
    );
    this.#one(result.rowCount, 'Attempt was not advanced');
  }

  /**
   * REQUIRED attempts go OTP_VERIFIED -> PASSWORD_SET. DISABLED_TEST attempts (no OTP step, otp_verified_at stays NULL) go
   * STARTED -> PASSWORD_SET directly; the condition names the mode, so a REQUIRED attempt can never skip its OTP here.
   */
  async markPasswordSet(
    context: TransactionContext,
    input: { attemptId: string; passwordHash: string; atMs: number; from: 'OTP_VERIFIED' | 'STARTED' },
  ): Promise<void> {
    const mode = input.from === 'STARTED' ? 'DISABLED_TEST' : 'REQUIRED';
    const result = await context.query(
      `UPDATE app.admin_activation_attempts SET status = 'PASSWORD_SET', password_hash = $2, password_set_at = ${ts('$3')}
        WHERE attempt_id = $1::uuid AND status = $4 AND phone_verification_mode = $5`,
      [input.attemptId, input.passwordHash, input.atMs, input.from, mode],
    );
    this.#one(result.rowCount, 'Attempt was not advanced');
  }

  async markTotpIssued(
    context: TransactionContext,
    input: { attemptId: string; keyId: string; envelope: ReplayEnvelope; atMs: number },
  ): Promise<void> {
    const result = await context.query(
      `UPDATE app.admin_activation_attempts
          SET status = 'TOTP_ISSUED', totp_key_id = $2, totp_ciphertext = $3, totp_iv = $4, totp_tag = $5,
              totp_issued_at = ${ts('$6')}
        WHERE attempt_id = $1::uuid AND status = 'PASSWORD_SET'`,
      [input.attemptId, input.keyId, input.envelope.ciphertext, input.envelope.iv, input.envelope.tag, input.atMs],
    );
    this.#one(result.rowCount, 'Attempt was not advanced');
  }

  /**
   * One wrong authenticator code: totp_attempt_count + 1; the fifth ends the attempt (ATTEMPTS_EXHAUSTED) in the SAME
   * UPDATE and removes the password hash and the sealed secret. Returns the new count and whether the attempt ended.
   */
  async recordWrongTotp(
    context: TransactionContext,
    input: { attemptId: string; atMs: number; limit: number },
  ): Promise<{ count: number; exhausted: boolean }> {
    const result = await context.query<{ totp_attempt_count: number; status: string }>(
      `UPDATE app.admin_activation_attempts
          SET totp_attempt_count = totp_attempt_count + 1,
              status = CASE WHEN totp_attempt_count + 1 >= $3::int THEN 'INVALIDATED' ELSE status END,
              invalidated_reason = CASE WHEN totp_attempt_count + 1 >= $3::int THEN 'ATTEMPTS_EXHAUSTED' END,
              invalidated_at = CASE WHEN totp_attempt_count + 1 >= $3::int THEN ${ts('$2')} END,
              password_hash = CASE WHEN totp_attempt_count + 1 >= $3::int THEN NULL ELSE password_hash END,
              totp_key_id = CASE WHEN totp_attempt_count + 1 >= $3::int THEN NULL ELSE totp_key_id END,
              totp_ciphertext = CASE WHEN totp_attempt_count + 1 >= $3::int THEN NULL ELSE totp_ciphertext END,
              totp_iv = CASE WHEN totp_attempt_count + 1 >= $3::int THEN NULL ELSE totp_iv END,
              totp_tag = CASE WHEN totp_attempt_count + 1 >= $3::int THEN NULL ELSE totp_tag END,
              totp_issued_at = CASE WHEN totp_attempt_count + 1 >= $3::int THEN NULL ELSE totp_issued_at END
        WHERE attempt_id = $1::uuid AND status = 'TOTP_ISSUED'
        RETURNING totp_attempt_count, status`,
      [input.attemptId, input.atMs, input.limit],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Wrong code was not recorded');
    }
    return { count: row.totp_attempt_count, exhausted: row.status === 'INVALIDATED' };
  }

  async completeAttempt(context: TransactionContext, input: { attemptId: string; atMs: number }): Promise<void> {
    const result = await context.query(
      `UPDATE app.admin_activation_attempts
          SET status = 'COMPLETED', completed_at = ${ts('$2')}, password_hash = NULL, totp_key_id = NULL,
              totp_ciphertext = NULL, totp_iv = NULL, totp_tag = NULL, totp_issued_at = NULL
        WHERE attempt_id = $1::uuid AND status = 'TOTP_ISSUED'`,
      [input.attemptId, input.atMs],
    );
    this.#one(result.rowCount, 'Attempt was not completed');
  }

  // ----- challenges (L9b) ----------------------------------------------------------------------------------------

  /** L9b: the NEWEST challenge of an attempt in ANY status (never "the live one"), FOR UPDATE. */
  async lockNewestChallenge(context: TransactionContext, attemptId: string): Promise<ChallengeRow | undefined> {
    const result = await context.query<Raw>(
      `SELECT ${CHALLENGE_COLUMNS} FROM app.admin_activation_otp_challenges c
        WHERE c.attempt_id = $1::uuid ORDER BY c.created_at DESC, c.challenge_id DESC LIMIT 1 FOR UPDATE`,
      [attemptId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toChallenge(row);
  }

  /** The delivered / being-delivered challenge of an attempt (at most one by the unique index), FOR UPDATE. */
  async lockLiveChallenge(context: TransactionContext, attemptId: string): Promise<ChallengeRow | undefined> {
    const result = await context.query<Raw>(
      `SELECT ${CHALLENGE_COLUMNS} FROM app.admin_activation_otp_challenges c
        WHERE c.attempt_id = $1::uuid AND c.status IN ('PENDING_DELIVERY', 'PENDING') FOR UPDATE`,
      [attemptId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toChallenge(row);
  }

  async lockChallenge(context: TransactionContext, challengeId: string): Promise<ChallengeRow | undefined> {
    const result = await context.query<Raw>(
      `SELECT ${CHALLENGE_COLUMNS} FROM app.admin_activation_otp_challenges c WHERE c.challenge_id = $1::uuid FOR UPDATE`,
      [challengeId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toChallenge(row);
  }

  async insertChallenge(context: TransactionContext, input: NewChallenge): Promise<void> {
    const result = await context.query(
      `INSERT INTO app.admin_activation_otp_challenges
         (challenge_id, attempt_id, phone_normalized, otp_digest, digest_key_id, status, attempt_count, created_at,
          expires_at, resend_not_before)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'PENDING_DELIVERY', 0, ${ts('$6')}, ${ts('$7')}, ${ts('$8')})`,
      [
        input.challengeId, input.attemptId, input.phoneNormalized, input.otpDigest, input.digestKeyId,
        input.createdAtMs, input.expiresAtMs, input.resendNotBeforeMs,
      ],
    );
    this.#one(result.rowCount, 'Challenge was not written');
  }

  /** PENDING_DELIVERY | PENDING -> INVALIDATED (a resend, a new attempt, a closed invitation). */
  async invalidateChallenge(context: TransactionContext, input: { challengeId: string; atMs: number }): Promise<void> {
    const result = await context.query(
      `UPDATE app.admin_activation_otp_challenges SET status = 'INVALIDATED', ended_at = ${ts('$2')}
        WHERE challenge_id = $1::uuid AND status IN ('PENDING_DELIVERY', 'PENDING')`,
      [input.challengeId, input.atMs],
    );
    this.#one(result.rowCount, 'Challenge was not invalidated');
  }

  /** PENDING_DELIVERY -> PENDING. False when the row is no longer PENDING_DELIVERY (the caller ignores it). */
  async promoteChallenge(context: TransactionContext, challengeId: string): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.admin_activation_otp_challenges SET status = 'PENDING'
        WHERE challenge_id = $1::uuid AND status = 'PENDING_DELIVERY'`,
      [challengeId],
    );
    return result.rowCount === 1;
  }

  /** PENDING_DELIVERY -> DELIVERY_FAILED. False when the row is no longer PENDING_DELIVERY. */
  async failDelivery(context: TransactionContext, input: { challengeId: string; atMs: number }): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.admin_activation_otp_challenges SET status = 'DELIVERY_FAILED', ended_at = ${ts('$2')}
        WHERE challenge_id = $1::uuid AND status = 'PENDING_DELIVERY'`,
      [input.challengeId, input.atMs],
    );
    return result.rowCount === 1;
  }

  /** One wrong code on a PENDING challenge: +1; the fifth LOCKS it in the same UPDATE. Returns the new state. */
  async recordWrongOtp(
    context: TransactionContext,
    input: { challengeId: string; atMs: number; limit: number },
  ): Promise<{ count: number; locked: boolean }> {
    const result = await context.query<{ attempt_count: number; status: string }>(
      `UPDATE app.admin_activation_otp_challenges
          SET attempt_count = attempt_count + 1,
              status = CASE WHEN attempt_count + 1 >= $3::int THEN 'LOCKED' ELSE status END,
              ended_at = CASE WHEN attempt_count + 1 >= $3::int THEN ${ts('$2')} END
        WHERE challenge_id = $1::uuid AND status = 'PENDING'
        RETURNING attempt_count, status`,
      [input.challengeId, input.atMs, input.limit],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Wrong code was not recorded');
    }
    return { count: row.attempt_count, locked: row.status === 'LOCKED' };
  }

  async verifyChallenge(context: TransactionContext, input: { challengeId: string; atMs: number }): Promise<void> {
    const result = await context.query(
      `UPDATE app.admin_activation_otp_challenges SET status = 'VERIFIED', verified_at = ${ts('$2')}
        WHERE challenge_id = $1::uuid AND status = 'PENDING'`,
      [input.challengeId, input.atMs],
    );
    this.#one(result.rowCount, 'Challenge was not verified');
  }

  // ----- the administrator created by complete -------------------------------------------------------------------

  async insertMembership(context: TransactionContext, input: { userId: string; atMs: number }): Promise<void> {
    const result = await context.query(
      `INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at)
       VALUES ($1::uuid, 'ADMIN', 'ACTIVE', 1, ${ts('$2')}, ${ts('$2')})`,
      [input.userId, input.atMs],
    );
    this.#one(result.rowCount, 'Membership was not written');
  }

  /** The profile copies the invitation's name and note; phone_verified_at is the OTP verification of the attempt (OD-3). */
  async insertProfile(
    context: TransactionContext,
    input: { userId: string; invitationId: string; phoneVerifiedAtMs: number | null; atMs: number },
  ): Promise<void> {
    const result = await context.query(
      `INSERT INTO app.admin_profiles (user_id, invitation_id, full_name, note, phone_verified_at, created_at)
       SELECT $1::uuid, i.invitation_id, i.full_name, i.note, ${ts('$3')}, ${ts('$4')}
         FROM app.admin_invitations i WHERE i.invitation_id = $2::uuid`,
      [input.userId, input.invitationId, input.phoneVerifiedAtMs, input.atMs],
    );
    this.#one(result.rowCount, 'Profile was not written');
  }

  /** Copies the sealed, immutable permission snapshot of the invitation. At least one row is required. */
  async copyPermissions(context: TransactionContext, input: { userId: string; invitationId: string }): Promise<void> {
    const result = await context.query(
      `INSERT INTO app.admin_app_permissions (user_id, app, can_view, can_review_profile, can_lock)
       SELECT $1::uuid, p.app, p.can_view, p.can_review_profile, p.can_lock
         FROM app.admin_invitation_permissions p WHERE p.invitation_id = $2::uuid`,
      [input.userId, input.invitationId],
    );
    if (result.rowCount === null || result.rowCount < 1) {
      throw new TechnicalError('internal', 'Permissions were not copied');
    }
  }

  /**
   * The ACTIVE authenticator of the new administrator: the SEALED secret of the attempt is copied verbatim (its
   * associated data is the pre-allocated user_id / factor_id, version 1), and the step that matched becomes the
   * last accepted step so the same code cannot be used again.
   */
  async insertActiveFactor(
    context: TransactionContext,
    input: { userId: string; factorId: string; keyId: string; envelope: ReplayEnvelope; step: number; atMs: number },
  ): Promise<void> {
    const result = await context.query(
      `INSERT INTO app.admin_totp_factors
         (user_id, factor_id, state, version, key_id, ciphertext, iv, tag, last_accepted_step, pending_challenge_id,
          created_at, activated_at)
       VALUES ($1::uuid, $2::uuid, 'ACTIVE', 1, $3, $4, $5, $6, $7::bigint, NULL, ${ts('$8')}, ${ts('$8')})`,
      [
        input.userId, input.factorId, input.keyId, input.envelope.ciphertext, input.envelope.iv, input.envelope.tag,
        input.step, input.atMs,
      ],
    );
    this.#one(result.rowCount, 'Factor was not written');
  }

  #one(rowCount: number | null, message: string): void {
    if (rowCount !== 1) {
      throw new TechnicalError('internal', message);
    }
  }
}

