/** Minimal result shape; a pg QueryResult satisfies it structurally. */
export interface QueryRows<R extends object = Record<string, unknown>> {
  readonly rows: R[];
  readonly rowCount: number | null;
  /** SQL command tag reported by PostgreSQL (for example "COMMIT"); absent on test doubles. */
  readonly command?: string;
}

/**
 * The ONLY thing a repository or participant service receives. It is a query capability bound to
 * one client and one transaction: it exposes no client, no pool, no manager and no way to commit,
 * roll back, release or open another transaction. After the transaction ends (commit, rollback,
 * deadline) it is CLOSED and every query is rejected before the connection is touched.
 */
export interface TransactionContext {
  readonly isActive: boolean;
  query<R extends object = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryRows<R>>;
}
