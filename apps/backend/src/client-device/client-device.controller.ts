import { Body, Controller, Headers, HttpCode, Post, Res } from '@nestjs/common';
import { ClientDeviceService, parseChallengeBody, parseRegistrationBody } from './client-device-service';

interface StatusSettableResponse {
  status(code: number): unknown;
}

/**
 * HTTP adapter of the native device protocol (contract11 section 7): POST /v1/client-auth/device/challenges and
 * /v1/client-auth/device/registrations. Public: no Bearer token, no user, nothing about an account in any answer. Transport
 * headers (Cache-Control: no-store ...) come from clientAuthTransportMiddleware, installed for the whole /v1/client-auth prefix.
 */
@Controller('client-auth/device')
export class ClientDeviceController {
  constructor(private readonly devices: ClientDeviceService) {}

  @Post('challenges')
  async challenge(@Body() body: unknown, @Res({ passthrough: true }) response: StatusSettableResponse) {
    const created = await this.devices.createChallenge(parseChallengeBody(body));
    response.status(201);
    return { data: { challenge_id: created.challengeId, nonce: created.nonce, expires_at: created.expiresAt } };
  }

  @Post('registrations')
  @HttpCode(201)
  async register(@Body() body: unknown, @Headers('idempotency-key') idempotencyKey: string | string[] | undefined) {
    const registered = await this.devices.register(parseRegistrationBody(body), idempotencyKey);
    return { data: { device_registration_token: registered.token, key_id: registered.keyId, expires_at: registered.expiresAt } };
  }
}
