import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import { ShopLogoService } from './shop-logo-service';

/** Public logo bytes only for an active shop in an active area whose owner is not locked. */
@Controller('shops')
export class ShopLogoController {
  constructor(private readonly logos: ShopLogoService) {}

  @Get(':shopId/logo')
  async read(@Param('shopId') shopId: string, @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown }) {
    const logo = await this.logos.read(shopId);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(Buffer.from(logo.data_base64, 'base64'), { type: logo.content_type });
  }
}
