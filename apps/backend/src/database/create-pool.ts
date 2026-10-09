import { Pool, PoolConfig } from 'pg';
import { safeErrorCode } from '../common/safe-error';
import { DatabaseConfig } from '../config/app-config';
import { StartupConfigError } from '../config/startup-config-error';
import { JsonLogger } from '../logging/json-logger';
import { databaseUrlHasQuery } from './tls-config';

/**
 * The exact options handed to node-postgres. Kept separate from createPool so the TLS decision can be tested
 * without opening anything.
 *
 * With `config.tls` the pool gets `ssl: { ca, rejectUnauthorized: true }` (certificate chain and host name are
 * verified). node-postgres lets URL query parameters override explicit options, so a URL that carries any query
 * is refused here too, even though loadConfig already refuses it: the pool must never be built from a URL that
 * could replace the verified `ssl` object. Without `config.tls` (local PostgreSQL, CI) no `ssl` option is set,
 * exactly as before M00-D1.
 */
export function buildPoolOptions(config: DatabaseConfig): PoolConfig {
  const options: PoolConfig = {
    connectionString: config.url,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectTimeoutMs,
    // Client-side timeout is larger than the server-side one, so PostgreSQL's own statement cancel
    // normally wins and the connection stays usable (ADR-003 §13.1).
    query_timeout: config.queryTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
    idleTimeoutMillis: 30_000,
  };

  if (config.tls !== undefined) {
    if (databaseUrlHasQuery(config.url)) {
      throw new StartupConfigError(['DATABASE_URL']);
    }
    options.ssl = { ca: config.tls.ca, rejectUnauthorized: true };
  }

  return options;
}

/**
 * Builds the shared pool. Constructing a Pool does not open a connection, so the HTTP server
 * can start while the database is down; connections are made lazily on first use.
 * Acquisition and query timeouts are bounded so readiness can never hang.
 */
export function createPool(config: DatabaseConfig, logger: JsonLogger): Pool {
  const pool = new Pool(buildPoolOptions(config));

  // An idle client can emit 'error' (for example when the server restarts). Without a listener
  // that would crash the process. Only a short code is logged — never the error message.
  pool.on('error', (error: Error) => {
    logger.log('error', 'db_pool_error', { code: safeErrorCode(error) });
  });

  return pool;
}
