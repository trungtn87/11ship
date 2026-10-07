import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { epochMs, toSafeInteger } from './auth-db';

export interface ProofForRegister {
  readonly proofId: string;
  readonly phoneNormalized: string;
  readonly purpose: string;
  readonly expiresAtMs: number;
  readonly consumed: boolean;
  readonly invalidated: boolean;
}

/** SQL for verification_proofs. Proof rows are never deleted. */
@Injectable()
export class ProofRepository {
  /**
   * Resolves ONLY the identity of a proof from its token digest. It deliberately applies no state check:
   * a consumed, expired, invalidated or differently-bound proof must still resolve, so the idempotency
   * fingerprint is compared before any business rule can answer (task section 9.1).
   */
  async findIdByDigest(context: TransactionContext, tokenDigest: string): Promise<string | undefined> {
    const result = await context.query<{ proof_id: string }>(
      'SELECT proof_id FROM app.verification_proofs WHERE token_digest = $1',
      [tokenDigest],
    );
    return result.rows[0]?.proof_id;
  }

  /** Locks the proof row. The caller reads the database clock AFTER this call. */
  async lockForRegister(
    context: TransactionContext,
    proofId: string,
  ): Promise<ProofForRegister | undefined> {
    const result = await context.query<{
      proof_id: string;
      phone_normalized: string;
      purpose: string;
      expires_ms: string;
      consumed: boolean;
      invalidated: boolean;
    }>(
      `SELECT proof_id, phone_normalized, purpose,
              ${epochMs('expires_at')} AS expires_ms,
              consumed_at IS NOT NULL AS consumed,
              invalidated_at IS NOT NULL AS invalidated
         FROM app.verification_proofs
        WHERE proof_id = $1::uuid
          FOR UPDATE`,
      [proofId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      proofId: row.proof_id,
      phoneNormalized: row.phone_normalized,
      purpose: row.purpose,
      expiresAtMs: toSafeInteger(row.expires_ms),
      consumed: row.consumed,
      invalidated: row.invalidated,
    };
  }

  /** Locks the proof row for the replay hook and says whether it has been invalidated. */
  async lockForReplay(
    context: TransactionContext,
    proofId: string,
  ): Promise<{ readonly invalidated: boolean } | undefined> {
    const result = await context.query<{ invalidated: boolean }>(
      `SELECT invalidated_at IS NOT NULL AS invalidated
         FROM app.verification_proofs
        WHERE proof_id = $1::uuid
          FOR UPDATE`,
      [proofId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { invalidated: row.invalidated };
  }

  async consume(context: TransactionContext, proofId: string): Promise<void> {
    const result = await context.query(
      `UPDATE app.verification_proofs
          SET consumed_at = date_trunc('milliseconds', clock_timestamp())
        WHERE proof_id = $1::uuid AND consumed_at IS NULL`,
      [proofId],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Proof was not consumed');
    }
  }
}
