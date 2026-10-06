import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { safeErrorCode } from '../common/safe-error';
import { APP_LOGGER } from '../logging/logging.module';
import { JsonLogger } from '../logging/json-logger';
import { DATABASE_POOL } from './database.constants';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private closing: Promise<void> | undefined;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_LOGGER) private readonly logger: JsonLogger,
  ) {}

  /**
   * Readiness probe: SELECT 1 on the pool, result checked. Never throws and never exposes
   * driver errors; failure is reported as `false` with a short code in the log.
   */
  async isReady(): Promise<boolean> {
    try {
      const result = await this.pool.query<{ ok: number }>('SELECT 1 AS ok');
      if (result.rows.length === 1 && result.rows[0]?.ok === 1) {
        return true;
      }
      this.logger.log('warn', 'readiness_check_failed', { code: 'UNEXPECTED_RESULT' });
      return false;
    } catch (error) {
      this.logger.log('warn', 'readiness_check_failed', { code: safeErrorCode(error) });
      return false;
    }
  }

  // Runs after the HTTP server has been closed (Nest calls shutdown hooks after dispose).
  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  // Idempotent: pg throws if Pool.end() is called twice.
  close(): Promise<void> {
    const pending = this.closing ?? this.pool.end();
    this.closing = pending;
    return pending;
  }
}
