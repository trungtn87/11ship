import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { toSafeInteger } from '../auth/auth-db';
import { ReplayEnvelope } from '../crypto/key-version';
import { TransactionContext } from '../transaction/transaction-context';

export type FactorState = 'PENDING' | 'ACTIVE';

export interface FactorRow {
  readonly userId: string;
  readonly factorId: string;
  readonly state: FactorState;
  readonly version: number;
  readonly keyId: string;
  readonly envelope: ReplayEnvelope;
  readonly lastAcceptedStep: number | null;
  readonly pendingChallengeId: string | null;
}

interface RawFactor {
  user_id: string;
  factor_id: string;
  state: FactorState;
  version: string;
  key_id: string;
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  last_accepted_step: string | null;
  pending_challenge_id: string | null;
}

function toFactor(row: RawFactor): FactorRow {
  return {
    userId: row.user_id,
    factorId: row.factor_id,
    state: row.state,
    version: toSafeInteger(row.version),
    keyId: row.key_id,
    envelope: { iv: row.iv, tag: row.tag, ciphertext: row.ciphertext },
    lastAcceptedStep: row.last_accepted_step === null ? null : toSafeInteger(row.last_accepted_step),
    pendingChallengeId: row.pending_challenge_id,
  };
}

/** SQL for app.admin_totp_factors. The secret is only ever ciphertext here. */
@Injectable()
export class AdminFactorRepository {
  async lock(context: TransactionContext, userId: string): Promise<FactorRow | undefined> {
    const result = await context.query<RawFactor>(
      `SELECT user_id, factor_id, state, version, key_id, ciphertext, iv, tag, last_accepted_step, pending_challenge_id
         FROM app.admin_totp_factors WHERE user_id = $1::uuid FOR UPDATE`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toFactor(row);
  }

  async lockShared(context: TransactionContext, userId: string): Promise<FactorRow | undefined> {
    const result = await context.query<RawFactor>(
      `SELECT user_id, factor_id, state, version, key_id, ciphertext, iv, tag, last_accepted_step, pending_challenge_id
         FROM app.admin_totp_factors WHERE user_id = $1::uuid FOR SHARE`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toFactor(row);
  }

  /** A new generation: version 1, PENDING, owned by one challenge. */
  async insertPending(
    context: TransactionContext,
    input: { userId: string; factorId: string; keyId: string; envelope: ReplayEnvelope; challengeId: string },
  ): Promise<void> {
    const result = await context.query(
      `INSERT INTO app.admin_totp_factors (
         user_id, factor_id, state, version, key_id, ciphertext, iv, tag, last_accepted_step,
         pending_challenge_id, created_at, activated_at
       )
       SELECT $1::uuid, $2::uuid, 'PENDING', 1, $3, $4, $5, $6, NULL, $7::uuid, clock.t, NULL
         FROM (SELECT date_trunc('milliseconds', clock_timestamp()) AS t) AS clock`,
      [
        input.userId,
        input.factorId,
        input.keyId,
        input.envelope.ciphertext,
        input.envelope.iv,
        input.envelope.tag,
        input.challengeId,
      ],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Factor was not written');
    }
  }

  /** Removes the stale PENDING generation of a user (never an ACTIVE factor). */
  async deletePending(context: TransactionContext, userId: string): Promise<void> {
    await context.query(`DELETE FROM app.admin_totp_factors WHERE user_id = $1::uuid AND state = 'PENDING'`, [userId]);
  }

  /** PENDING -> ACTIVE. Keeps factor_id and version (the identity of the secret generation). */
  async activate(context: TransactionContext, input: { factorId: string; step: number }): Promise<void> {
    const result = await context.query(
      `UPDATE app.admin_totp_factors f
          SET state = 'ACTIVE', activated_at = clock.t, last_accepted_step = $2::bigint, pending_challenge_id = NULL
         FROM (SELECT date_trunc('milliseconds', clock_timestamp()) AS t) AS clock
        WHERE f.factor_id = $1::uuid AND f.state = 'PENDING'`,
      [input.factorId, input.step],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Factor was not activated');
    }
  }

  /** Moves the accepted step forward only. */
  async advanceStep(context: TransactionContext, input: { factorId: string; step: number }): Promise<void> {
    const result = await context.query(
      `UPDATE app.admin_totp_factors
          SET last_accepted_step = $2::bigint
        WHERE factor_id = $1::uuid AND state = 'ACTIVE' AND last_accepted_step < $2::bigint`,
      [input.factorId, input.step],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Accepted step was not advanced');
    }
  }
}
