import { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { activationTransportMiddleware } from './admin-activation/admin-activation.controller';
import { ACTIVATION_ROUTE_PREFIX } from './admin-activation/admin-activation-constants';
import { AllExceptionsFilter } from './http/all-exceptions.filter';
import { createRequestContextMiddleware } from './http/request-context.middleware';
import { JsonLogger } from './logging/json-logger';
import { APP_LOGGER } from './logging/logging.module';

export const GLOBAL_PREFIX = 'v1';

/**
 * Shared by main.ts and the tests so they exercise the same HTTP pipeline:
 * request id middleware (also covers unknown routes), the /v1 prefix and the error envelope.
 *
 * The transport headers of /v1/admin-activation are applied HERE, as an application-level middleware, and not by a module
 * `configure()`: module middleware runs AFTER the body parser, so a JSON syntax error or an oversized body (answered by the
 * parser itself, before any route) would leave the response without no-store / no-referrer / nosniff. `app.use` calls made
 * before init sit in front of the parser, which the framework registers at init.
 */
export function configureApp(app: INestApplication): void {
  const logger = app.get<JsonLogger>(APP_LOGGER);
  app.use(createRequestContextMiddleware(logger));
  app.use(`/${GLOBAL_PREFIX}/${ACTIVATION_ROUTE_PREFIX}`, activationTransportMiddleware);
  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost), logger));
}
