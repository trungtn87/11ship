import { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { activationTransportMiddleware } from './admin-activation/admin-activation.controller';
import { ACTIVATION_ROUTE_PREFIX } from './admin-activation/admin-activation-constants';
import { ADMIN_AUTH_ROUTE_PREFIX, ADMIN_ROUTE_PREFIX, adminTransportMiddleware } from './http/admin-transport.middleware';
import {
  CLIENT_AUTH_ROUTE_PREFIX,
  CLIENT_PROFILE_ROUTE_PREFIXES,
  clientAuthTransportMiddleware,
} from './http/client-auth-transport.middleware';
import { ACCOUNT_RECOVERY_ROUTE_PREFIX } from './account-recovery/account-recovery-constants';
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
  // Same reason for /v1/admin-auth and /v1/admin (issue #49). Express matches a prefix on whole path segments, so
  // '/v1/admin' does not cover '/v1/admin-auth' or '/v1/admin-activation': each prefix is installed on its own.
  app.use(`/${GLOBAL_PREFIX}/${ADMIN_AUTH_ROUTE_PREFIX}`, adminTransportMiddleware);
  app.use(`/${GLOBAL_PREFIX}/${ADMIN_ROUTE_PREFIX}`, adminTransportMiddleware);
  // Same reason for /v1/client-auth (M01.03): credentials and session tokens, never cached.
  app.use(`/${GLOBAL_PREFIX}/${CLIENT_AUTH_ROUTE_PREFIX}`, clientAuthTransportMiddleware);
  // M01-RESET: the no-OTP test password reset carries credentials, never cached.
  app.use(`/${GLOBAL_PREFIX}/${ACCOUNT_RECOVERY_ROUTE_PREFIX}`, clientAuthTransportMiddleware);
  // Same headers for the own-profile routes (M01.05): personal data, never cached.
  for (const prefix of CLIENT_PROFILE_ROUTE_PREFIXES) {
    app.use(`/${GLOBAL_PREFIX}/${prefix}`, clientAuthTransportMiddleware);
  }
  // The exact request bytes, kept BEFORE the JSON parser reads them: the native device proof signs SHA-256 of the raw body and the
  // exact target, never of a re-serialized object (contract11 section 8). Scoped to the routes a phone calls, so nothing else (the
  // administration hosting, static paths) meets a parser earlier than before. It is the same express JSON parser with the same
  // default limit and errors; it only adds the `verify` hook, and the framework's own parser then skips the already-parsed body.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express: { json(options: { verify: (request: { rawBody?: Buffer }, response: unknown, buffer: Buffer) => void }): never } = require('express');
  const rawCapturingParser = express.json({
    verify: (request, _response, buffer) => {
      request.rawBody = Buffer.from(buffer);
    },
  }) as unknown as (request: unknown, response: unknown, next: (error?: unknown) => void) => void;
  // A differently named wrapper on purpose: the framework skips registering ITS parser when it finds one named jsonParser, which
  // would leave every other route without a body parser.
  const captureRawBody = (request: unknown, response: unknown, next: (error?: unknown) => void): void => rawCapturingParser(request, response, next);
  app.use(`/${GLOBAL_PREFIX}/${CLIENT_AUTH_ROUTE_PREFIX}`, captureRawBody);
  app.use(`/${GLOBAL_PREFIX}/customer/me/profile`, captureRawBody);
  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost), logger));
}
