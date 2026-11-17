import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * A public-route refusal (tracking page, route distances) over the per-address limit. It is an HttpException with the same
 * 429 status and message as before, plus the typed Retry-After value computed by the limiter (a finite integer >= 1).
 */
export class PublicRateLimitedError extends HttpException {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    this.name = 'PublicRateLimitedError';
    this.retryAfterSeconds =
      Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds >= 1 ? retryAfterSeconds : 1;
  }
}
