import { Body, Controller, Headers, Post, Req, Res } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthenticatedRequest } from '../auth/auth-principal';
import { parseClientRegisterBody } from './client-auth-validation';
import { ClientRegistrationService } from './client-registration-service';

interface StatusSettableResponse {
  status(code: number): unknown;
}

/**
 * HTTP adapter of the client authentication API (M01.03). It parses strictly, calls one service and wraps the result in the
 * { data } envelope. Transport headers (Cache-Control: no-store ...) come from clientAuthTransportMiddleware, installed in
 * front of the body parser. No business rule lives here and nothing here logs a body or a header.
 */
@Controller('client-auth')
export class ClientAuthController {
  constructor(private readonly registration: ClientRegistrationService) {}

  @Post('register')
  async register(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: StatusSettableResponse,
  ) {
    const input = parseClientRegisterBody(body);
    const outcome = await this.registration.register(input, idempotencyKey, request.requestId ?? randomUUID());
    response.status(outcome.status);
    return { data: outcome.payload };
  }
}
