import { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from './http/all-exceptions.filter';
import { createRequestContextMiddleware } from './http/request-context.middleware';
import { JsonLogger } from './logging/json-logger';
import { APP_LOGGER } from './logging/logging.module';

export const GLOBAL_PREFIX = 'v1';

/**
 * Shared by main.ts and the tests so they exercise the same HTTP pipeline:
 * request id middleware (also covers unknown routes), the /v1 prefix and the error envelope.
 */
export function configureApp(app: INestApplication): void {
  const logger = app.get<JsonLogger>(APP_LOGGER);
  app.use(createRequestContextMiddleware(logger));
  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost), logger));
}
