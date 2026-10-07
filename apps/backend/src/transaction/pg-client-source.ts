import { Pool } from 'pg';
import { QueryRows } from './transaction-context';
import { TransactionClient, TransactionClientSource } from './transaction-manager';

/** Adapts a pg Pool to the narrow interface the TransactionManager needs. */
export function poolClientSource(pool: Pool): TransactionClientSource {
  return {
    async acquire(): Promise<TransactionClient> {
      const client = await pool.connect();
      return {
        query: (text, values) =>
          client.query(text, values === undefined ? undefined : [...values]) as Promise<QueryRows>,
        release: (destroy) => {
          client.release(destroy === true);
        },
        onError: (listener) => {
          client.on('error', listener);
          return () => {
            client.removeListener('error', listener);
          };
        },
      };
    },
  };
}
