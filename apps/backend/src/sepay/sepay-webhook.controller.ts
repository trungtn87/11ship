import { Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { SepayWebhookService } from './sepay-webhook.service';

interface RawRequest {
  readonly rawBody?: Buffer;
  readonly headers: Record<string, unknown>;
}

interface StatusResponse {
  status(code: number): unknown;
}

/**
 * Public SePay webhook: POST /v1/integrations/sepay/transaction. No session, no CSRF: the HMAC over the raw bytes is the authentication, and
 * it is the only thing the service trusts. The body is read from the exact bytes captured before JSON parsing (app.setup.ts). Responses are the status and the small JSON of SepayWebhookService; no header value and no secret is echoed.
 */
@Controller('integrations/sepay')
export class SepayWebhookController {
  constructor(private readonly webhook: SepayWebhookService) {}

  @Post('transaction')
  @HttpCode(200)
  async transaction(@Req() request: RawRequest, @Res({ passthrough: true }) response: StatusResponse) {
    if (!Buffer.isBuffer(request.rawBody)) {
      // The raw-body capture is mounted for this path; its absence is a server wiring fault, never a client error.
      throw new TechnicalError('internal', 'SePay raw body was not captured');
    }
    const result = await this.webhook.receive({
      rawBody: request.rawBody,
      timestampHeader: request.headers['x-sepay-timestamp'],
      signatureHeader: request.headers['x-sepay-signature'],
      nowSeconds: Math.floor(Date.now() / 1000),
      env: process.env,
    });
    response.status(result.status);
    return result.body;
  }
}
