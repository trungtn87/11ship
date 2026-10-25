import { Pool } from 'pg';
/** Disposable integration database only, called by the existing guarded purgePhone helper. Financial rows are never deleted by product code. */
export async function purgeBusinessFinanceOfPhone(pool:Pool,phone:string):Promise<void>{
  if((await pool.query("SELECT to_regclass('app.business_finance_requests') AS t")).rows[0]?.t==null)return;
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const users=`SELECT user_id FROM app.users WHERE phone_normalized=$1`;
    const rooms=`SELECT request_id FROM app.business_finance_requests WHERE owner_user_id IN (${users}) OR resolved_by IN (${users}) OR request_id IN(SELECT request_id FROM app.business_finance_messages WHERE sender_user_id IN(${users}))`;
    await c.query('ALTER TABLE app.business_finance_messages DISABLE TRIGGER USER');
    await c.query('ALTER TABLE app.business_bank_receipts DISABLE TRIGGER USER');
    await c.query(`DELETE FROM app.business_push_jobs WHERE message_sequence IN(SELECT sequence_no FROM app.business_finance_messages WHERE request_id IN(${rooms})) OR subscription_id IN(SELECT subscription_id FROM app.business_push_subscriptions WHERE user_id IN(${users}))`,[phone]);
    await c.query(`DELETE FROM app.business_push_subscriptions WHERE user_id IN(${users})`,[phone]);
    await c.query(`DELETE FROM app.business_finance_reads WHERE request_id IN(${rooms}) OR user_id IN(${users})`,[phone]);
    // Capture ids before deleting messages, because the sender can be the only link to this fixture user.
    const ids=(await c.query<{request_id:string}>(rooms,[phone])).rows.map(r=>r.request_id);
    await c.query(`DELETE FROM app.business_bank_receipts WHERE (source_kind='SHOP_PAYMENT' AND source_id=ANY($2::uuid[])) OR (source_kind='WALLET' AND source_id IN(
      SELECT b.bank_record_id FROM app.wallet_bank_transactions b LEFT JOIN app.wallet_topups t ON t.topup_id=b.topup_id
      LEFT JOIN app.driver_wallets w ON w.wallet_id=t.wallet_id LEFT JOIN app.drivers d ON d.driver_id=w.driver_id
      WHERE d.user_id IN(${users}) OR t.confirmed_by_user_id IN(${users}) OR b.withdrawal_id IN(SELECT withdrawal_id FROM app.wallet_withdrawals WHERE wallet_id IN(SELECT wallet_id FROM app.driver_wallets WHERE driver_id IN(SELECT driver_id FROM app.drivers WHERE user_id IN(${users}))))))`,[phone,ids]);
    await c.query('DELETE FROM app.business_finance_messages WHERE request_id=ANY($1::uuid[])',[ids]);
    await c.query('DELETE FROM app.business_finance_requests WHERE request_id=ANY($1::uuid[])',[ids]);
    await c.query('ALTER TABLE app.business_finance_messages ENABLE TRIGGER USER');
    await c.query('ALTER TABLE app.business_bank_receipts ENABLE TRIGGER USER');
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
