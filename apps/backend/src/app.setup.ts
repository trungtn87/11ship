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
  // Owner decision 2026-10-14: the administration web's own password reset routes (ADMIN_WEB scope) carry credentials as well.
  app.use(`/${GLOBAL_PREFIX}/admin-recovery`, clientAuthTransportMiddleware);
  // Issue #102: the SMS gateway API carries the message (an OTP) and a device credential, never cached.
  app.use(`/${GLOBAL_PREFIX}/sms-gateway`, clientAuthTransportMiddleware);
  // Same headers for the own-profile routes (M01.05): personal data, never cached.
  // The own shop and its menu are private to the owner as well (M02).
  app.use(`/${GLOBAL_PREFIX}/shop/me`, clientAuthTransportMiddleware);
  for (const prefix of CLIENT_PROFILE_ROUTE_PREFIXES) {
    app.use(`/${GLOBAL_PREFIX}/${prefix}`, clientAuthTransportMiddleware);
  }
  // The exact request bytes, kept BEFORE the JSON parser reads them: the native device proof signs SHA-256 of the raw body and the
  // exact target, never of a re-serialized object (contract11 section 8). Scoped to the routes a phone calls, so nothing else (the
  // administration hosting, static paths) meets a parser earlier than before. It is the same express JSON parser with the same
  // default limit and errors; it only adds the `verify` hook, and the framework's own parser then skips the already-parsed body.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express: { json(options: { limit?: string; verify: (request: { rawBody?: Buffer }, response: unknown, buffer: Buffer) => void }): never } = require('express');
  const rawCapturingParser = express.json({
    verify: (request, _response, buffer) => {
      request.rawBody = Buffer.from(buffer);
    },
  }) as unknown as (request: unknown, response: unknown, next: (error?: unknown) => void) => void;
  // A differently named wrapper on purpose: the framework skips registering ITS parser when it finds one named jsonParser, which
  // would leave every other route without a body parser.
  const captureRawBody = (request: unknown, response: unknown, next: (error?: unknown) => void): void => rawCapturingParser(request, response, next);
  // Only these two profile writes accept a <=1 MiB logo as base64. Keep every other route's default body limit.
  const logoParser = express.json({
    limit: '2mb',
    verify: (request, _response, buffer) => { request.rawBody = Buffer.from(buffer); },
  }) as unknown as (request: unknown, response: unknown, next: (error?: unknown) => void) => void;
  app.use(/^\/v1\/(?:onboarding\/shop\/profile|shop\/me\/profile)\/?$/, (request: { method: string }, response: unknown, next: (error?: unknown) => void) => {
    if (request.method === 'PUT') logoParser(request, response, next);
    else next();
  });
  // M11: an evidence picture is sent as base64 (5 MB of picture is about 7 MB of text). Its own parser goes FIRST for the three upload routes; every other
  // complaint route keeps the default limit through the parsers below (the first parser to run wins).
  const evidenceParser = express.json({
    limit: '7.5mb',
    verify: (request, _response, buffer) => {
      request.rawBody = Buffer.from(buffer);
    },
  }) as unknown as (request: unknown, response: unknown, next: (error?: unknown) => void) => void;
  const captureEvidenceBody = (request: unknown, response: unknown, next: (error?: unknown) => void): void => evidenceParser(request, response, next);
  for (const route of ['customers/me/complaints/attachments', 'shop/me/complaints/attachments', 'driver/complaints/attachments']) {
    app.use(`/${GLOBAL_PREFIX}/${route}`, captureEvidenceBody);
  }
  // The Shipper's M11 routes carry private data like every own-profile route: never cached.
  for (const route of ['driver/complaints', 'driver/reviews']) {
    app.use(`/${GLOBAL_PREFIX}/${route}`, clientAuthTransportMiddleware);
  }
  // Legacy /auth/role/select also uses SessionAuthGuard for native sessions; preserve its signed request bytes.
  app.use(`/${GLOBAL_PREFIX}/auth`, captureRawBody);
  app.use(`/${GLOBAL_PREFIX}/${CLIENT_AUTH_ROUTE_PREFIX}`, captureRawBody);
  app.use(`/${GLOBAL_PREFIX}/customer/me/profile`, captureRawBody);
  // M05: the customer address book writes a phone signs (create, edit, delete, default).
  app.use(`/${GLOBAL_PREFIX}/customers/me`, captureRawBody);
  const pictureParser = express.json({
    limit: '3.5mb',
    verify: (request, _response, buffer) => {
      request.rawBody = Buffer.from(buffer);
    },
  }) as unknown as (request: unknown, response: unknown, next: (error?: unknown) => void) => void;
  const capturePictureBody = (request: unknown, response: unknown, next: (error?: unknown) => void): void => pictureParser(request, response, next);
  app.use(`/${GLOBAL_PREFIX}/onboarding/shop/profile`, capturePictureBody);
  app.use(`/${GLOBAL_PREFIX}/shop/me/profile`, capturePictureBody);
  // The shop and driver onboarding writes a phone signs (M01 remaining flows).
  app.use(`/${GLOBAL_PREFIX}/onboarding`, captureRawBody);
  // M02: the shop writes a phone signs (profile, schedule, dishes). The picture upload carries a base64 picture: it gets its own,
  // larger parser FIRST (the first parser to run wins; the later ones skip an already parsed body), everything else keeps the default limit.
  app.use(`/${GLOBAL_PREFIX}/shop/me/menu/images`, capturePictureBody);
  app.use(`/${GLOBAL_PREFIX}/shop/me`, captureRawBody);
  // Native Shipper writes all sign the exact JSON bytes. Capture the whole driver route family, not only M04 wallet:
  // M03 profile/online, M07 delivery actions, M14 location, M11 complaints, and M04 wallet all share the session guard.
  // The M11 attachment upload's larger evidence parser is intentionally registered ABOVE this default-size parser.
  // Without rawBody on these routes the guard hashes an empty body and rejects valid Android signatures with 403.
  app.use(`/${GLOBAL_PREFIX}/driver`, captureRawBody);
  // M08: native notification writes sign their exact JSON bytes too (including `{}` on open/read-all).
  // Without this hook GET works, but the guard hashes an empty body for POST and refuses its valid proof.
  app.use(`/${GLOBAL_PREFIX}/notifications`, clientAuthTransportMiddleware);
  app.use(`/${GLOBAL_PREFIX}/notifications`, captureRawBody);
  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost), logger));
}
