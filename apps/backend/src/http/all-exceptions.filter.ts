import { randomUUID } from 'node:crypto';
import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { safeErrorClass } from '../common/safe-error';
import { JsonLogger } from '../logging/json-logger';
import { buildErrorBody, classifyException } from './error-envelope';
import { RequestWithContext, safeMethod } from './request-context.middleware';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly logger: JsonLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<unknown>();

    const requestId = request.requestId ?? randomUUID();
    const classified = classifyException(exception);

    // Map only fixed route families to app/module; never log the URL, query, parameters or raw exception.
    const original = (request as RequestWithContext & { originalUrl?: unknown }).originalUrl;
    const route = typeof original === 'string' ? original.split('?')[0] : '';
    const family = /^\/v1\/(driver\/wallet|driver|customers|customer|shop|onboarding|orders|admin|admin-auth|sms-gateway)(?:\/|$)/.exec(route)?.[1];
    const app = family?.startsWith('driver') ? 'SHIP' :
      ['customer', 'customers', 'shop', 'onboarding', 'orders'].includes(family ?? '') ? 'FOOD' :
      family?.startsWith('admin') ? 'ADMIN' : 'API';
    const moduleName = family === 'driver/wallet' ? 'M04' :
      family?.startsWith('admin') ? 'ADMIN' : family === 'orders' ? 'M10' : family === 'driver' ? 'M03' : 'GENERAL';

    // Only whitelisted metadata is logged. The exception message and stack are never logged.
    this.logger.log(classified.status >= 500 ? 'error' : 'warn', 'request_failed', {
      request_id: requestId,
      method: safeMethod(request.method),
      status: classified.status,
      code: classified.code,
      error_class: safeErrorClass(exception),
      app,
      module: moduleName,
    });

    if (classified.retryAfterSeconds !== undefined) {
      // Only the typed administration rate-limit error carries this value; it is a finite integer >= 1.
      this.httpAdapterHost.httpAdapter.setHeader(response, 'Retry-After', String(classified.retryAfterSeconds));
    }
    this.httpAdapterHost.httpAdapter.reply(
      response,
      buildErrorBody(classified, requestId),
      classified.status,
    );
  }
}
