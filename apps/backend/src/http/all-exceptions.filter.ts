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

    // Only whitelisted metadata is logged. The exception message and stack are never logged.
    this.logger.log(classified.status >= 500 ? 'error' : 'warn', 'request_failed', {
      request_id: requestId,
      method: safeMethod(request.method),
      status: classified.status,
      code: classified.code,
      error_class: safeErrorClass(exception),
    });

    this.httpAdapterHost.httpAdapter.reply(
      response,
      buildErrorBody(classified, requestId),
      classified.status,
    );
  }
}
