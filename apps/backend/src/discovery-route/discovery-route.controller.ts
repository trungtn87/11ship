import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { OtpClientIp, OtpIpRequest } from '../auth/otp-client-ip';
import { PublicRateLimitedError } from '../common/app-errors';
import { PublicRateLimiter } from '../delivery/public-rate-limiter';
import { DiscoveryRouteService } from './discovery-route-service';
import { parseRouteDistancesBody } from './discovery-route-validation';

/**
 * Requests per minute per client address on route-distances (P5-7c). Each call starts routing requests on the server, so it is limited per address.
 * Client pattern (mobile RouteDistanceController): answers cached 10 min, one request in flight, at most 20 shops per request, a 1-min wait after a
 * failure. A device therefore sends a few requests per minute at most, in bursts when it moves ~110 m. The limit is set above that so that devices
 * sharing a carrier NAT address are not refused in normal use. A refused call only shows "unavailable" on the card; no distance is invented.
 */
export const ROUTE_DISTANCES_LIMIT_PER_MINUTE = 120;

/**
 * Public, no session, nothing stored: the road distances of up to 20 shop cards from one position. POST only because the position must not travel in a
 * URL (logs, caches). Never cached.
 */
@Controller('discovery')
export class DiscoveryRouteController {
  /** The same bounded limiter as public tracking (fixed window, hard cap on identities), with this route's limit. */
  private readonly limiter = new PublicRateLimiter(Date.now, ROUTE_DISTANCES_LIMIT_PER_MINUTE);

  constructor(
    private readonly routes: DiscoveryRouteService,
    private readonly clientIp: OtpClientIp,
  ) {}

  @Post('route-distances')
  @HttpCode(200)
  async distances(@Body() body: unknown, @Req() req: OtpIpRequest, @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown }) {
    const decision = this.limiter.take(this.clientIp.identity(req));
    if (!decision.allowed) {
      throw new PublicRateLimitedError(decision.retryAfterSeconds);
    }
    const input = parseRouteDistancesBody(body);
    response.setHeader('Cache-Control', 'no-store');
    return { data: await this.routes.distances(input) };
  }
}
