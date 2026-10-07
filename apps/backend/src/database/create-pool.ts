import { Pool } from 'pg';
import { safeErrorCode } from '../common/safe-error';
import { DatabaseConfig } from '../config/app-config';
import { JsonLogger } from '../logging/json-logger';

/**
 * Builds the shared pool. Constructing a Pool does not open a connection, so the HTTP server
 * can start while the database is down; connections are made lazily on first use.
 * Acquisition and query timeouts are bounded so readiness can never hang.
 */
export function createPool(config: DatabaseConfig, logger: JsonLogger): Pool {
  const pool = new Pool({
    connectionString: config.url,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectTimeoutMs,
    // Client-side timeout is larger than the server-side one, so PostgreSQL's own statement cancel
    // normally wins and the connection stays usable (ADR-003 §13.1).
    query_timeout: config.queryTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
    idleTimeoutMillis: 30_000,
  });

  // An idle client can emit 'error' (for example when the server restarts). Without a listener
  // that would crash the process. Only a short code is logged — never the error message.
  pool.on('error', (error: Error) => {
    logger.log('error', 'db_pool_error', { code: safeErrorCode(error) });
  });

  return pool;
}
