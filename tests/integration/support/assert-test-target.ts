import { Client } from 'pg';
import { safeErrorCode } from '../../../apps/backend/src/common/safe-error';

// The only target integration tests may touch. Compared against what the server reports,
// never against the name or suffix written in the connection URL.
export const ALLOWED_TEST_DATABASE = 'ship11_test';
export const ALLOWED_TEST_USER = 'ship11_test';

export class TestTargetError extends Error {}

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface Queryable {
  query(sql: string): Promise<{ rows: unknown[] }>;
}

export function assertTestEnvironment(env: EnvSource): void {
  if (env.APP_ENV !== 'test') {
    throw new TestTargetError('Integration tests require APP_ENV=test.');
  }
  if (env.DATABASE_URL === undefined || env.DATABASE_URL === '') {
    throw new TestTargetError('Integration tests require the DATABASE_URL variable to be set.');
  }
}

/** Runs a read-only query. No DDL may run before this check passes. */
export async function assertTestDatabaseTarget(db: Queryable): Promise<void> {
  const result = await db.query('SELECT current_database() AS database_name, current_user AS user_name');
  const row = result.rows[0] as { database_name?: unknown; user_name?: unknown } | undefined;

  if (row?.database_name !== ALLOWED_TEST_DATABASE || row?.user_name !== ALLOWED_TEST_USER) {
    throw new TestTargetError(
      `Refusing to run: the connected target is not the allowed test database and user (${ALLOWED_TEST_DATABASE}/${ALLOWED_TEST_USER}).`,
    );
  }
}

/**
 * Full guard: environment first (no connection needed), then the real database and user as
 * reported by the server. Error messages never contain the connection URL or its credentials.
 */
export async function assertTestTarget(env: EnvSource): Promise<void> {
  assertTestEnvironment(env);

  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await assertTestDatabaseTarget(client);
  } catch (error) {
    if (error instanceof TestTargetError) {
      throw error;
    }
    throw new TestTargetError(
      `Cannot verify the test database target (error code ${safeErrorCode(error)}).`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
