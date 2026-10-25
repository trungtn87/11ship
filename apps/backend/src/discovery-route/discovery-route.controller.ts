import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { DiscoveryRouteService } from './discovery-route-service';
import { parseRouteDistancesBody } from './discovery-route-validation';

/**
 * Public, no session, nothing stored: the road distances of up to 20 shop cards from one position. POST only because the position must not travel in a
 * URL (logs, caches). Never cached.
 */
@Controller('discovery')
export class DiscoveryRouteController {
  constructor(private readonly routes: DiscoveryRouteService) {}

  @Post('route-distances')
  @HttpCode(200)
  async distances(@Body() body: unknown, @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown }) {
    const input = parseRouteDistancesBody(body);
    response.setHeader('Cache-Control', 'no-store');
    return { data: await this.routes.distances(input) };
  }
}
