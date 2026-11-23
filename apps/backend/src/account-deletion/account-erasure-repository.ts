import { Injectable } from '@nestjs/common';
import { WalletAccountActivityReader } from '../wallet/wallet-account-activity-reader';
import { TransactionContext } from '../transaction/transaction-context';

export interface ErasureVerification {
  readonly phoneNormalized: string;
  readonly purpose: string;
}

/**
 * The rows of the owner's erasure (Owner order 2026-11-23): the OTP challenge that proves the phone, the wallet money the pre-check reads, and the
 * one-time erasure request that the database checks before anything is anonymized (app.account_deletion_requests).
 */
@Injectable()
export class AccountErasureRepository {
  constructor(private readonly wallets: WalletAccountActivityReader) {}

  /** The OTP challenge exactly as stored (phone and purpose), or undefined. Read only. */
  async verification(context: TransactionContext, verificationId: string): Promise<ErasureVerification | undefined> {
    const result = await context.query<{ phone_normalized: string; purpose: string }>(
      'SELECT phone_normalized, purpose FROM app.phone_verifications WHERE verification_id = $1::uuid',
      [verificationId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { phoneNormalized: row.phone_normalized, purpose: row.purpose };
  }

  /** The balance and the held amount, read by the wallet package (it owns its tables). Read only. */
  async walletMoney(context: TransactionContext, driverId: string): Promise<{ readonly balanceVnd: bigint; readonly heldVnd: bigint }> {
    return this.wallets.money(context, driverId);
  }

  async insertRequest(
    context: TransactionContext,
    input: { readonly requestId: string; readonly userId: string; readonly verificationId: string; readonly forfeitVnd: bigint; readonly ttlSeconds: number },
  ): Promise<void> {
    await context.query(
      `INSERT INTO app.account_deletion_requests (request_id, user_id, verification_id, forfeit_vnd, created_at, expires_at)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4::bigint, t, t + ($5::int * interval '1 second') FROM (SELECT clock_timestamp() AS t) AS clock`,
      [input.requestId, input.userId, input.verificationId, input.forfeitVnd.toString(), input.ttlSeconds],
    );
  }

  /** Accounts that have a valid, unused, unexpired request (the erasure job's candidates). */
  async accountsWithValidRequest(context: TransactionContext, limit: number): Promise<string[]> {
    const result = await context.query<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM app.account_deletion_requests WHERE consumed_at IS NULL AND expires_at > now() ORDER BY user_id LIMIT $1::int`,
      [limit],
    );
    return result.rows.map((row) => row.user_id);
  }

  async validRequest(context: TransactionContext, userId: string): Promise<{ readonly requestId: string; readonly forfeitVnd: bigint } | undefined> {
    const result = await context.query<{ request_id: string; forfeit_vnd: string }>(
      `SELECT request_id, forfeit_vnd::text FROM app.account_deletion_requests
        WHERE user_id = $1::uuid AND consumed_at IS NULL AND expires_at > clock_timestamp()
        ORDER BY created_at DESC, request_id LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { requestId: row.request_id, forfeitVnd: BigInt(row.forfeit_vnd) };
  }
}
